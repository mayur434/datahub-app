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

const { getDbClient, safeFindOne, COLLECTIONS, createResponse, createErrorResponse, validateIMSToken, getUserFromParams, getEnvConfig, getStateClient, getCachedSettings, getTimezoneDate, enforceAppPermission } = require('../mdm-utils')

const SETTINGS_DOC_ID = 'app-settings'
const METRICS_CACHE_KEY = 'metrics-cache'

const AVG_DOC_SIZES = {
  [COLLECTIONS.METADATA]: 2048,
  [COLLECTIONS.AUDIT]: 384,
  [COLLECTIONS.SETTINGS]: 2048,
  [COLLECTIONS.ARCHIVES]: 1024,
  [COLLECTIONS.ROLES]: 256
}

const AVG_MASTER_DOC_SIZE = 1024

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  const env = getEnvConfig(params)
  const CACHE_TTL_SECONDS = env.metricsCacheTTLMinutes * 60
  const report = (params.report || 'overview').toLowerCase()
  const forceRefresh = params.forceRefresh === true || params.forceRefresh === 'true'

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

    // App-level RBAC
    const appPerm = await enforceAppPermission(client, params, 'infra-metrics')
    if (!appPerm.allowed) return appPerm.response

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
        result = { usage: await collectUsageMetrics(client, settings, tierLimits, env) }
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
    const allMeta = await metaCol.find({ status: { $ne: 'deleted' } }).toArray()
    const entities = allMeta

    const auditCol = await client.collection(COLLECTIONS.AUDIT)

    // Use aggregation pipeline to count audit logs per entity
    const auditCounts = await auditCol.aggregate()
      .match({ type: { $ne: 'event' }, masterName: { $exists: true } })
      .group({ _id: '$masterName', count: { $sum: 1 } })
      .toArray()
    const auditByEntity = {}
    for (const a of auditCounts) {
      auditByEntity[a._id] = a.count
    }

    return entities.map(e => {
      const recordCount = e.recordCount || 0
      const auditCount = auditByEntity[e.masterName] || 0
      const estimatedRecordBytes = recordCount * AVG_MASTER_DOC_SIZE
      const totalBytes = estimatedRecordBytes + (AVG_DOC_SIZES[COLLECTIONS.METADATA] || 2048)

      return {
        masterName: e.masterName,
        displayName: e.displayName || e.masterName,
        recordCount,
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
    current: env.rateLimitPerMinute, limit: 100000, unit: 'req/min', usagePercent: 0,
    message: `Configured: ${env.rateLimitPerMinute} requests per minute`
  })

  guardrails.push({
    id: 'audit-retention', name: 'Audit Log Retention', category: 'config',
    severity: (audit.enabled !== false) ? 'healthy' : 'warning',
    current: env.auditRetentionDays, limit: 730, unit: 'days', usagePercent: 0,
    message: (audit.enabled !== false)
      ? `Auditing active: ${env.auditRetentionDays} days retention`
      : 'Auditing disabled — no logs being written'
  })

  const maxFields = env.maxSchemaFields
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

  const dateFilter = { timestamp: { $gte: sinceISO }, type: { $ne: 'event' } }

  // Use aggregation $facet to compute all stats in a single DB round-trip
  const facetResult = await auditCol.aggregate()
    .match(dateFilter)
    .group({
      _id: {
        operation: { $ifNull: ['$operation', 'unknown'] },
        status: { $ifNull: ['$status', 'unknown'] },
        masterName: { $ifNull: ['$masterName', '_system'] },
        day: { $substrBytes: [{ $ifNull: ['$timestamp', ''] }, 0, 10] },
        actor: { $ifNull: [{ $ifNull: ['$actor', '$user'] }, 'unknown'] }
      },
      count: { $sum: 1 }
    })
    .toArray()

  // Compute stats from grouped results
  let totalOps = 0, totalFailures = 0, totalSuccesses = 0
  const failuresByOperation = {}
  const failuresByEntity = {}
  const failuresByDay = {}
  const failuresByUser = {}
  const operationStats = {}

  for (const bucket of facetResult) {
    const { operation, status, masterName, day, actor } = bucket._id
    const count = bucket.count
    totalOps += count

    if (!operationStats[operation]) operationStats[operation] = { total: 0, success: 0, failure: 0, successRate: 0 }
    operationStats[operation].total += count

    if (status === 'success') {
      totalSuccesses += count
      operationStats[operation].success += count
    } else if (status === 'failure' || status === 'error') {
      totalFailures += count
      operationStats[operation].failure += count
      failuresByOperation[operation] = (failuresByOperation[operation] || 0) + count
      failuresByEntity[masterName] = (failuresByEntity[masterName] || 0) + count
      if (day) failuresByDay[day] = (failuresByDay[day] || 0) + count
      failuresByUser[actor] = (failuresByUser[actor] || 0) + count
    }
  }

  for (const op of Object.keys(operationStats)) {
    const s = operationStats[op]
    s.successRate = s.total > 0 ? parseFloat(((s.success / s.total) * 100).toFixed(1)) : 0
  }

  // Fetch only the recent failure documents (limited) for the detail list
  const recentFailures = await auditCol.find({
    ...dateFilter,
    $or: [{ status: 'failure' }, { status: 'error' }]
  })
    .sort({ timestamp: -1 })
    .limit(50)
    .toArray()
    .then(docs => docs.map(f => ({
      timestamp: f.timestamp, operation: f.operation, masterName: f.masterName,
      actor: f.actor || f.user, error: f.error || f.message || 'Unknown error',
      recordId: f.recordId || null
    })))

  return {
    period: { days, since: sinceISO },
    summary: {
      totalOperations: totalOps,
      totalFailures,
      totalSuccesses,
      overallSuccessRate: totalOps > 0 ? parseFloat(((totalSuccesses / totalOps) * 100).toFixed(1)) : 100,
      failureRate: totalOps > 0 ? parseFloat(((totalFailures / totalOps) * 100).toFixed(1)) : 0
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

  const dateFilter = { timestamp: { $gte: sinceISO }, type: { $ne: 'event' } }

  // Use aggregation to compute grouped stats in a single DB round-trip
  const groupedStats = await auditCol.aggregate()
    .match(dateFilter)
    .group({
      _id: {
        operation: { $ifNull: ['$operation', 'unknown'] },
        masterName: { $ifNull: ['$masterName', '_system'] },
        day: { $substrBytes: [{ $ifNull: ['$timestamp', ''] }, 0, 10] },
        actor: { $ifNull: [{ $ifNull: ['$actor', '$user'] }, 'unknown'] }
      },
      count: { $sum: 1 },
      recordsAffected: { $sum: { $ifNull: ['$affectedRecords', 0] } }
    })
    .toArray()

  const READ_OPS = ['read', 'query', 'list', 'search', 'facets', 'dashboard', 'export']
  const invocationsByOperation = {}
  const invocationsByEntity = {}
  const invocationsByDay = {}
  const invocationsByUser = {}
  let readOps = 0
  let writeOps = 0
  let recordsAffected = 0
  let totalInvocations = 0

  for (const bucket of groupedStats) {
    const { operation, masterName, day, actor } = bucket._id
    const count = bucket.count
    totalInvocations += count
    recordsAffected += bucket.recordsAffected

    invocationsByOperation[operation] = (invocationsByOperation[operation] || 0) + count
    invocationsByEntity[masterName] = (invocationsByEntity[masterName] || 0) + count
    if (day) invocationsByDay[day] = (invocationsByDay[day] || 0) + count
    invocationsByUser[actor] = (invocationsByUser[actor] || 0) + count

    if (operation && READ_OPS.some(r => operation.toLowerCase().includes(r))) readOps += count
    else writeOps += count
  }

  // Fetch hourly/weekday distributions via separate lightweight aggregation
  const hourlyWeekday = await auditCol.find(dateFilter)
    .sort({ timestamp: -1 })
    .limit(5000)
    .toArray()

  const hourlyDistribution = new Array(24).fill(0)
  const weekdayDistribution = new Array(7).fill(0)
  for (const log of hourlyWeekday) {
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
    totalInvocations,
    avgDailyInvocations: sortedDays.length > 0 ? parseFloat((totalInvocations / sortedDays.length).toFixed(1)) : 0,
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

async function collectUsageMetrics (client, settings, tierLimits, env) {
  const storage = await collectStorageMetrics(client, tierLimits)
  const auditCol = await client.collection(COLLECTIONS.AUDIT)
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const sinceISO = since.toISOString()
  const dateFilter = { timestamp: { $gte: sinceISO }, type: { $ne: 'event' } }

  // Use aggregation to compute stats in a single DB round-trip instead of full scan
  const GROWTH_OPS = ['upload', 'full-update', 'delta-update', 'bulk-update', 'create-record']
  const usageAgg = await auditCol.aggregate()
    .match(dateFilter)
    .group({
      _id: {
        operation: { $ifNull: ['$operation', 'unknown'] },
        masterName: { $ifNull: ['$masterName', '_system'] }
      },
      count: { $sum: 1 },
      recordsAffected: { $sum: { $ifNull: ['$affectedRecords', 0] } }
    })
    .toArray()

  const READ_OPS = ['read', 'query', 'list', 'search', 'facets', 'dashboard', 'export']
  let readOps = 0
  let writeOps = 0
  let totalRecordsAffected = 0
  let totalLogs = 0
  const recordsByOperation = {}
  const entityGrowth = {}

  for (const bucket of usageAgg) {
    const op = (bucket._id.operation || '').toLowerCase()
    const masterName = bucket._id.masterName
    const count = bucket.count
    totalLogs += count
    totalRecordsAffected += bucket.recordsAffected

    if (READ_OPS.some(r => op.includes(r))) readOps += count
    else writeOps += count

    if (bucket.recordsAffected > 0) {
      recordsByOperation[bucket._id.operation] = (recordsByOperation[bucket._id.operation] || 0) + bucket.recordsAffected
    }

    if (masterName && masterName !== '_system' && bucket.recordsAffected > 0 && GROWTH_OPS.includes(bucket._id.operation)) {
      entityGrowth[masterName] = (entityGrowth[masterName] || 0) + bucket.recordsAffected
    }
  }

  const daysCovered = Math.max(1, Math.ceil((Date.now() - since.getTime()) / 86400000))
  const monthlyReadOps = Math.ceil((readOps / daysCovered) * 30)
  const monthlyWriteOps = Math.ceil((writeOps / daysCovered) * 30)
  const monthlyActivations = Math.ceil((totalLogs / daysCovered) * 30)

  const meshSettings = settings.api || {}
  const meshCacheTTL = env.apiMeshCacheTTL
  const meshCacheEfficiency = meshCacheTTL > 0 ? Math.min(95, 50 + meshCacheTTL / 10) : 0

  const metaCol = await client.collection(COLLECTIONS.METADATA)
  const allMeta = await metaCol.find({ status: { $ne: 'deleted' } }).toArray()
  const activeMeta = allMeta
  const entitiesCreatedRecently = activeMeta.filter(m => m.createdAt && m.createdAt >= sinceISO).length

  const auditGrowthPerDay = totalLogs > 0 ? parseFloat((totalLogs / daysCovered).toFixed(1)) : 0
  const auditDocsTotal = storage.collections?.[COLLECTIONS.AUDIT]?.documentCount || 0
  const daysUntilAuditFull = auditGrowthPerDay > 0
    ? Math.floor((storage.summary.remainingDocuments * 0.3) / auditGrowthPerDay)
    : null

  const currentStorageMB = storage.summary.totalEstimatedSizeMB
  const projectedRecordsPerMonth = totalRecordsAffected > 0 ? Math.ceil((totalRecordsAffected / daysCovered) * 30) : 0
  const projectedStorageGrowthMB = parseFloat(((projectedRecordsPerMonth * 1) / 1024).toFixed(3))
  const monthsUntilStorageFull = projectedStorageGrowthMB > 0
    ? Math.floor(storage.summary.remainingStorageMB / projectedStorageGrowthMB) : null

  return {
    throughput: {
      last30Days: {
        totalOperations: totalLogs, readOperations: readOps, writeOperations: writeOps,
        readWriteRatio: writeOps > 0 ? `${(readOps / writeOps).toFixed(1)}:1` : 'read-only',
        totalRecordsAffected,
        avgOperationsPerDay: parseFloat((totalLogs / daysCovered).toFixed(1)),
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
      maxPageSize: env.maxPageSize,
      rateLimitPerMinute: env.rateLimitPerMinute,
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
      daysUntilAuditBudgetExhausted: daysUntilAuditFull
    },
    recommendations: generateRecommendations(storage, settings, monthlyActivations, auditGrowthPerDay, meshCacheTTL)
  }
}

function generateRecommendations (storage, settings, monthlyActivations, auditGrowthPerDay, cacheTTL) {
  const recs = []
  if (storage.summary.storageUsagePercent > 75) {
    recs.push({ severity: 'critical', area: 'storage', message: `Storage at ${storage.summary.storageUsagePercent}% capacity. Archive old data or enable audit cleanup to free space.` })
  }
  if (storage.summary.documentsUsagePercent > 75) {
    recs.push({ severity: 'critical', area: 'documents', message: `Document count at ${storage.summary.documentsUsagePercent}% capacity. Consider pruning audit logs.` })
  }
  if (settings.audit?.enabled === false) {
    recs.push({ severity: 'warning', area: 'audit', message: 'Auditing is disabled. No audit trail is being recorded.' })
  }
  if (auditGrowthPerDay > 100) {
    recs.push({ severity: 'warning', area: 'audit', message: `High audit log growth (${auditGrowthPerDay}/day). Enable cleanup or reduce retention period.` })
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
  const usage = await collectUsageMetrics(client, settings, tierLimits, env)

  const meshConfig = {
    cacheTTL: env.apiMeshCacheTTL,
    rateLimitPerMinute: env.rateLimitPerMinute,
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