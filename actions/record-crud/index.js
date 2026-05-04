/**
 * MDM Record CRUD Action
 * Handles Create, Update, Patch, Delete for individual records.
 * Operates on per-master collections (mdm_<masterName>).
 */

const { getDbClient, safeFindOne, COLLECTIONS, getMasterCollection, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams, validateMasterName, checkPermission, validateRecord, computeFieldChanges, publishMutationEvent, checkStorageGuardrails, enforceAppPermission, getNextSequenceId } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const master = params.master || params.entity
    const { operation } = params
    const id = params.id != null ? String(params.id) : undefined
    // data may arrive as a JSON string (from API Mesh GraphQL) or as an object (from direct invocation)
    let data = params.data
    if (typeof data === 'string') {
      try { data = JSON.parse(data) } catch (e) { return createErrorResponse('Invalid JSON in data field') }
    }
    if (!master) return createErrorResponse('Missing required parameter: master')
    if (!validateMasterName(master)) return createErrorResponse('Invalid master name')

    client = await getDbClient(params)

    // App-level RBAC
    const appPerm = await enforceAppPermission(client, params, 'record-crud')
    if (!appPerm.allowed) return appPerm.response

    const user = await getUserFromParams(params, client)

    // RBAC check
    const method = operation || params.__ow_method || 'post'
    const opMap = { create: 'create', post: 'create', update: 'update', put: 'update', patch: 'patch', delete: 'delete' }
    const rbacOp = opMap[method.toLowerCase()] || 'read'
    const perm = await checkPermission(client, user, rbacOp, master)
    if (!perm.allowed) {
      return createErrorResponse(`Permission denied: role '${perm.role}' cannot perform '${rbacOp}' on '${master}'`, 403)
    }

    const metaCol = await client.collection(COLLECTIONS.METADATA)
    const masterCol = await getMasterCollection(client, master)

    const metadata = await safeFindOne(metaCol, { masterName: master })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Master '${master}' not found`, 404)
    }

    if (!metadata.crudEnabled) {
      return createErrorResponse('CRUD operations are disabled for this master', 403)
    }

    switch (method.toLowerCase()) {
      case 'create':
      case 'post':
        return await handleCreate(client, metaCol, masterCol, metadata, master, data, user, params)
      case 'update':
      case 'put':
        return await handleUpdate(client, masterCol, metadata, master, id, data, user, params)
      case 'patch':
        return await handlePatch(client, masterCol, metadata, master, id, data, user, params)
      case 'delete':
        return await handleDelete(client, metaCol, masterCol, metadata, master, id, user, params)
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

async function handleCreate (client, metaCol, masterCol, metadata, master, data, user, params) {
  if (!metadata.allowedOperations.create) {
    return createErrorResponse('Create operation not allowed for this master', 403)
  }

  if (!data || typeof data !== 'object') {
    return createErrorResponse('Missing or invalid data payload')
  }

  // Auto-generate primary key if not provided (auto-increment with collision retry)
  let pk = data[metadata.primaryKey]
  if (!pk) {
    pk = await getNextSequenceId(client, master)
    data[metadata.primaryKey] = pk
    // If this PK already exists (counter out of sync), keep incrementing
    let retries = 10
    while (retries-- > 0) {
      const collision = await safeFindOne(masterCol, { primaryKey: String(pk) })
      if (!collision) break
      pk = await getNextSequenceId(client, master)
      data[metadata.primaryKey] = pk
    }
  }
  pk = String(pk)

  // Check for existing (explicit PK provided by user)
  const existing = await safeFindOne(masterCol, { primaryKey: pk, deleted: false })
  if (existing) {
    return createErrorResponse(`Record with ${metadata.primaryKey}='${pk}' already exists`, 409)
  }

  // Validate required fields (skip the PK since it's auto-generated)
  const requiredFields = metadata.schema.filter(s => s.required && s.name !== metadata.primaryKey).map(s => s.name)
  const missing = requiredFields.filter(f => !data[f] && data[f] !== 0)
  if (missing.length > 0) {
    return createErrorResponse(`Missing required fields: ${missing.join(', ')}`)
  }

  // Strip system fields — these are auto-managed server-side
  const SYSTEM_AUDIT_FIELDS = ['_createdAt', '_updatedAt', '_createdBy', '_updatedBy', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']
  SYSTEM_AUDIT_FIELDS.forEach(f => delete data[f])

  // Validate data against schema rules
  const validationErrors = validateRecord(data, metadata.schema, { primaryKey: metadata.primaryKey })
  if (validationErrors.length > 0) {
    return createErrorResponse(`Validation failed: ${validationErrors.join('; ')}`)
  }

  // Storage guardrail check
  const guardrail = await checkStorageGuardrails(client, {
    newDocumentCount: 1,
    entity: master,
    currentEntityRecords: metadata.recordCount || 0,
    params: params || {}
  })
  if (!guardrail.allowed) {
    return createErrorResponse(`Storage guardrail: ${guardrail.reason}`, 507)
  }

  const now = new Date()

  // Inject record-level audit fields if configured for this master
  const auditConfig = metadata.recordAudit
  if (auditConfig && auditConfig.enabled) {
    if (auditConfig.createdAt) data._createdAt = now
    if (auditConfig.updatedAt) data._updatedAt = now
    if (auditConfig.createdBy) data._createdBy = user
    if (auditConfig.updatedBy) data._updatedBy = user
  }

  await masterCol.insertOne({
    primaryKey: pk,
    data,
    status: 'active',
    deleted: false,
    createdAt: now,
    createdBy: user,
    updatedAt: now,
    updatedBy: user
  })

  // Run post-write operations in parallel
  await Promise.all([
    metaCol.updateOne(
      { masterName: master },
      { $set: { lastModifiedBy: user }, $currentDate: { updatedAt: true }, $inc: { recordCount: 1 } }
    ),
    createAuditLog(client, { masterName: master, operation: 'create-record', actor: user, status: 'success', affectedRecords: 1 }),
    publishMutationEvent(client, 'record.created', { master, recordId: pk, data, actor: user })
  ])

  return createResponse({ status: 'success', record: data }, 201)
}

async function handleUpdate (client, masterCol, metadata, master, id, data, user, params) {
  if (!metadata.allowedOperations.update) {
    return createErrorResponse('Update operation not allowed for this master', 403)
  }
  if (!id) return createErrorResponse('Record ID is required for update')
  if (!data || typeof data !== 'object') return createErrorResponse('Missing or invalid data payload')

  const existing = await safeFindOne(masterCol, { primaryKey: id, deleted: false })
  if (!existing) return createErrorResponse(`Record '${id}' not found`, 404)

  // Full replace (keep primary key)
  data[metadata.primaryKey] = id

  // Strip system fields — these are auto-managed server-side
  const SYSTEM_AUDIT_FIELDS = ['_createdAt', '_updatedAt', '_createdBy', '_updatedBy', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']
  SYSTEM_AUDIT_FIELDS.forEach(f => delete data[f])

  // Validate data against schema (also strips unknown fields)
  if (metadata.schema && metadata.schema.length > 0) {
    const validationErrors = validateRecord(data, metadata.schema, { primaryKey: metadata.primaryKey })
    if (validationErrors.length > 0) {
      return createErrorResponse(`Validation failed: ${validationErrors.join('; ')}`)
    }
  }

  // Inject record-level audit fields if configured
  const auditConfig = metadata.recordAudit
  if (auditConfig && auditConfig.enabled) {
    if (auditConfig.updatedAt) data._updatedAt = new Date()
    if (auditConfig.updatedBy) data._updatedBy = user
  }

  await masterCol.updateOne(
    { primaryKey: id },
    { $set: { data, updatedBy: user }, $currentDate: { updatedAt: true } }
  )

  const changes = computeFieldChanges(existing.data, data)

  // Run post-write operations in parallel
  const metaCol = await client.collection(COLLECTIONS.METADATA)
  await Promise.all([
    createAuditLog(client, { masterName: master, operation: 'update-record', actor: user, status: 'success', affectedRecords: 1, recordId: id, changes }),
    publishMutationEvent(client, 'record.updated', { master, recordId: id, changes, actor: user }),
    metaCol.updateOne({ masterName: master }, { $set: { lastModifiedBy: user }, $currentDate: { updatedAt: true } })
  ])

  return createResponse({ status: 'success', record: data })
}

async function handlePatch (client, masterCol, metadata, master, id, data, user, params) {
  if (!metadata.allowedOperations.patch) {
    return createErrorResponse('Patch operation not allowed for this master', 403)
  }
  if (!id) return createErrorResponse('Record ID is required for patch')
  if (!data || typeof data !== 'object') return createErrorResponse('Missing or invalid data payload')

  const existing = await safeFindOne(masterCol, { primaryKey: id, deleted: false })
  if (!existing) return createErrorResponse(`Record '${id}' not found`, 404)

  // Check editable fields
  const nonEditableFields = metadata.schema.filter(s => !s.editable).map(s => s.name)
  const attemptedEdits = Object.keys(data).filter(k => nonEditableFields.includes(k))
  if (attemptedEdits.length > 0) {
    return createErrorResponse(`Cannot edit non-editable fields: ${attemptedEdits.join(', ')}`)
  }

  // Strip system fields — these are auto-managed server-side
  const SYSTEM_AUDIT_FIELDS = ['_createdAt', '_updatedAt', '_createdBy', '_updatedBy', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']
  SYSTEM_AUDIT_FIELDS.forEach(f => delete data[f])

  // Strip unknown fields from patch data before merge
  if (metadata.schema && metadata.schema.length > 0) {
    const schemaFieldNames = new Set(metadata.schema.map(f => f.name))
    Object.keys(data).forEach(k => { if (!schemaFieldNames.has(k)) delete data[k] })
  }

  // Merge data
  const merged = { ...existing.data, ...data }

  // Validate merged data against schema (also strips unknown fields)
  if (metadata.schema && metadata.schema.length > 0) {
    const validationErrors = validateRecord(merged, metadata.schema, { primaryKey: metadata.primaryKey })
    if (validationErrors.length > 0) {
      return createErrorResponse(`Validation failed: ${validationErrors.join('; ')}`)
    }
  }

  // Inject record-level audit fields if configured
  const auditConfig = metadata.recordAudit
  if (auditConfig && auditConfig.enabled) {
    if (auditConfig.updatedAt) merged._updatedAt = new Date()
    if (auditConfig.updatedBy) merged._updatedBy = user
  }

  await masterCol.updateOne(
    { primaryKey: id },
    { $set: { data: merged, updatedBy: user }, $currentDate: { updatedAt: true } }
  )

  const changes = computeFieldChanges(existing.data, merged)

  // Run post-write operations in parallel
  const metaCol = await client.collection(COLLECTIONS.METADATA)
  await Promise.all([
    createAuditLog(client, { masterName: master, operation: 'patch-record', actor: user, status: 'success', affectedRecords: 1, recordId: id, changes }),
    publishMutationEvent(client, 'record.patched', { master, recordId: id, changes, actor: user }),
    metaCol.updateOne({ masterName: master }, { $set: { lastModifiedBy: user }, $currentDate: { updatedAt: true } })
  ])

  return createResponse({ status: 'success', record: merged })
}

async function handleDelete (client, metaCol, masterCol, metadata, master, id, user, params) {
  if (!metadata.allowedOperations.delete) {
    return createErrorResponse('Delete operation not allowed for this master', 403)
  }
  if (!id) return createErrorResponse('Record ID is required for delete')

  const existing = await safeFindOne(masterCol, { primaryKey: id, deleted: false })
  if (!existing) return createErrorResponse(`Record '${id}' not found`, 404)

  // Soft delete
  await masterCol.updateOne(
    { primaryKey: id },
    { $set: { deleted: true, status: 'deleted', updatedBy: user, deletedBy: user }, $currentDate: { updatedAt: true, deletedAt: true } }
  )

  // Run post-write operations in parallel
  await Promise.all([
    metaCol.updateOne(
      { masterName: master },
      { $set: { lastModifiedBy: user }, $currentDate: { updatedAt: true }, $inc: { recordCount: -1 } }
    ),
    createAuditLog(client, { masterName: master, operation: 'delete-record', actor: user, status: 'success', affectedRecords: 1, recordId: id }),
    publishMutationEvent(client, 'record.deleted', { master, recordId: id, actor: user })
  ])

  return createResponse({ status: 'success', message: `Record '${id}' deleted` })
}

exports.main = main
