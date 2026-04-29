/**
 * MDM Schema Update Action
 * Add, rename, update, or remove schema fields.
 * Migrates existing records when needed (e.g., default values, field renames).
 */

const { getDbClient, safeFindOne, COLLECTIONS, createVersion, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  const user = getUserFromParams(params)

  let client
  try {
    const { entity, operation, field, fields } = params
    if (!entity) return createErrorResponse('Missing required parameter: entity')

    client = await getDbClient(params)
    const metaCol = await client.collection(COLLECTIONS.METADATA)
    const recordsCol = await client.collection(COLLECTIONS.RECORDS)

    const metadata = await safeFindOne(metaCol, { entityName: entity })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Entity '${entity}' not found`, 404)
    }

    const schemaOp = operation || 'add'

    switch (schemaOp) {
      case 'add':
        return await handleAddField(client, metaCol, recordsCol, metadata, entity, field, user)
      case 'update':
        return await handleUpdateField(client, metaCol, metadata, entity, field, user)
      case 'remove':
        return await handleRemoveField(client, metaCol, metadata, entity, field, user)
      case 'rename':
        return await handleRenameField(client, metaCol, recordsCol, metadata, entity, field, user)
      case 'replace':
        return await handleReplaceSchema(client, metaCol, metadata, entity, fields, user)
      case 'update-facets':
        return await handleUpdateFacets(client, metaCol, metadata, entity, params, user)
      default:
        return createErrorResponse(`Unsupported schema operation: ${schemaOp}`)
    }
  } catch (error) {
    console.error('Schema update error:', error)
    return createErrorResponse(`Schema update failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

async function handleAddField (client, metaCol, recordsCol, metadata, entity, field, user) {
  if (!field || !field.name) return createErrorResponse('Field name is required')

  const existing = metadata.schema.find(s => s.name === field.name)
  if (existing) return createErrorResponse(`Field '${field.name}' already exists`)

  const newField = {
    name: field.name,
    type: field.type || 'string',
    required: field.required || false,
    queryable: field.queryable || false,
    facetable: field.facetable || false,
    editable: field.editable !== false,
    defaultValue: field.defaultValue || null
  }

  metadata.schema.push(newField)
  const currentSchemaVersion = parseInt((metadata.schemaVersionId || 'schema-v0').replace('schema-v', ''))
  metadata.schemaVersionId = `schema-v${currentSchemaVersion + 1}`

  await metaCol.updateOne(
    { entityName: entity },
    { $set: { schema: metadata.schema, schemaVersionId: metadata.schemaVersionId, updatedAt: new Date().toISOString() } }
  )

  // Migrate records with default value
  if (field.defaultValue !== undefined && field.defaultValue !== null) {
    await recordsCol.updateMany(
      { entityName: entity, deleted: false, [`data.${field.name}`]: { $exists: false } },
      { $set: { [`data.${field.name}`]: field.defaultValue, updatedAt: new Date().toISOString(), updatedBy: user } }
    )
  }

  await createVersion(client, entity, 'schema-update-add', user, {}, metadata.recordCount)
  await createAuditLog(client, { entityName: entity, operation: 'schema-add-field', actor: user, status: 'success' })

  return createResponse({ status: 'success', entity, schemaVersion: metadata.schemaVersionId, field: newField, message: `Field '${field.name}' added to schema` })
}

async function handleUpdateField (client, metaCol, metadata, entity, field, user) {
  if (!field || !field.name) return createErrorResponse('Field name is required')

  const idx = metadata.schema.findIndex(s => s.name === field.name)
  if (idx === -1) return createErrorResponse(`Field '${field.name}' not found in schema`)

  if (field.name === metadata.primaryKey && field.type && field.type !== metadata.schema[idx].type) {
    return createErrorResponse('Cannot change type of primary key field')
  }

  if (field.type !== undefined) metadata.schema[idx].type = field.type
  if (field.required !== undefined) metadata.schema[idx].required = field.required
  if (field.queryable !== undefined) metadata.schema[idx].queryable = field.queryable
  if (field.facetable !== undefined) metadata.schema[idx].facetable = field.facetable
  if (field.editable !== undefined) metadata.schema[idx].editable = field.editable

  const currentSchemaVersion = parseInt((metadata.schemaVersionId || 'schema-v0').replace('schema-v', ''))
  metadata.schemaVersionId = `schema-v${currentSchemaVersion + 1}`

  await metaCol.updateOne(
    { entityName: entity },
    { $set: { schema: metadata.schema, schemaVersionId: metadata.schemaVersionId, updatedAt: new Date().toISOString() } }
  )

  await createVersion(client, entity, 'schema-update-field', user, {}, metadata.recordCount)
  await createAuditLog(client, { entityName: entity, operation: 'schema-update-field', actor: user, status: 'success' })

  return createResponse({ status: 'success', entity, schemaVersion: metadata.schemaVersionId, field: metadata.schema[idx], message: `Field '${field.name}' updated` })
}

async function handleRemoveField (client, metaCol, metadata, entity, field, user) {
  if (!field || !field.name) return createErrorResponse('Field name is required')
  if (field.name === metadata.primaryKey) return createErrorResponse('Cannot remove primary key field')

  const idx = metadata.schema.findIndex(s => s.name === field.name)
  if (idx === -1) return createErrorResponse(`Field '${field.name}' not found in schema`)

  metadata.schema.splice(idx, 1)
  const currentSchemaVersion = parseInt((metadata.schemaVersionId || 'schema-v0').replace('schema-v', ''))
  metadata.schemaVersionId = `schema-v${currentSchemaVersion + 1}`

  await metaCol.updateOne(
    { entityName: entity },
    { $set: { schema: metadata.schema, schemaVersionId: metadata.schemaVersionId, updatedAt: new Date().toISOString() } }
  )

  await createVersion(client, entity, 'schema-remove-field', user, {}, metadata.recordCount)
  await createAuditLog(client, { entityName: entity, operation: 'schema-remove-field', actor: user, status: 'success' })

  return createResponse({ status: 'success', entity, schemaVersion: metadata.schemaVersionId, message: `Field '${field.name}' removed from schema` })
}

async function handleRenameField (client, metaCol, recordsCol, metadata, entity, field, user) {
  if (!field || !field.name || !field.newName) return createErrorResponse('Field name and newName are required')
  if (field.name === metadata.primaryKey) return createErrorResponse('Cannot rename primary key field')

  const idx = metadata.schema.findIndex(s => s.name === field.name)
  if (idx === -1) return createErrorResponse(`Field '${field.name}' not found in schema`)
  if (metadata.schema.find(s => s.name === field.newName)) return createErrorResponse(`Field '${field.newName}' already exists`)

  metadata.schema[idx].name = field.newName

  // Rename field in all records using $rename
  await recordsCol.updateMany(
    { entityName: entity, deleted: false, [`data.${field.name}`]: { $exists: true } },
    { $rename: { [`data.${field.name}`]: `data.${field.newName}` } }
  )

  const currentSchemaVersion = parseInt((metadata.schemaVersionId || 'schema-v0').replace('schema-v', ''))
  metadata.schemaVersionId = `schema-v${currentSchemaVersion + 1}`

  await metaCol.updateOne(
    { entityName: entity },
    { $set: { schema: metadata.schema, schemaVersionId: metadata.schemaVersionId, updatedAt: new Date().toISOString() } }
  )

  await createVersion(client, entity, 'schema-rename-field', user, {}, metadata.recordCount)
  await createAuditLog(client, { entityName: entity, operation: 'schema-rename-field', actor: user, status: 'success' })

  return createResponse({ status: 'success', entity, schemaVersion: metadata.schemaVersionId, message: `Field '${field.name}' renamed to '${field.newName}'` })
}

async function handleReplaceSchema (client, metaCol, metadata, entity, fields, user) {
  if (!fields || !Array.isArray(fields)) return createErrorResponse('Fields array is required')

  const currentSchemaVersion = parseInt((metadata.schemaVersionId || 'schema-v0').replace('schema-v', ''))
  const schemaVersionId = `schema-v${currentSchemaVersion + 1}`

  await metaCol.updateOne(
    { entityName: entity },
    { $set: { schema: fields, schemaVersionId, updatedAt: new Date().toISOString() } }
  )

  await createVersion(client, entity, 'schema-replace', user, {}, metadata.recordCount)

  return createResponse({ status: 'success', entity, schemaVersion: schemaVersionId, message: 'Schema replaced' })
}

/**
 * Update facets configuration for an entity.
 * Allows toggling facetable on fields + configuring facet display settings.
 */
async function handleUpdateFacets (client, metaCol, metadata, entity, params, user) {
  const { facetableFields, facetsConfig } = params

  // Update facetable flag on schema fields
  if (Array.isArray(facetableFields)) {
    metadata.schema = metadata.schema.map(f => ({
      ...f,
      facetable: facetableFields.includes(f.name)
    }))
  }

  // Build facets configuration
  const facetFields = metadata.schema.filter(f => f.facetable).map(f => f.name)
  const facets = {
    enabled: facetFields.length > 0,
    fields: facetFields.map(fieldName => {
      const fieldConfig = (facetsConfig && facetsConfig[fieldName]) || {}
      const existingConfig = (metadata.facets && metadata.facets.fields || []).find(fc => fc.field === fieldName) || {}
      return {
        field: fieldName,
        label: fieldConfig.label || existingConfig.label || fieldName,
        type: fieldConfig.type || existingConfig.type || 'value',
        sortBy: fieldConfig.sortBy || existingConfig.sortBy || 'count',
        sortOrder: fieldConfig.sortOrder || existingConfig.sortOrder || 'desc',
        limit: fieldConfig.limit || existingConfig.limit || 50,
        showCount: fieldConfig.showCount !== undefined ? fieldConfig.showCount : (existingConfig.showCount !== false),
        collapsed: fieldConfig.collapsed !== undefined ? fieldConfig.collapsed : (existingConfig.collapsed || false)
      }
    }),
    returnWithQuery: (facetsConfig && facetsConfig.returnWithQuery !== undefined) ? facetsConfig.returnWithQuery : (metadata.facets ? metadata.facets.returnWithQuery : true),
    maxValuesPerFacet: (facetsConfig && facetsConfig.maxValuesPerFacet) || (metadata.facets ? metadata.facets.maxValuesPerFacet : 100)
  }

  const currentSchemaVersion = parseInt((metadata.schemaVersionId || 'schema-v0').replace('schema-v', ''))
  const schemaVersionId = `schema-v${currentSchemaVersion + 1}`

  await metaCol.updateOne(
    { entityName: entity },
    { $set: { schema: metadata.schema, facets, schemaVersionId, updatedAt: new Date().toISOString() } }
  )

  await createVersion(client, entity, 'facets-update', user, {}, metadata.recordCount)
  await createAuditLog(client, { entityName: entity, operation: 'facets-update', actor: user, status: 'success' })

  return createResponse({
    status: 'success',
    entity,
    schemaVersion: schemaVersionId,
    facets,
    message: `Facets configuration updated. ${facetFields.length} field(s) configured.`
  })
}

exports.main = main
