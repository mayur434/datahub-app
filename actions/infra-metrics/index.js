/**
 * MDM Infrastructure Metrics Action
 * Provides comprehensive infra metrics, storage analytics, usage telemetry,
 * failure reports, and guardrail status for the Admin Console.
 *
 * Adobe App Builder DocDB:
 *   - Per-package storage allocation
 *   - Document count limits per collection
 *
 * Endpoints (via query param `report`):
 *   - storage:    Per-collection and per-entity storage breakdown
 *   - guardrails: Current guardrail status vs configured limits
 *   - failures:   Failure analytics from audit logs
 *   - analytics:  Action invocation analytics
 *   - usage:      Read/write throughput, entity growth, cache efficiency
 *   - overview:   Combined summary of all metrics (default)
 */

const { getDbClient, safeFindOne, COLLECTIONS, createResponse, createErrorResponse, validateIMSToken, getUserFromParams, getEnvConfig, getStateClient, getCachedSettings, getTimezoneDate } = require('../mdm-utils')

const SETTINGS_DOC_ID = 'app-settings'
const METRICS_CACHE_KEY = 'metrics-cache'

const AVG_DOC_SIZES = {
  [COLLECTIONS.METADATA]: 2048,
  [COLLECTIONS.VERSIONS]: 512,
  [COLLECTIONS.AUDIT]: 384,
  [COLLECTIONS.SETTINGS]: 2048,
  [COLLECTIONS.ARCHIVES]: 1024,
  [COLLECTIONS.ROLES]: 256
}

