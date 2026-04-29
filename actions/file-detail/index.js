/**
 * MDM File Detail Action
 * Returns metadata and schema for a specific entity.
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

    const metadata = await safeFindOne(metaCol, { entityName: entity })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Entity '${entity}' not found`, 404)
    }

    return createResponse({ file: metadata })
  } catch (error) {
    console.error('File detail error:', error)
    return createErrorResponse(`Failed to get file details: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
