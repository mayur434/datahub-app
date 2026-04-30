/**
 * MDM File Delete Action
 * Soft deletes a file/entity.
 */

const { getDbClient, safeFindOne, COLLECTIONS, createVersion, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  const user = getUserFromParams(params)

  let client
  try {
    const { entity } = params
    if (!entity) return createErrorResponse('Missing required parameter: entity')

    client = await getDbClient(params)
    const metaCol = await client.collection(COLLECTIONS.METADATA)

    const metadata = await safeFindOne(metaCol, { entityName: entity })
    if (!metadata) {
      return createErrorResponse(`Entity '${entity}' not found`, 404)
    }

    // Already deleted — return success (idempotent)
    if (metadata.status === 'deleted') {
      return createResponse({
        status: 'success',
        entity,
        message: `Entity '${entity}' is already deleted`
      })
    }

    // Create tombstone version
    await createVersion(client, entity, 'delete', user, {
      inserted: 0, updated: 0, deleted: metadata.recordCount
    }, 0)

    // Soft delete metadata
    await metaCol.updateOne(
      { entityName: entity },
      { $set: { status: 'deleted', updatedAt: new Date().toISOString(), deletedAt: new Date().toISOString(), deletedBy: user } }
    )

    // Soft delete all records for this entity
    const recordsCol = await client.collection(COLLECTIONS.RECORDS)
    await recordsCol.updateMany(
      { entityName: entity, deleted: false },
      { $set: { deleted: true, status: 'deleted', updatedAt: new Date().toISOString(), deletedBy: user } }
    )

    // Audit
    await createAuditLog(client, {
      entityName: entity,
      operation: 'delete',
      actor: user,
      status: 'success',
      affectedRecords: metadata.recordCount,
      
    })

    return createResponse({
      status: 'success',
      entity,
      message: `Entity '${entity}' has been soft deleted`
    })
  } catch (error) {
    console.error('File delete error:', error)
    return createErrorResponse(`Delete failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
