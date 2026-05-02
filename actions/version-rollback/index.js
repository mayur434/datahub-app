/**
 * MDM Version Rollback Action
 * Restores a previous version for a master.
 */

const { getDbClient, safeFindOne, COLLECTIONS, createVersion, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams, getTimezoneDate } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const master = params.master || params.entity
    const { versionId } = params
    if (!master || !versionId) {
      return createErrorResponse('Missing required parameters: master, versionId')
    }

    client = await getDbClient(params)
    const user = await getUserFromParams(params, client)
    const metaCol = await client.collection(COLLECTIONS.METADATA)
    const versionCol = await client.collection(COLLECTIONS.VERSIONS)

    const metadata = await safeFindOne(metaCol, { masterName: master })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Master '${master}' not found`, 404)
    }

    // Get target version
    const targetVersion = await safeFindOne(versionCol, { masterName: master, versionId })
    if (!targetVersion) {
      return createErrorResponse(`Version '${versionId}' not found`, 404)
    }

    const previousVersionId = metadata.activeVersionId

    // Create rollback version
    const rollbackVersion = await createVersion(client, master, 'rollback', user, {
      rolledBackTo: versionId
    }, targetVersion.recordCount || metadata.recordCount)

    // Update metadata to point to new version
    await metaCol.updateOne(
      { masterName: master },
      { $set: { activeVersionId: rollbackVersion.versionId, updatedAt: getTimezoneDate(params) } }
    )

    // Audit
    await createAuditLog(client, {
      masterName: master,
      operation: 'rollback',
      actor: user,
      status: 'success',
      beforeVersion: previousVersionId,
      afterVersion: rollbackVersion.versionId,
      
    })

    return createResponse({
      status: 'success',
      master,
      previousVersion: previousVersionId,
      rolledBackTo: versionId,
      newVersionId: rollbackVersion.versionId,
      message: `Successfully rolled back to version '${versionId}'`
    })
  } catch (error) {
    console.error('Rollback error:', error)
    return createErrorResponse(`Rollback failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
