/**
 * MDM Master List Action
 * Returns list of all managed masters.
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

    const allFiles = await metaCol.find({ status: { $ne: 'deleted' } })
      .project({
        masterName: 1, displayName: 1, description: 1, originalFileName: 1,
        primaryKey: 1, status: 1, visibility: 1, crudEnabled: 1,
        collectionName: 1, activeVersionId: 1, recordCount: 1, cache: 1, api: 1,
        createdBy: 1, createdAt: 1, updatedAt: 1
      })
      .sort({ updatedAt: -1 })
      .toArray()

    // JS-level safety filter: aio-lib-db may not support $ne operator
    const files = allFiles.filter(f => f.status !== 'deleted')

    return createResponse({ files, total: files.length })
  } catch (error) {
    console.error('File list error:', error)
    return createErrorResponse(`Failed to list files: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
