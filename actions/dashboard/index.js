/**
 * MDM Dashboard Stats Action
 * Returns summary statistics for the admin dashboard.
 * Uses a cache layer (dashboard-cache in settings collection) for fast loads.
 * Cache is invalidated automatically on data mutations and refreshed every 30 min.
 */

const { getDbClient, safeFindOne, COLLECTIONS, createResponse, createErrorResponse, validateIMSToken, getEnvConfig, getStateClient, getTimezoneDate } = require('../mdm-utils')

const DASHBOARD_CACHE_KEY = 'dashboard-cache'

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
  const forceRefresh = isScheduledRefresh || params.forceRefresh === true || params.forceRefresh === 'true'

  let client
  try {
    client = await getDbClient(params)

    // Serve from aio-lib-state cache unless forced refresh
    if (!forceRefresh) {
      const cached = await getCachedDashboard()
      if (cached) {
        return createResponse({ dashboard: cached.data, _cached: true, _cachedAt: cached.cachedAt })
      }
    }

    // Compute fresh dashboard data
    const dashboard = await computeDashboard(client)

    // Cache the result in aio-lib-state
    await cacheDashboard(dashboard, CACHE_TTL_SECONDS)

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
  const versionCol = await client.collection(COLLECTIONS.VERSIONS)

  const allFiles = await metaCol.find({ status: { $ne: 'deleted' } }).toArray()
  const files = allFiles.filter(f => f.status !== 'deleted')

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

  const recentLogs = await auditCol.find({})
    .sort({ timestamp: -1 })
    .limit(10)
    .toArray()

  const auditAlerts = await auditCol.countDocuments({ status: 'failure' })
  const totalVersions = await versionCol.estimatedDocumentCount()

  return {
    totalFiles: files.length,
    publicApis,
    privateApis,
    totalRecords,
    totalVersions,
    auditAlerts,
    recentUploads: recentUploads.slice(0, 5),
    recentLogs
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
