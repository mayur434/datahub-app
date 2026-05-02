/**
 * MDM Archive List Action
 * Returns archives for a specific entity or all entities.
 * Supports filtering by status, date range, and pagination.
 */

const { getDbClient, safeFindOne, COLLECTIONS, createResponse, createErrorResponse, validateIMSToken, getUserFromParams, getEnvConfig, getCachedSettings } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const entity = params.master || params.entity
    const { status, page, pageSize, startDate, endDate } = params

    client = await getDbClient(params)
    const archivesCol = await client.collection(COLLECTIONS.ARCHIVES)
    const metaCol = await client.collection(COLLECTIONS.METADATA)

    // Build query filter
    const filter = {}
    if (entity) {
      filter.masterName = entity
    }
    if (status) {
      filter.status = status
    } else {
      // Default: show active and expired (not deleted)
      filter.status = { $in: ['active', 'expired'] }
    }
    if (startDate || endDate) {
      filter.archivedAt = {}
      if (startDate) filter.archivedAt.$gte = startDate
      if (endDate) filter.archivedAt.$lte = endDate
    }

    // Pagination — use settings-configured limits
    const settingsDoc = await getCachedSettings(client)
    const apiSettings = settingsDoc?.api || {}
    const env = getEnvConfig(params)
    const maxPageSize = apiSettings.maxPageSize || env.maxPageSize
    const defaultPageSize = apiSettings.defaultPageSize || env.defaultPageSize

    const p = Math.max(1, parseInt(page) || 1)
    const ps = Math.min(maxPageSize, Math.max(1, parseInt(pageSize) || defaultPageSize))

    // Get total count
    const total = await archivesCol.countDocuments(filter)

    // Query archives sorted by most recent first
    const archives = await archivesCol.find(filter)
      .sort({ archivedAt: -1 })
      .skip((p - 1) * ps)
      .limit(ps)
      .toArray()

    // Enrich with master display names
    const masterNames = [...new Set(archives.map(a => a.masterName))]
    const masterMeta = {}
    for (const name of masterNames) {
      const meta = await safeFindOne(metaCol, { masterName: name })
      if (meta) masterMeta[name] = { displayName: meta.displayName, primaryKey: meta.primaryKey }
    }

    const enrichedArchives = archives.map(a => ({
      ...a,
      masterDisplayName: (masterMeta[a.masterName] || {}).displayName || a.masterName,
      isExpired: a.status === 'expired' || new Date(a.expiresAt) < new Date(),
      daysUntilExpiry: Math.max(0, Math.ceil((new Date(a.expiresAt) - new Date()) / (1000 * 60 * 60 * 24)))
    }))

    // Summary stats
    const summary = {
      totalArchives: total,
      totalRecordsArchived: archives.reduce((sum, a) => sum + (a.recordCount || 0), 0),
      totalSizeBytes: archives.reduce((sum, a) => sum + (a.sizeBytes || 0), 0),
      activeCount: archives.filter(a => a.status === 'active').length,
      expiredCount: archives.filter(a => a.status === 'expired' || new Date(a.expiresAt) < new Date()).length
    }

    return createResponse({
      archives: enrichedArchives,
      summary,
      pagination: { page: p, pageSize: ps, total, totalPages: Math.ceil(total / ps) }
    })
  } catch (error) {
    console.error('Archive list error:', error)
    return createErrorResponse(`Failed to list archives: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
