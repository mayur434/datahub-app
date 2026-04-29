/**
 * MDM Metadata Update Action
 * Update entity metadata (display name, description, allowed operations, etc.)
 */

const { getDbClient, safeFindOne, COLLECTIONS, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  const user = getUserFromParams(params)

  let client
  try {
    const { entity, displayName, description, crudEnabled, allowedOperations, governance } = params
    if (!entity) return createErrorResponse('Missing required parameter: entity')

    client = await getDbClient(params)
    const metaCol = await client.collection(COLLECTIONS.METADATA)

    const metadata = await safeFindOne(metaCol, { entityName: entity })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Entity '${entity}' not found`, 404)
    }

    // Build update object
    const updateFields = { updatedAt: new Date().toISOString() }
    if (displayName !== undefined) updateFields.displayName = displayName
    if (description !== undefined) updateFields.description = description
    if (crudEnabled !== undefined) updateFields.crudEnabled = !!crudEnabled
    if (allowedOperations !== undefined) updateFields.allowedOperations = { ...metadata.allowedOperations, ...allowedOperations }
    if (governance !== undefined) updateFields.governance = { ...metadata.governance, ...governance }

    await metaCol.updateOne({ entityName: entity }, { $set: updateFields })

    await createAuditLog(client, {
      entityName: entity,
      operation: 'metadata-update',
      actor: user,
      status: 'success',
      
    })

    // Fetch updated doc
    const updated = await safeFindOne(metaCol, { entityName: entity })

    return createResponse({
      status: 'success',
      entity,
      file: updated,
      message: 'Metadata updated successfully'
    })
  } catch (error) {
    console.error('Metadata update error:', error)
    return createErrorResponse(`Metadata update failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
