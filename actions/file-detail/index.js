/**
 * MDM Master Detail Action
 * Returns metadata and schema for a specific master.
 */

const { getDbClient, safeFindOne, COLLECTIONS, createResponse, createErrorResponse, validateIMSToken, enforceAppPermission } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const master = params.master || params.entity
    if (!master) return createErrorResponse('Missing required parameter: master')

    client = await getDbClient(params)

    // App-level RBAC
    const appPerm = await enforceAppPermission(client, params, 'file-detail')
    if (!appPerm.allowed) return appPerm.response

    const metaCol = await client.collection(COLLECTIONS.METADATA)

    const metadata = await safeFindOne(metaCol, { masterName: master })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Master '${master}' not found`, 404)
    }

    return createResponse({ file: metadata })
  } catch (error) {
    console.error('Master detail error:', error)
    return createErrorResponse(`Failed to get master details: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
