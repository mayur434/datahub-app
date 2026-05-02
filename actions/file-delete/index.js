/**
 * MDM Master Delete Action
 * Soft deletes a master and drops its per-master collection.
 */

const { getDbClient, safeFindOne, COLLECTIONS, getMasterCollection, createVersion, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams, getTimezoneDate } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const master = params.master || params.entity
    if (!master) return createErrorResponse('Missing required parameter: master')

    client = await getDbClient(params)
    const user = await getUserFromParams(params, client)
    const metaCol = await client.collection(COLLECTIONS.METADATA)

    const metadata = await safeFindOne(metaCol, { masterName: master })
    if (!metadata) {
      return createErrorResponse(`Master '${master}' not found`, 404)
    }

    // Already deleted — return success (idempotent)
    if (metadata.status === 'deleted') {
      return createResponse({
        status: 'success',
        master,
        message: `Master '${master}' is already deleted`
      })
    }

    // Create tombstone version
    await createVersion(client, master, 'delete', user, {
      inserted: 0, updated: 0, deleted: metadata.recordCount
    }, 0)

    // Soft delete metadata
    await metaCol.updateOne(
      { masterName: master },
      { $set: { status: 'deleted', updatedAt: getTimezoneDate(params), deletedAt: getTimezoneDate(params), deletedBy: user } }
    )

    // Drop the per-master collection
    try {
      const masterCol = await getMasterCollection(client, master)
      await masterCol.drop()
    } catch (e) {
      // Collection may not exist — that's OK
    }

    // Audit
    await createAuditLog(client, {
      masterName: master,
      operation: 'delete',
      actor: user,
      status: 'success',
      affectedRecords: metadata.recordCount,

    })

    return createResponse({
      status: 'success',
      master,
      message: `Master '${master}' has been deleted`
    })
  } catch (error) {
    console.error('Master delete error:', error)
    return createErrorResponse(`Delete failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