const AVG_MASTER_DOC_SIZE = 1024

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  // Allow scheduled trigger invocations (no auth) for cache refresh jobs
  const isScheduledRefresh = params.__ow_method === undefined && !params.__ow_headers
  if (!isScheduledRefresh) {
    const auth = validateIMSToken(params)
    if (!auth.valid) return createErrorResponse(auth.error, 401)
  }

  const env = getEnvConfig(params)
  const CACHE_TTL_SECONDS = env.metricsCacheTTLMinutes * 60
  const report = (params.report || 'overview').toLowerCase()
  const forceRefresh = isScheduledRefresh || params.forceRefresh === true || params.forceRefresh === 'true'

  const DEFAULT_TIER_LIMITS = {
    maxStorageMB: 250,
    maxDocuments: 500000,
    maxCollections: 20,
    maxDocumentSizeKB: 512,
    actionMemoryMB: 256,
    actionTimeoutMs: env.queryTimeout
  }

  let client
  try {
    client = await getDbClient(params)
    const settings = await loadSettings(client)
    const tierLimits = { ...DEFAULT_TIER_LIMITS, ...(settings.guardrails || {}), ...(settings.infrastructure || {}) }

    // For overview requests, use aio-lib-state cache layer
    if (report === 'overview' && !forceRefresh) {
      const cached = await getCachedMetrics()
      if (cached) {
        return createResponse({ ...cached.data, _cached: true, _cachedAt: cached.cachedAt })
      }
    }

    let result
    switch (report) {
      case 'storage':
        result = { storage: await collectStorageMetrics(client, tierLimits) }
        break
      case 'guardrails':
        result = { guardrails: await collectGuardrailStatus(client, settings, tierLimits, env) }
        break
      case 'failures':
        result = { failures: await collectFailureReport(client, params) }
        break
      case 'analytics':
        result = { analytics: await collectAnalytics(client, params) }
        break
      case 'usage':
        result = { usage: await collectUsageMetrics(client, settings, tierLimits) }
        break
      case 'overview':
      default:
        result = await collectOverview(client, settings, tierLimits, params)
        // Cache the freshly computed overview in aio-lib-state
        await cacheMetrics(result, CACHE_TTL_SECONDS)
        result._cached = false
        result._cachedAt = getTimezoneDate(params)
        break
    }

    return createResponse(result)
  } catch (error) {
    console.error('Infra metrics error:', error)
    return createErrorResponse(`Metrics collection failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

/**
 * Retrieve cached metrics from aio-lib-state.
 * Returns null if cache key is missing (expired keys are auto-deleted by state lib).
 */
async function getCachedMetrics () {
  try {
    const state = await getStateClient()
    const entry = await state.get(METRICS_CACHE_KEY)
    if (!entry || !entry.value) return null
    return JSON.parse(entry.value)
  } catch (e) {
    return null
  }
}

/**
 * Persist computed metrics to aio-lib-state with TTL-based expiry.
 */
async function cacheMetrics (data, ttlSeconds) {
  try {
    const state = await getStateClient()
    const cacheDoc = { data, cachedAt: getTimezoneDate() }
    await state.put(METRICS_CACHE_KEY, JSON.stringify(cacheDoc), { ttl: Math.ceil(ttlSeconds) })
  } catch (e) {
    // Cache write is best-effort — don't fail the request
    console.error('Failed to cache metrics:', e.message)
  }
}

async function loadSettings (client) {
  return await getCachedSettings(client)
}

// ============================================================
// STORAGE METRICS
// ============================================================

async function collectStorageMetrics (client, tierLimits) {
  const collectionStats = {}
  let totalDocuments = 0
  let totalEstimatedBytes = 0

  for (const [key, colName] of Object.entries(COLLECTIONS)) {
    try {
      const col = await client.collection(colName)
      const count = await col.estimatedDocumentCount()
      const avgSize = AVG_DOC_SIZES[colName] || 512
      const estimatedBytes = count * avgSize
      collectionStats[colName] = {
        documentCount: count,
        avgDocumentSizeBytes: avgSize,
        estimatedSizeBytes: estimatedBytes,
        estimatedSizeMB: parseFloat((estimatedBytes / (1024 * 1024)).toFixed(3))
      }
      totalDocuments += count
      totalEstimatedBytes += estimatedBytes
    } catch (e) {
      collectionStats[colName] = { documentCount: 0, estimatedSizeBytes: 0, estimatedSizeMB: 0, error: 'Collection not accessible' }
    }
  }

  const entityBreakdown = await collectEntityBreakdown(client)
  const totalSizeMB = parseFloat((totalEstimatedBytes / (1024 * 1024)).toFixed(3))
  const usagePercent = parseFloat(((totalSizeMB / tierLimits.maxStorageMB) * 100).toFixed(1))
  const documentsPercent = parseFloat(((totalDocuments / tierLimits.maxDocuments) * 100).toFixed(1))

  return {
    summary: {
      totalDocuments,
      totalEstimatedSizeMB: totalSizeMB,
      maxStorageMB: tierLimits.maxStorageMB,
      storageUsagePercent: usagePercent,
      maxDocuments: tierLimits.maxDocuments,
      documentsUsagePercent: documentsPercent,
      remainingStorageMB: parseFloat((tierLimits.maxStorageMB - totalSizeMB).toFixed(3)),
      remainingDocuments: tierLimits.maxDocuments - totalDocuments,
      maxCollections: tierLimits.maxCollections,
      activeCollections: Object.keys(collectionStats).filter(k => collectionStats[k].documentCount > 0).length,
      status: usagePercent > 90 ? 'critical' : usagePercent > 75 ? 'warning' : 'healthy'
    },
    collections: collectionStats,
    entities: entityBreakdown
  }
}

async function collectEntityBreakdown (client) {
  try {
    const metaCol = await client.collection(COLLECTIONS.METADATA)
    const allMeta = await metaCol.find({}).toArray()
    const entities = allMeta.filter(m => m.status !== 'deleted')

    const versionCol = await client.collection(COLLECTIONS.VERSIONS)
    const allVersions = await versionCol.find({}).toArray()
    const versionsByEntity = {}
    for (const v of allVersions) {
      if (!versionsByEntity[v.masterName]) versionsByEntity[v.masterName] = 0
      versionsByEntity[v.masterName]++
    }

    const auditCol = await client.collection(COLLECTIONS.AUDIT)
    const allAudit = await auditCol.find({}).toArray()
    const auditByEntity = {}
    for (const a of allAudit) {
      if (a.masterName && a.type !== 'event') {
        if (!auditByEntity[a.masterName]) auditByEntity[a.masterName] = 0
        auditByEntity[a.masterName]++
      }
    }

    return entities.map(e => {
      const recordCount = e.recordCount || 0
      const versionCount = versionsByEntity[e.masterName] || 0
      const auditCount = auditByEntity[e.masterName] || 0
      const estimatedRecordBytes = recordCount * AVG_MASTER_DOC_SIZE
      const estimatedVersionBytes = versionCount * (AVG_DOC_SIZES[COLLECTIONS.VERSIONS] || 512)
      const totalBytes = estimatedRecordBytes + estimatedVersionBytes + (AVG_DOC_SIZES[COLLECTIONS.METADATA] || 2048)

      return {
        masterName: e.masterName,
        displayName: e.displayName || e.masterName,
        recordCount,
        versionCount,
        auditLogCount: auditCount,
        schemaFieldCount: (e.schema || []).length,
        visibility: e.visibility || 'private',
        crudEnabled: e.crudEnabled !== false,
        hasArchival: !!(e.archival && e.archival.enabled),
        primaryKey: e.primaryKey || 'N/A',
        estimatedStorageMB: parseFloat((totalBytes / (1024 * 1024)).toFixed(3)),
        estimatedRecordsMB: parseFloat((estimatedRecordBytes / (1024 * 1024)).toFixed(3)),
        createdAt: e.createdAt,
        updatedAt: e.updatedAt
      }
    }).sort((a, b) => b.estimatedStorageMB - a.estimatedStorageMB)
  } catch (e) {
    return []
  }
}

// ============================================================
// GUARDRAIL STATUS
// ============================================================

async function collectGuardrailStatus (client, settings, tierLimits, env) {
  env = env || {}
  const storage = await collectStorageMetrics(client, tierLimits)
  const dm = settings.dataManagement || {}
  const api = settings.api || {}
  const versioning = settings.versioning || {}
  const audit = settings.audit || {}
  const guardrailSettings = settings.guardrails || {}
  const guardrails = []

  guardrails.push({
    id: 'total-storage', name: 'Total DocDB Storage', category: 'storage',
    severity: storage.summary.storageUsagePercent > 90 ? 'critical' : storage.summary.storageUsagePercent > 75 ? 'warning' : 'healthy',
    current: storage.summary.totalEstimatedSizeMB, limit: tierLimits.maxStorageMB, unit: 'MB',
    usagePercent: storage.summary.storageUsagePercent,
    message: `${storage.summary.totalEstimatedSizeMB} MB of ${tierLimits.maxStorageMB} MB used`
  })

  guardrails.push({
    id: 'total-documents', name: 'Total Document Count', category: 'storage',
    severity: storage.summary.documentsUsagePercent > 90 ? 'critical' : storage.summary.documentsUsagePercent > 75 ? 'warning' : 'healthy',
    current: storage.summary.totalDocuments, limit: tierLimits.maxDocuments, unit: 'docs',
    usagePercent: storage.summary.documentsUsagePercent,
    message: `${storage.summary.totalDocuments.toLocaleString()} of ${tierLimits.maxDocuments.toLocaleString()} documents`
  })

  guardrails.push({
    id: 'collection-count', name: 'Collection Count', category: 'storage',
    severity: storage.summary.activeCollections >= tierLimits.maxCollections ? 'critical' : storage.summary.activeCollections >= tierLimits.maxCollections - 2 ? 'warning' : 'healthy',
    current: storage.summary.activeCollections, limit: tierLimits.maxCollections, unit: 'collections',
    usagePercent: parseFloat(((storage.summary.activeCollections / tierLimits.maxCollections) * 100).toFixed(1)),
    message: `${storage.summary.activeCollections} of ${tierLimits.maxCollections} collections in use`
  })

  const maxFileSizeMB = guardrailSettings.maxFileSizeMB || 10
  const potentialFiles = maxFileSizeMB > 0 ? Math.floor(tierLimits.maxStorageMB / maxFileSizeMB) : 0

  guardrails.push({
    id: 'max-file-size', name: 'Max Upload File Size', category: 'config', severity: 'info',
    current: maxFileSizeMB, limit: 100, unit: 'MB', usagePercent: 0,
    message: `Configured limit: ${maxFileSizeMB} MB per CSV upload — potential master files: ${potentialFiles}`
  })

  guardrails.push({
    id: 'rate-limit', name: 'API Rate Limit', category: 'api', severity: 'info',
    current: api.rateLimitPerMinute || env.rateLimitPerMinute || 1000, limit: 100000, unit: 'req/min', usagePercent: 0,
    message: `Configured: ${api.rateLimitPerMinute || env.rateLimitPerMinute || 1000} requests per minute`
  })

  guardrails.push({
    id: 'version-retention', name: 'Max Versions Per Entity', category: 'config', severity: 'info',
    current: versioning.maxVersionsPerEntity || env.maxVersionsPerEntity || 50, limit: 500, unit: 'versions', usagePercent: 0,
    message: `Configured: ${versioning.maxVersionsPerEntity || env.maxVersionsPerEntity || 50} versions retained per entity`
  })

  guardrails.push({
    id: 'audit-retention', name: 'Audit Log Retention', category: 'config',
    severity: audit.cleanupEnabled ? 'healthy' : 'warning',
    current: audit.retentionDays || env.auditRetentionDays || 90, limit: 730, unit: 'days', usagePercent: 0,
    message: audit.cleanupEnabled
      ? `Cleanup active: ${audit.retentionDays || env.auditRetentionDays || 90} days retention`
      : 'Audit cleanup disabled — logs accumulate indefinitely'
  })

  const maxFields = dm.maxSchemaFields || env.maxSchemaFields || 100
  for (const entity of storage.entities) {
    if (entity.schemaFieldCount > maxFields * 0.7) {
      guardrails.push({
        id: `master-fields-${entity.masterName}`, name: `Fields: ${entity.displayName}`, category: 'master',
        severity: entity.schemaFieldCount >= maxFields ? 'critical' : 'warning',
        current: entity.schemaFieldCount, limit: maxFields, unit: 'fields',
        usagePercent: parseFloat(((entity.schemaFieldCount / maxFields) * 100).toFixed(1)),
        message: `${entity.schemaFieldCount} of ${maxFields} max schema fields`
      })
    }
  }

  return {
    guardrails,
    overallStatus: guardrails.some(g => g.severity === 'critical') ? 'critical'
      : guardrails.some(g => g.severity === 'warning') ? 'warning' : 'healthy'
  }
}

// ============================================================
// FAILURE REPORT
// ============================================================

async function collectFailureReport (client, params) {
  const auditCol = await client.collection(COLLECTIONS.AUDIT)
  const days = parseInt(params.days) || 30
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceISO = since.toISOString()

  const allLogs = await auditCol.find({}).toArray()
  const recentLogs = allLogs.filter(l => l.timestamp && l.timestamp >= sinceISO && l.type !== 'event')
  const failures = recentLogs.filter(l => l.status === 'failure' || l.status === 'error')
  const successes = recentLogs.filter(l => l.status === 'success')

  const failuresByOperation = {}
  const failuresByEntity = {}
  const failuresByDay = {}
  const failuresByUser = {}

  for (const f of failures) {
    const op = f.operation || 'unknown'
    failuresByOperation[op] = (failuresByOperation[op] || 0) + 1
    const ent = f.masterName || '_system'
    failuresByEntity[ent] = (failuresByEntity[ent] || 0) + 1
    const day = (f.timestamp || '').substring(0, 10)
    if (day) failuresByDay[day] = (failuresByDay[day] || 0) + 1
    const user = f.actor || f.user || 'unknown'
    failuresByUser[user] = (failuresByUser[user] || 0) + 1
  }

  const operationStats = {}
  for (const log of recentLogs) {
    const op = log.operation || 'unknown'
    if (!operationStats[op]) operationStats[op] = { total: 0, success: 0, failure: 0, successRate: 0 }
    operationStats[op].total++
    if (log.status === 'success') operationStats[op].success++
    else if (log.status === 'failure' || log.status === 'error') operationStats[op].failure++
  }
  for (const op of Object.keys(operationStats)) {
    const s = operationStats[op]
    s.successRate = s.total > 0 ? parseFloat(((s.success / s.total) * 100).toFixed(1)) : 0
  }

  const recentFailures = failures
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    .slice(0, 50)
    .map(f => ({
      timestamp: f.timestamp, operation: f.operation, masterName: f.masterName,
      actor: f.actor || f.user, error: f.error || f.message || 'Unknown error',
      recordId: f.recordId || null
    }))

  return {
    period: { days, since: sinceISO },
    summary: {
      totalOperations: recentLogs.length,
      totalFailures: failures.length,
      totalSuccesses: successes.length,
      overallSuccessRate: recentLogs.length > 0 ? parseFloat(((successes.length / recentLogs.length) * 100).toFixed(1)) : 100,
      failureRate: recentLogs.length > 0 ? parseFloat(((failures.length / recentLogs.length) * 100).toFixed(1)) : 0
    },
    failuresByOperation, failuresByEntity, failuresByDay, failuresByUser, operationStats, recentFailures
  }
}

// ============================================================
// ACTION ANALYTICS
// ============================================================

async function collectAnalytics (client, params) {
  const auditCol = await client.collection(COLLECTIONS.AUDIT)
  const days = parseInt(params.days) || 30
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceISO = since.toISOString()

  const allLogs = await auditCol.find({}).toArray()
  const recentLogs = allLogs.filter(l => l.timestamp && l.timestamp >= sinceISO && l.type !== 'event')

  const invocationsByOperation = {}
  const invocationsByEntity = {}
  const invocationsByDay = {}
  const invocationsByUser = {}
  const hourlyDistribution = new Array(24).fill(0)
  const weekdayDistribution = new Array(7).fill(0)
  const READ_OPS = ['read', 'query', 'list', 'search', 'facets', 'dashboard', 'export']
  let readOps = 0
  let writeOps = 0
  let recordsAffected = 0

  for (const log of recentLogs) {
    const op = log.operation || 'unknown'
    invocationsByOperation[op] = (invocationsByOperation[op] || 0) + 1
    const ent = log.masterName || '_system'
    invocationsByEntity[ent] = (invocationsByEntity[ent] || 0) + 1
    const day = (log.timestamp || '').substring(0, 10)
    if (day) invocationsByDay[day] = (invocationsByDay[day] || 0) + 1
    const user = log.actor || log.user || 'unknown'
    invocationsByUser[user] = (invocationsByUser[user] || 0) + 1
    if (READ_OPS.some(r => op.toLowerCase().includes(r))) readOps++
    else writeOps++
    if (log.affectedRecords) recordsAffected += log.affectedRecords
    try {
      const d = new Date(log.timestamp)
      hourlyDistribution[d.getHours()]++
      weekdayDistribution[d.getDay()]++
    } catch (e) { /* skip */ }
  }

  const sortedDays = Object.entries(invocationsByDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }))
  const topMasters = Object.entries(invocationsByEntity).sort(([, a], [, b]) => b - a).slice(0, 10).map(([master, count]) => ({ master, count }))
  const topUsers = Object.entries(invocationsByUser).sort(([, a], [, b]) => b - a).slice(0, 10).map(([user, count]) => ({ user, count }))
  const peakHour = hourlyDistribution.indexOf(Math.max(...hourlyDistribution))
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const peakDayIdx = weekdayDistribution.indexOf(Math.max(...weekdayDistribution))

  return {
    period: { days, since: sinceISO },
    totalInvocations: recentLogs.length,
    avgDailyInvocations: sortedDays.length > 0 ? parseFloat((recentLogs.length / sortedDays.length).toFixed(1)) : 0,
    readOps, writeOps,
    readWriteRatio: writeOps > 0 ? `${(readOps / writeOps).toFixed(1)}:1` : 'read-only',
    totalRecordsAffected: recordsAffected,
    peakHourUTC: `${String(peakHour).padStart(2, '0')}:00`,
    peakDay: dayNames[peakDayIdx],
    invocationsByOperation, dailyTrend: sortedDays, hourlyDistribution, weekdayDistribution,
    topMasters, topUsers
  }
}

// ============================================================
// USAGE METRICS
// ============================================================

async function collectUsageMetrics (client, settings, tierLimits) {
  const storage = await collectStorageMetrics(client, tierLimits)
  const auditCol = await client.collection(COLLECTIONS.AUDIT)
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const sinceISO = since.toISOString()
  const allLogs = await auditCol.find({}).toArray()
  const recentLogs = allLogs.filter(l => l.timestamp && l.timestamp >= sinceISO && l.type !== 'event')

  const READ_OPS = ['read', 'query', 'list', 'search', 'facets', 'dashboard', 'export']
  let readOps = 0
  let writeOps = 0
  let totalRecordsAffected = 0
  const recordsByOperation = {}
  const entityGrowth = {}

  for (const log of recentLogs) {
    const op = (log.operation || '').toLowerCase()
    if (READ_OPS.some(r => op.includes(r))) readOps++
    else writeOps++
    if (log.affectedRecords) {
      totalRecordsAffected += log.affectedRecords
      recordsByOperation[log.operation] = (recordsByOperation[log.operation] || 0) + log.affectedRecords
    }
    if (log.masterName && log.masterName !== '_system' && log.affectedRecords) {
      if (['upload', 'full-update', 'delta-update', 'bulk-update', 'create-record'].includes(log.operation)) {
        entityGrowth[log.masterName] = (entityGrowth[log.masterName] || 0) + log.affectedRecords
      }
    }
  }

  const daysCovered = Math.max(1, Math.ceil((Date.now() - since.getTime()) / 86400000))
  const monthlyReadOps = Math.ceil((readOps / daysCovered) * 30)
  const monthlyWriteOps = Math.ceil((writeOps / daysCovered) * 30)
  const monthlyActivations = Math.ceil((recentLogs.length / daysCovered) * 30)

  const meshSettings = settings.api || {}
  const meshCacheTTL = meshSettings.apiMeshCacheTTL || 300
  const meshCacheEfficiency = meshCacheTTL > 0 ? Math.min(95, 50 + meshCacheTTL / 10) : 0

  const metaCol = await client.collection(COLLECTIONS.METADATA)
  const allMeta = await metaCol.find({}).toArray()
  const activeMeta = allMeta.filter(m => m.status !== 'deleted')
  const entitiesCreatedRecently = activeMeta.filter(m => m.createdAt && m.createdAt >= sinceISO).length

  const auditGrowthPerDay = recentLogs.length > 0 ? parseFloat((recentLogs.length / daysCovered).toFixed(1)) : 0
  const auditDocsTotal = storage.collections?.[COLLECTIONS.AUDIT]?.documentCount || 0
  const daysUntilAuditFull = auditGrowthPerDay > 0
    ? Math.floor((storage.summary.remainingDocuments * 0.3) / auditGrowthPerDay)
    : null

  const versionTotal = storage.collections?.[COLLECTIONS.VERSIONS]?.documentCount || 0
  const versionsPerEntity = activeMeta.length > 0 ? parseFloat((versionTotal / activeMeta.length).toFixed(1)) : 0
  const maxVersionsPerEntity = settings.versioning?.maxVersionsPerEntity || 50

  const currentStorageMB = storage.summary.totalEstimatedSizeMB
  const projectedRecordsPerMonth = totalRecordsAffected > 0 ? Math.ceil((totalRecordsAffected / daysCovered) * 30) : 0
  const projectedStorageGrowthMB = parseFloat(((projectedRecordsPerMonth * 1) / 1024).toFixed(3))
  const monthsUntilStorageFull = projectedStorageGrowthMB > 0
    ? Math.floor(storage.summary.remainingStorageMB / projectedStorageGrowthMB) : null

  return {
    throughput: {
      last30Days: {
        totalOperations: recentLogs.length, readOperations: readOps, writeOperations: writeOps,
        readWriteRatio: writeOps > 0 ? `${(readOps / writeOps).toFixed(1)}:1` : 'read-only',
        totalRecordsAffected,
        avgOperationsPerDay: parseFloat((recentLogs.length / daysCovered).toFixed(1)),
        avgRecordsPerDay: parseFloat((totalRecordsAffected / daysCovered).toFixed(1))
      },
      projectedMonthly: {
        readOperations: monthlyReadOps, writeOperations: monthlyWriteOps,
        totalActivations: monthlyActivations, recordsThroughput: projectedRecordsPerMonth
      },
      recordsByOperation
    },
    entityMetrics: {
      totalEntities: activeMeta.length,
      publicEntities: activeMeta.filter(m => m.visibility === 'public').length,
      privateEntities: activeMeta.filter(m => m.visibility === 'private').length,
      crudEnabledEntities: activeMeta.filter(m => m.crudEnabled !== false).length,
      entitiesWithArchival: activeMeta.filter(m => m.archival?.enabled).length,
      newEntitiesLast30d: entitiesCreatedRecently,
      entityGrowth: Object.entries(entityGrowth).sort(([, a], [, b]) => b - a)
        .map(([entity, records]) => ({ entity, recordsAdded: records }))
    },
    apiMesh: {
      cacheTTL: meshCacheTTL,
      estimatedCacheHitRate: `${meshCacheEfficiency}%`,
      maxPageSize: meshSettings.maxPageSize || 100,
      rateLimitPerMinute: meshSettings.rateLimitPerMinute || 1000,
      enableCORS: meshSettings.enableCORS !== false,
      corsOrigins: meshSettings.corsOrigins || '*',
      recommendation: meshCacheTTL < 60
        ? 'Consider increasing cache TTL to reduce origin requests'
        : meshCacheTTL < 300 ? 'Good cache TTL — consider increasing for static datasets'
          : 'Excellent cache TTL for optimal performance'
    },
    storageProjections: {
      currentStorageMB, maxStorageMB: tierLimits.maxStorageMB,
      projectedMonthlyGrowthMB: projectedStorageGrowthMB,
      monthsUntilFull: monthsUntilStorageFull,
      currentDocuments: storage.summary.totalDocuments,
      maxDocuments: tierLimits.maxDocuments,
      auditGrowthPerDay, auditDocsTotal,
      daysUntilAuditBudgetExhausted: daysUntilAuditFull,
      versionDocsTotal: versionTotal,
      avgVersionsPerEntity: versionsPerEntity,
      maxVersionsPerEntity
    },
    recommendations: generateRecommendations(storage, settings, monthlyActivations, auditGrowthPerDay, versionsPerEntity, meshCacheTTL)
  }
}

function generateRecommendations (storage, settings, monthlyActivations, auditGrowthPerDay, versionsPerEntity, cacheTTL) {
  const recs = []
  if (storage.summary.storageUsagePercent > 75) {
    recs.push({ severity: 'critical', area: 'storage', message: `Storage at ${storage.summary.storageUsagePercent}% capacity. Archive old data or enable audit cleanup to free space.` })
  }
  if (storage.summary.documentsUsagePercent > 75) {
    recs.push({ severity: 'critical', area: 'documents', message: `Document count at ${storage.summary.documentsUsagePercent}% capacity. Consider pruning old versions or audit logs.` })
  }
  if (!settings.audit?.cleanupEnabled) {
    recs.push({ severity: 'warning', area: 'audit', message: 'Audit log cleanup is disabled. Logs accumulate indefinitely and consume storage.' })
  }
  if (auditGrowthPerDay > 100) {
    recs.push({ severity: 'warning', area: 'audit', message: `High audit log growth (${auditGrowthPerDay}/day). Enable cleanup or reduce retention period.` })
  }
  const versionCount = storage.collections?.[COLLECTIONS.VERSIONS]?.documentCount || 0
  if (versionCount > 1000) {
    recs.push({ severity: 'warning', area: 'versioning', message: `${versionCount} version documents stored. Consider reducing maxVersionsPerEntity to free space.` })
  }
  if (versionsPerEntity > 30) {
    recs.push({ severity: 'info', area: 'versioning', message: `Avg ${versionsPerEntity} versions per entity. Lower retention if older versions are not needed.` })
  }
  if (monthlyActivations > 50000) {
    recs.push({ severity: 'info', area: 'performance', message: 'High activation volume. Ensure API Mesh CDN caching is optimized to reduce backend load.' })
  }
  if (cacheTTL < 60) {
    recs.push({ severity: 'warning', area: 'api-mesh', message: `Cache TTL is only ${cacheTTL}s. Increase it to reduce origin requests and improve performance.` })
  }
  if (storage.summary.storageUsagePercent < 25 && monthlyActivations < 5000) {
    recs.push({ severity: 'info', area: 'utilization', message: 'Low utilization detected. Infrastructure is well within capacity.' })
  }
  return recs
}

// ============================================================
// OVERVIEW (combined)
// ============================================================

async function collectOverview (client, settings, tierLimits, params) {
  const env = getEnvConfig(params)
  const storage = await collectStorageMetrics(client, tierLimits)
  const guardrails = await collectGuardrailStatus(client, settings, tierLimits, env)
  const failures = await collectFailureReport(client, { days: 30 })
  const usage = await collectUsageMetrics(client, settings, tierLimits)

  const meshConfig = {
    cacheTTL: settings.api?.apiMeshCacheTTL || env.apiMeshCacheTTL,
    rateLimitPerMinute: settings.api?.rateLimitPerMinute || env.rateLimitPerMinute,
    enableCORS: settings.api?.enableCORS !== false,
    corsOrigins: settings.api?.corsOrigins || '*',
    maxPageSize: settings.api?.maxPageSize || env.maxPageSize
  }

  return {
    timestamp: getTimezoneDate(),
    storage, guardrails,
    failures: { summary: failures.summary, recentFailures: failures.recentFailures.slice(0, 10) },
    usage, apiMesh: meshConfig,
    health: {
      database: storage.summary.status === 'critical' ? 'degraded' : 'healthy',
      guardrails: guardrails.overallStatus,
      operations: failures.summary.failureRate > 10 ? 'degraded' : 'healthy',
      apiMesh: meshConfig.cacheTTL > 0 ? 'healthy' : 'degraded'
    }
  }
}

exports.main = main