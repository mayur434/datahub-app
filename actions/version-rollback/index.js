/**
 * MDM Version Rollback Action
 * Restores a previous version for an entity.
 */

const { getDbClient, safeFindOne, COLLECTIONS, createVersion, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  const user = getUserFromParams(params)

  let client
  try {
    const { entity, versionId } = params
    if (!entity || !versionId) {
      return createErrorResponse('Missing required parameters: entity, versionId')
    }

    client = await getDbClient(params)
    const metaCol = await client.collection(COLLECTIONS.METADATA)
    const versionCol = await client.collection(COLLECTIONS.VERSIONS)

    const metadata = await safeFindOne(metaCol, { entityName: entity })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Entity '${entity}' not found`, 404)
    }

    // Get target version
    const targetVersion = await safeFindOne(versionCol, { entityName: entity, versionId })
    if (!targetVersion) {
      return createErrorResponse(`Version '${versionId}' not found`, 404)
    }

    const previousVersionId = metadata.activeVersionId

    // Create rollback version
    const rollbackVersion = await createVersion(client, entity, 'rollback', user, {
      rolledBackTo: versionId
    }, targetVersion.recordCount || metadata.recordCount)

    // Update metadata to point to new version
    await metaCol.updateOne(
      { entityName: entity },
      { $set: { activeVersionId: rollbackVersion.versionId, updatedAt: new Date().toISOString() } }
    )

    // Audit
    await createAuditLog(client, {
      entityName: entity,
      operation: 'rollback',
      actor: user,
      status: 'success',
      beforeVersion: previousVersionId,
      afterVersion: rollbackVersion.versionId,
      
    })

    return createResponse({
      status: 'success',
      entity,
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
