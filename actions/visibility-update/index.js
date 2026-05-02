/**
 * MDM Visibility Update Action
 * Toggle public/private mode for an entity.
 */

const { getDbClient, safeFindOne, COLLECTIONS, createVersion, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams, getTimezoneDate } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const entity = params.master || params.entity
    const { visibility } = params
    if (!entity) return createErrorResponse('Missing required parameter: master')

    if (!visibility || !['public', 'private'].includes(visibility)) {
      return createErrorResponse('Visibility must be "public" or "private"')
    }

    client = await getDbClient(params)
    const user = await getUserFromParams(params, client)
    const metaCol = await client.collection(COLLECTIONS.METADATA)

    const metadata = await safeFindOne(metaCol, { masterName: entity })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Master '${entity}' not found`, 404)
    }

    const previousVisibility = metadata.visibility

    await metaCol.updateOne(
      { masterName: entity },
      { $set: { visibility, updatedAt: getTimezoneDate(params), lastModifiedBy: user } }
    )

    await createVersion(client, entity, 'visibility-update', user, {
      previousVisibility, newVisibility: visibility
    }, metadata.recordCount)

    await createAuditLog(client, {
      masterName: entity,
      operation: 'visibility-update',
      actor: user,
      status: 'success',
      
    })

    return createResponse({
      status: 'success',
      master: entity,
      previousVisibility,
      visibility,
      message: `Master '${entity}' is now ${visibility}`
    })
  } catch (error) {
    console.error('Visibility update error:', error)
    return createErrorResponse(`Visibility update failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
