/**
 * MDM Archive List Action
 * Returns archives for a specific entity or all entities.
 * Supports filtering by status, date range, and pagination.
 */

const { getDbClient, safeFindOne, COLLECTIONS, createResponse, createErrorResponse, validateIMSToken, getUserFromParams } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const { entity, status, page, pageSize, startDate, endDate } = params

    client = await getDbClient(params)
    const archivesCol = await client.collection(COLLECTIONS.ARCHIVES)
    const metaCol = await client.collection(COLLECTIONS.METADATA)

    // Build query filter
    const filter = {}
    if (entity) {
      filter.entityName = entity
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

    // Pagination
    const p = Math.max(1, parseInt(page) || 1)
    const ps = Math.min(100, Math.max(1, parseInt(pageSize) || 25))

    // Get total count
    const total = await archivesCol.countDocuments(filter)

    // Query archives sorted by most recent first
    const archives = await archivesCol.find(filter)
      .sort({ archivedAt: -1 })
      .skip((p - 1) * ps)
      .limit(ps)
      .toArray()

    // Enrich with entity display names
    const entityNames = [...new Set(archives.map(a => a.entityName))]
    const entityMeta = {}
    for (const name of entityNames) {
      const meta = await safeFindOne(metaCol, { entityName: name })
      if (meta) entityMeta[name] = { displayName: meta.displayName, primaryKey: meta.primaryKey }
    }

    const enrichedArchives = archives.map(a => ({
      ...a,
      entityDisplayName: (entityMeta[a.entityName] || {}).displayName || a.entityName,
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
