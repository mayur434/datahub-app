/**
 * MDM Dashboard Stats Action
 * Returns summary statistics for the admin dashboard.
 * Reads directly from aio-lib-db (no caching for admin).
 */

const { getDbClient, COLLECTIONS, createResponse, createErrorResponse, validateIMSToken } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    client = await getDbClient(params)
    const metaCol = await client.collection(COLLECTIONS.METADATA)
    const auditCol = await client.collection(COLLECTIONS.AUDIT)
    const versionCol = await client.collection(COLLECTIONS.VERSIONS)

    // Get all active entities
    const files = await metaCol.find({ status: { $ne: 'deleted' } }).toArray()

    let totalRecords = 0
    let publicApis = 0
    let privateApis = 0
    const recentUploads = []

    for (const file of files) {
      totalRecords += file.recordCount || 0
      if (file.visibility === 'public') publicApis++
      else privateApis++
      recentUploads.push({
        entityName: file.entityName,
        displayName: file.displayName,
        updatedAt: file.updatedAt,
        recordCount: file.recordCount
      })
    }

    recentUploads.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))

    // Recent audit logs
    const recentLogs = await auditCol.find({})
      .sort({ timestamp: -1 })
      .limit(10)
      .toArray()

    const auditAlerts = await auditCol.countDocuments({ status: 'failure' })

    // Total versions
    const totalVersions = await versionCol.estimatedDocumentCount()

    return createResponse({
      dashboard: {
        totalFiles: files.length,
        publicApis,
        privateApis,
        totalRecords,
        totalVersions,
        auditAlerts,
        recentUploads: recentUploads.slice(0, 5),
        recentLogs
      }
    })
  } catch (error) {
    console.error('Dashboard error:', error)
    return createErrorResponse(`Dashboard failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
