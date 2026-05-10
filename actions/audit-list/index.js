/**
 * MDM Audit List Action
 * Query audit logs with filtering, pagination, and sorting.
 * Also supports type=archives to list audit archive files.
 * Returns normalized log entries from aio-lib-db audit collection.
 */

const { getDbClient, COLLECTIONS, createResponse, createErrorResponse, validateIMSToken, getEnvConfig, getCachedSettings, enforceAppPermission } = require('../mdm-utils')
const stateLib = require('@adobe/aio-lib-state')

const MASTERS_CACHE_KEY = 'audit-masters'

async function getStateClient () {
  if (!getStateClient._promise) {
    getStateClient._promise = stateLib.init().catch(err => {
      getStateClient._promise = null
      throw err
    })
  }
  return getStateClient._promise
}

async function getCachedMasters () {
  try {
    const state = await getStateClient()
    const entry = await state.get(MASTERS_CACHE_KEY)
    if (entry && entry.value) return JSON.parse(entry.value)
  } catch (e) { /* cache miss */ }
  return null
}

async function cacheMasters (masters, ttlSeconds) {
  try {
    const state = await getStateClient()
    await state.put(MASTERS_CACHE_KEY, JSON.stringify(masters), { ttl: ttlSeconds })
  } catch (e) { /* best-effort */ }
}

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    client = await getDbClient(params)

    // Run RBAC, settings, collection handle, and masters cache in parallel
    const [appPerm, settingsDoc, auditCol, cachedMasters] = await Promise.all([
      enforceAppPermission(client, params, 'audit-list'),
      getCachedSettings(client),
      client.collection(COLLECTIONS.AUDIT),
      getCachedMasters()
    ])

    if (!appPerm.allowed) return appPerm.response

    // Route to archives listing if type=archives (reuse DB connection)
    if (params.type === 'archives') {
      return await handleArchivesList(params, client, settingsDoc)
    }

    const entity = params.master || params.entity
    const operation = params.action || params.operation
    const actor = params.user || params.actor
    const { status, page, pageSize, startDate, endDate } = params

    // Build DB-safe filter (only simple equality filters for aio-lib-db compatibility)
    const filter = {}
    if (entity) filter.masterName = entity
    if (status) filter.status = status

    // Date range filter
    if (startDate || endDate) {
      filter.timestamp = {}
      if (startDate) filter.timestamp.$gte = startDate
      if (endDate) filter.timestamp.$lte = endDate
    }

    // Pagination — use settings-configured limits
    const env = getEnvConfig(params)
    const apiSettings = settingsDoc?.api || {}
    const maxPageSize = apiSettings.maxPageSize || env.maxPageSize
    const defaultPageSize = apiSettings.defaultPageSize || env.defaultPageSize

    const p = Math.max(1, parseInt(page) || 1)
    const ps = Math.min(maxPageSize, Math.max(1, parseInt(pageSize) || defaultPageSize))

    // Build effective filter (may include $regex for operation/actor)
    let effectiveFilter = filter

    if (operation || actor) {
      effectiveFilter = { ...filter }

      if (operation) {
        effectiveFilter.$or = [
          { operation: { $regex: operation, $options: 'i' } },
          { action: { $regex: operation, $options: 'i' } }
        ]
      }

      if (actor) {
        const actorConditions = [
          { actor: { $regex: actor, $options: 'i' } },
          { user: { $regex: actor, $options: 'i' } }
        ]
        if (effectiveFilter.$or) {
          effectiveFilter.$and = [
            { $or: effectiveFilter.$or },
            { $or: actorConditions }
          ]
          delete effectiveFilter.$or
        } else {
          effectiveFilter.$or = actorConditions
        }
      }
    }

    // Run count and paginated fetch in parallel
    const [countResult, rawLogs] = await Promise.all([
      auditCol.countDocuments(effectiveFilter),
      auditCol.find(effectiveFilter)
        .sort({ timestamp: -1 })
        .skip((p - 1) * ps)
        .limit(ps)
        .toArray()
    ])

    const total = countResult

    // Build masters list: use cache if available, otherwise extract from current page
    // and refresh cache in background from distinct query
    let masters = cachedMasters
    if (!masters) {
      // Extract unique masters from current results as immediate fallback
      masters = [...new Set(rawLogs.map(l => l.masterName).filter(Boolean))].sort()
      // Refresh cache in background from full distinct query
      const mastersCacheTTL = env.auditMastersCacheTTLSeconds
      auditCol.distinct('masterName')
        .then(all => cacheMasters(all.filter(Boolean).sort(), mastersCacheTTL))
        .catch(() => cacheMasters(masters, mastersCacheTTL))
    }

    return createResponse({
      logs: rawLogs.map(normalizLog),
      page: p,
      pageSize: ps,
      total,
      masters
    })
  } catch (error) {
    console.error('Audit list error:', error)
    return createErrorResponse(`Failed to list audit logs: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

/** Normalize a raw audit-log document for frontend consumption */
function normalizLog (log) {
  const { _id, masterName, operation: op, action: act, actor: usr, user: usr2, status: s, timestamp, ...rest } = log
  const operation = op || act || 'unknown'
  const user = usr || usr2 || 'system'
  return {
    id: _id || `${timestamp}-${masterName}-${operation}`,
    timestamp: timestamp || null,
    master: masterName || '_system',
    action: operation,
    operation,
    user,
    actor: user,
    status: s || 'unknown',
    details: rest
  }
}

/** List audit archive files from audit_archives collection */
async function handleArchivesList (params, client, settingsDoc) {
  const { status, page, pageSize } = params

  const archivesCol = await client.collection(COLLECTIONS.AUDIT_ARCHIVES)

  // Build filter
  const filter = {}
  if (status) {
    filter.status = status
  }

  // Pagination
  const env = getEnvConfig(params)
  const apiSettings = settingsDoc?.api || {}
  const maxPageSize = apiSettings.maxPageSize || env.maxPageSize
  const defaultPageSize = apiSettings.defaultPageSize || env.defaultPageSize

  const p = Math.max(1, parseInt(page) || 1)
  const ps = Math.min(maxPageSize, Math.max(1, parseInt(pageSize) || defaultPageSize))

  // Run count and fetch in parallel
  const [total, archives] = await Promise.all([
    archivesCol.countDocuments(filter),
    archivesCol.find(filter)
      .sort({ archivedAt: -1 })
      .skip((p - 1) * ps)
      .limit(ps)
      .toArray()
  ])

  // Enrich with computed fields and strip internal DB id
  const now = new Date()
  const enrichedArchives = archives.map(({ _id, ...a }) => ({
    ...a,
    isExpired: a.status === 'expired' || new Date(a.expiresAt) < now,
    daysUntilExpiry: Math.max(0, Math.ceil((new Date(a.expiresAt) - now) / 86400000))
  }))

  // Summary
  const summary = {
    totalArchives: total,
    totalRecords: archives.reduce((sum, a) => sum + (a.recordCount || 0), 0),
    totalSizeBytes: archives.reduce((sum, a) => sum + (a.sizeBytes || 0), 0)
  }

  return createResponse({
    archives: enrichedArchives,
    summary,
    page: p,
    pageSize: ps,
    total
  })
}

exports.main = main
