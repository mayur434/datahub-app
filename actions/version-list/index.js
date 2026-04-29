/**
 * MDM Version List Action
 * Lists all versions for an entity from the versions collection.
 */

const { getDbClient, safeFindOne, COLLECTIONS, createResponse, createErrorResponse, validateIMSToken } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const { entity } = params
    if (!entity) return createErrorResponse('Missing required parameter: entity')

    client = await getDbClient(params)
    const metaCol = await client.collection(COLLECTIONS.METADATA)
    const versionCol = await client.collection(COLLECTIONS.VERSIONS)

    const metadata = await safeFindOne(metaCol, { entityName: entity })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Entity '${entity}' not found`, 404)
    }

    const versions = await versionCol.find({ entityName: entity })
      .sort({ createdAt: -1 })
      .toArray()

    return createResponse({
      entity,
      activeVersionId: metadata.activeVersionId,
      versions,
      total: versions.length
    })
  } catch (error) {
    console.error('Version list error:', error)
    return createErrorResponse(`Failed to list versions: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
