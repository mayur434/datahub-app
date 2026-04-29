/**
 * MDM Visibility Update Action
 * Toggle public/private mode for an entity.
 */

const { getDbClient, safeFindOne, COLLECTIONS, createVersion, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  const user = getUserFromParams(params)

  let client
  try {
    const { entity, visibility } = params
    if (!entity) return createErrorResponse('Missing required parameter: entity')

    if (!visibility || !['public', 'private'].includes(visibility)) {
      return createErrorResponse('Visibility must be "public" or "private"')
    }

    client = await getDbClient(params)
    const metaCol = await client.collection(COLLECTIONS.METADATA)

    const metadata = await safeFindOne(metaCol, { entityName: entity })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Entity '${entity}' not found`, 404)
    }

    const previousVisibility = metadata.visibility

    await metaCol.updateOne(
      { entityName: entity },
      { $set: { visibility, updatedAt: new Date().toISOString() } }
    )

    await createVersion(client, entity, 'visibility-update', user, {
      previousVisibility, newVisibility: visibility
    }, metadata.recordCount)

    await createAuditLog(client, {
      entityName: entity,
      operation: 'visibility-update',
      actor: user,
      status: 'success',
      
    })

    return createResponse({
      status: 'success',
      entity,
      previousVisibility,
      visibility,
      message: `Entity '${entity}' is now ${visibility}`
    })
  } catch (error) {
    console.error('Visibility update error:', error)
    return createErrorResponse(`Visibility update failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
