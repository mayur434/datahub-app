/**
 * MDM Record CRUD Action
 * Handles Create, Update, Patch, Delete for individual records.
 * All ops go directly to aio-lib-db.
 */

const { getDbClient, safeFindOne, COLLECTIONS, createVersion, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  const user = getUserFromParams(params)

  let client
  try {
    const { entity, id, operation, data } = params
    if (!entity) return createErrorResponse('Missing required parameter: entity')

    client = await getDbClient(params)
    const metaCol = await client.collection(COLLECTIONS.METADATA)
    const recordsCol = await client.collection(COLLECTIONS.RECORDS)

    const metadata = await safeFindOne(metaCol, { entityName: entity })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Entity '${entity}' not found`, 404)
    }

    if (!metadata.crudEnabled) {
      return createErrorResponse('CRUD operations are disabled for this entity', 403)
    }

    const method = operation || params.__ow_method || 'post'

    switch (method.toLowerCase()) {
      case 'create':
      case 'post':
        return await handleCreate(client, metaCol, recordsCol, metadata, entity, data, user)
      case 'update':
      case 'put':
        return await handleUpdate(client, recordsCol, metadata, entity, id, data, user)
      case 'patch':
        return await handlePatch(client, recordsCol, metadata, entity, id, data, user)
      case 'delete':
        return await handleDelete(client, metaCol, recordsCol, metadata, entity, id, user)
      default:
        return createErrorResponse(`Unsupported operation: ${method}`)
    }
  } catch (error) {
    console.error('Record CRUD error:', error)
    return createErrorResponse(`Operation failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

async function handleCreate (client, metaCol, recordsCol, metadata, entity, data, user) {
  if (!metadata.allowedOperations.create) {
    return createErrorResponse('Create operation not allowed for this entity', 403)
  }

  if (!data || typeof data !== 'object') {
    return createErrorResponse('Missing or invalid data payload')
  }

  const pk = data[metadata.primaryKey]
  if (!pk) {
    return createErrorResponse(`Primary key '${metadata.primaryKey}' is required`)
  }

  // Check for existing
  const existing = await safeFindOne(recordsCol, { entityName: entity, primaryKey: pk, deleted: false })
  if (existing) {
    return createErrorResponse(`Record with ${metadata.primaryKey}='${pk}' already exists`, 409)
  }

  // Validate required fields
  const requiredFields = metadata.schema.filter(s => s.required).map(s => s.name)
  const missing = requiredFields.filter(f => !data[f] && data[f] !== 0)
  if (missing.length > 0) {
    return createErrorResponse(`Missing required fields: ${missing.join(', ')}`)
  }

  await recordsCol.insertOne({
    entityName: entity,
    primaryKey: pk,
    versionId: metadata.activeVersionId,
    data,
    status: 'active',
    deleted: false,
    createdAt: new Date().toISOString(),
    createdBy: user,
    updatedAt: new Date().toISOString(),
    updatedBy: user
  })

  // Update record count
  const count = await recordsCol.countDocuments({ entityName: entity, deleted: false })
  await metaCol.updateOne(
    { entityName: entity },
    { $set: { recordCount: count, updatedAt: new Date().toISOString() } }
  )

  await createAuditLog(client, { entityName: entity, operation: 'create-record', actor: user, status: 'success', affectedRecords: 1 })

  return createResponse({ status: 'success', record: data }, 201)
}

async function handleUpdate (client, recordsCol, metadata, entity, id, data, user) {
  if (!metadata.allowedOperations.update) {
    return createErrorResponse('Update operation not allowed for this entity', 403)
  }
  if (!id) return createErrorResponse('Record ID is required for update')
  if (!data || typeof data !== 'object') return createErrorResponse('Missing or invalid data payload')

  const existing = await safeFindOne(recordsCol, { entityName: entity, primaryKey: id, deleted: false })
  if (!existing) return createErrorResponse(`Record '${id}' not found`, 404)

  // Full replace (keep primary key)
  data[metadata.primaryKey] = id
  await recordsCol.updateOne(
    { entityName: entity, primaryKey: id },
    { $set: { data, updatedAt: new Date().toISOString(), updatedBy: user } }
  )

  await createAuditLog(client, { entityName: entity, operation: 'update-record', actor: user, status: 'success', affectedRecords: 1 })

  return createResponse({ status: 'success', record: data })
}

async function handlePatch (client, recordsCol, metadata, entity, id, data, user) {
  if (!metadata.allowedOperations.patch) {
    return createErrorResponse('Patch operation not allowed for this entity', 403)
  }
  if (!id) return createErrorResponse('Record ID is required for patch')
  if (!data || typeof data !== 'object') return createErrorResponse('Missing or invalid data payload')

  const existing = await safeFindOne(recordsCol, { entityName: entity, primaryKey: id, deleted: false })
  if (!existing) return createErrorResponse(`Record '${id}' not found`, 404)

  // Check editable fields
  const nonEditableFields = metadata.schema.filter(s => !s.editable).map(s => s.name)
  const attemptedEdits = Object.keys(data).filter(k => nonEditableFields.includes(k))
  if (attemptedEdits.length > 0) {
    return createErrorResponse(`Cannot edit non-editable fields: ${attemptedEdits.join(', ')}`)
  }

  // Merge data
  const merged = { ...existing.data, ...data }
  await recordsCol.updateOne(
    { entityName: entity, primaryKey: id },
    { $set: { data: merged, updatedAt: new Date().toISOString(), updatedBy: user } }
  )

  await createAuditLog(client, { entityName: entity, operation: 'patch-record', actor: user, status: 'success', affectedRecords: 1 })

  return createResponse({ status: 'success', record: merged })
}

async function handleDelete (client, metaCol, recordsCol, metadata, entity, id, user) {
  if (!metadata.allowedOperations.delete) {
    return createErrorResponse('Delete operation not allowed for this entity', 403)
  }
  if (!id) return createErrorResponse('Record ID is required for delete')

  const existing = await safeFindOne(recordsCol, { entityName: entity, primaryKey: id, deleted: false })
  if (!existing) return createErrorResponse(`Record '${id}' not found`, 404)

  // Soft delete
  await recordsCol.updateOne(
    { entityName: entity, primaryKey: id },
    { $set: { deleted: true, status: 'deleted', updatedAt: new Date().toISOString(), updatedBy: user, deletedAt: new Date().toISOString(), deletedBy: user } }
  )

  // Update count
  const count = await recordsCol.countDocuments({ entityName: entity, deleted: false })
  await metaCol.updateOne(
    { entityName: entity },
    { $set: { recordCount: count, updatedAt: new Date().toISOString() } }
  )

  await createAuditLog(client, { entityName: entity, operation: 'delete-record', actor: user, status: 'success', affectedRecords: 1 })

  return createResponse({ status: 'success', message: `Record '${id}' deleted` })
}

exports.main = main
