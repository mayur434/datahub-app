/**
 * MDM Metadata Update Action
 * Update master metadata (display name, description, allowed operations, etc.)
 */

const { getDbClient, safeFindOne, COLLECTIONS, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams, getTimezoneDate, enforceAppPermission } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const master = params.master || params.entity
    const { displayName, description, crudEnabled, allowedOperations, governance } = params
    if (!master) return createErrorResponse('Missing required parameter: master')

    client = await getDbClient(params)

    // App-level RBAC
    const appPerm = await enforceAppPermission(client, params, 'metadata-update')
    if (!appPerm.allowed) return appPerm.response

    const user = await getUserFromParams(params, client)
    const metaCol = await client.collection(COLLECTIONS.METADATA)

    const metadata = await safeFindOne(metaCol, { masterName: master })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Master '${master}' not found`, 404)
    }

    // Build update object
    const updateFields = { updatedAt: getTimezoneDate(params), lastModifiedBy: user }
    if (displayName !== undefined) updateFields.displayName = displayName
    if (description !== undefined) updateFields.description = description
    if (crudEnabled !== undefined) updateFields.crudEnabled = !!crudEnabled
    if (allowedOperations !== undefined) updateFields.allowedOperations = { ...metadata.allowedOperations, ...allowedOperations }
    if (governance !== undefined) updateFields.governance = { ...metadata.governance, ...governance }

    await metaCol.updateOne({ masterName: master }, { $set: updateFields })

    await createAuditLog(client, {
      masterName: master,
      operation: 'metadata-update',
      actor: user,
      status: 'success',
      
    })

    // Fetch updated doc
    const updated = await safeFindOne(metaCol, { masterName: master })

    return createResponse({
      status: 'success',
      master,
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
