/**
 * MDM Dashboard Stats Action
 * Returns summary statistics for the admin dashboard.
 * Uses aio-lib-state cache with TTL-based expiry for fast loads.
 * On cache miss: computes fresh data, caches it, and serves.
 * Cache auto-refreshes every METRICS_CACHE_TTL_MINUTES (default 15 min).
 *
 * Performance:
 *   - Cache check runs in parallel with DB connect + RBAC to cut latency
 *   - Single state client instance reused across all state ops
 *   - On cache hit, DB connection is still established for RBAC but dashboard data served from cache
 */

const { getDbClient, safeFindOne, COLLECTIONS, createResponse, createErrorResponse, validateIMSToken, getEnvConfig, getStateClient, getTimezoneDate, enforceAppPermission } = require('../mdm-utils')

const DASHBOARD_CACHE_KEY = 'dashboard-cache'

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  const env = getEnvConfig(params)
  const CACHE_TTL_SECONDS = env.metricsCacheTTLMinutes * 60
  const forceRefresh = params.forceRefresh === true || params.forceRefresh === 'true'

  let client
  try {
    // Run DB connect, RBAC, and cache check in parallel
    // Cache check doesn't need DB — fire it alongside the slow DB connect
    const [dbClient, cached] = await Promise.all([
      getDbClient(params),
      forceRefresh ? Promise.resolve(null) : getCachedDashboard()
    ])
    client = dbClient

    // RBAC still required even on cache hit (auth gate)
    const appPerm = await enforceAppPermission(client, params, 'dashboard')
    if (!appPerm.allowed) return appPerm.response

    // Serve from cache if available
    if (cached) {
      return createResponse({ dashboard: cached.data, _cached: true, _cachedAt: cached.cachedAt })
    }

    // Compute fresh dashboard data
    const dashboard = await computeDashboard(client)

    // Cache the result — fire and don't await (best-effort, non-blocking)
    cacheDashboard(dashboard, CACHE_TTL_SECONDS).catch(() => {})

    return createResponse({ dashboard, _cached: false, _cachedAt: getTimezoneDate(params) })
  } catch (error) {
    console.error('Dashboard error:', error)
    return createErrorResponse(`Dashboard failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

async function computeDashboard (client) {
  const metaCol = await client.collection(COLLECTIONS.METADATA)
  const auditCol = await client.collection(COLLECTIONS.AUDIT)

  // Run all three queries in parallel
  const [files, recentLogs, auditAlerts] = await Promise.all([
    metaCol.find({ status: { $ne: 'deleted' } }).toArray(),
    auditCol.find({}).sort({ timestamp: -1 }).limit(10).toArray(),
    auditCol.countDocuments({ status: 'failure' })
  ])

  let totalRecords = 0
  let publicApis = 0
  let privateApis = 0
  const recentUploads = []

  for (const file of files) {
    totalRecords += file.recordCount || 0
    if (file.visibility === 'public') publicApis++
    else privateApis++
    recentUploads.push({
      masterName: file.masterName,
      displayName: file.displayName,
      updatedAt: file.updatedAt,
      recordCount: file.recordCount
    })
  }

  recentUploads.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))

  return {
    totalFiles: files.length,
    publicApis,
    privateApis,
    totalRecords,
    auditAlerts,
    recentUploads: recentUploads.slice(0, 5),
    recentLogs,
    masters: files.map(f => ({
      masterName: f.masterName,
      displayName: f.displayName,
      description: f.description,
      visibility: f.visibility,
      status: f.status,
      crudEnabled: f.crudEnabled,
      recordCount: f.recordCount,
      updatedAt: f.updatedAt
    }))
  }
}

async function getCachedDashboard () {
  try {
    const state = await getStateClient()
    const entry = await state.get(DASHBOARD_CACHE_KEY)
    if (!entry || !entry.value) return null
    return JSON.parse(entry.value)
  } catch (e) {
    return null
  }
}

async function cacheDashboard (data, ttlSeconds) {
  try {
    const state = await getStateClient()
    const cacheDoc = { data, cachedAt: getTimezoneDate() }
    await state.put(DASHBOARD_CACHE_KEY, JSON.stringify(cacheDoc), { ttl: Math.ceil(ttlSeconds) })
  } catch (e) {
    console.error('Failed to cache dashboard:', e.message)
  }
}

exports.main = main
