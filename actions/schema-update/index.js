/**
 * MDM Schema Update Action
 * Add, rename, update, or remove schema fields.
 * Migrates existing records in per-master collection when needed.
 */

const { getDbClient, safeFindOne, COLLECTIONS, getMasterCollection, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams, getEnvConfig, getCachedSettings, getTimezoneDate, enforceAppPermission } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const master = params.master || params.entity
    const { operation, field, fields } = params
    if (!master) return createErrorResponse('Missing required parameter: master')

    client = await getDbClient(params)

    // App-level RBAC
    const appPerm = await enforceAppPermission(client, params, 'schema-update')
    if (!appPerm.allowed) return appPerm.response

    const user = await getUserFromParams(params, client)
    const metaCol = await client.collection(COLLECTIONS.METADATA)
    const masterCol = await getMasterCollection(client, master)

    const metadata = await safeFindOne(metaCol, { masterName: master })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Master '${master}' not found`, 404)
    }

    const schemaOp = operation || 'add'

    switch (schemaOp) {
      case 'add':
        return await handleAddField(client, metaCol, masterCol, metadata, master, field, user, params)
      case 'update':
        return await handleUpdateField(client, metaCol, metadata, master, field, user, params)
      case 'remove':
        return await handleRemoveField(client, metaCol, metadata, master, field, user, params)
      case 'rename':
        return await handleRenameField(client, metaCol, masterCol, metadata, master, field, user, params)
      case 'replace':
        return await handleReplaceSchema(client, metaCol, metadata, master, fields, user, params)
      case 'update-facets':
        return await handleUpdateFacets(client, metaCol, metadata, master, params, user)
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

async function handleAddField (client, metaCol, masterCol, metadata, master, field, user, params) {
  if (!field || !field.name) return createErrorResponse('Field name is required')

  const existing = metadata.schema.find(s => s.name === field.name)
  if (existing) return createErrorResponse(`Field '${field.name}' already exists`)

  // Enforce maxSchemaFields from settings
  const env = getEnvConfig(params)
  const settingsDoc = await getCachedSettings(client)
  const maxSchemaFields = settingsDoc?.dataManagement?.maxSchemaFields || env.maxSchemaFields
  if (metadata.schema.length >= maxSchemaFields) {
    return createErrorResponse(`Schema already has ${metadata.schema.length} fields — max ${maxSchemaFields} allowed. Remove unused fields or increase the limit in Settings.`, 422)
  }

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
    { masterName: master },
    { $set: { schema: metadata.schema, schemaVersionId: metadata.schemaVersionId, updatedAt: getTimezoneDate(params), lastModifiedBy: user } }
  )

  // Migrate records with default value in per-master collection
  if (field.defaultValue !== undefined && field.defaultValue !== null) {
    const allRecs = await masterCol.find({}).toArray()
    const toUpdate = allRecs.filter(r => r.deleted !== true && r.data && r.data[field.name] === undefined)
    for (const rec of toUpdate) {
      rec.data[field.name] = field.defaultValue
      await masterCol.updateOne(
        { primaryKey: rec.primaryKey },
        { $set: { data: rec.data, updatedAt: getTimezoneDate(params), updatedBy: user } }
      )
    }
  }

  await createAuditLog(client, { masterName: master, operation: 'schema-add-field', actor: user, status: 'success' })

  return createResponse({ status: 'success', master, schemaVersion: metadata.schemaVersionId, field: newField, message: `Field '${field.name}' added to schema` })
}

async function handleUpdateField (client, metaCol, metadata, master, field, user, params) {
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
    { masterName: master },
    { $set: { schema: metadata.schema, schemaVersionId: metadata.schemaVersionId, updatedAt: getTimezoneDate(params), lastModifiedBy: user } }
  )

  await createAuditLog(client, { masterName: master, operation: 'schema-update-field', actor: user, status: 'success' })

  return createResponse({ status: 'success', master, schemaVersion: metadata.schemaVersionId, field: metadata.schema[idx], message: `Field '${field.name}' updated` })
}

async function handleRemoveField (client, metaCol, metadata, master, field, user, params) {
  if (!field || !field.name) return createErrorResponse('Field name is required')
  if (field.name === metadata.primaryKey) return createErrorResponse('Cannot remove primary key field')

  const idx = metadata.schema.findIndex(s => s.name === field.name)
  if (idx === -1) return createErrorResponse(`Field '${field.name}' not found in schema`)

  metadata.schema.splice(idx, 1)
  const currentSchemaVersion = parseInt((metadata.schemaVersionId || 'schema-v0').replace('schema-v', ''))
  metadata.schemaVersionId = `schema-v${currentSchemaVersion + 1}`

  await metaCol.updateOne(
    { masterName: master },
    { $set: { schema: metadata.schema, schemaVersionId: metadata.schemaVersionId, updatedAt: getTimezoneDate(params), lastModifiedBy: user } }
  )

  await createAuditLog(client, { masterName: master, operation: 'schema-remove-field', actor: user, status: 'success' })

  return createResponse({ status: 'success', master, schemaVersion: metadata.schemaVersionId, message: `Field '${field.name}' removed from schema` })
}

async function handleRenameField (client, metaCol, masterCol, metadata, master, field, user, params) {
  if (!field || !field.name || !field.newName) return createErrorResponse('Field name and newName are required')
  if (field.name === metadata.primaryKey) return createErrorResponse('Cannot rename primary key field')

  const idx = metadata.schema.findIndex(s => s.name === field.name)
  if (idx === -1) return createErrorResponse(`Field '${field.name}' not found in schema`)
  if (metadata.schema.find(s => s.name === field.newName)) return createErrorResponse(`Field '${field.newName}' already exists`)

  metadata.schema[idx].name = field.newName

  // Rename field in all records in per-master collection
  const allRecs = await masterCol.find({}).toArray()
  const toRename = allRecs.filter(r => r.deleted !== true && r.data && r.data[field.name] !== undefined)
  for (const rec of toRename) {
    rec.data[field.newName] = rec.data[field.name]
    delete rec.data[field.name]
    await masterCol.updateOne(
      { primaryKey: rec.primaryKey },
      { $set: { data: rec.data, updatedAt: getTimezoneDate(params), updatedBy: user } }
    )
  }

  const currentSchemaVersion = parseInt((metadata.schemaVersionId || 'schema-v0').replace('schema-v', ''))
  metadata.schemaVersionId = `schema-v${currentSchemaVersion + 1}`

  await metaCol.updateOne(
    { masterName: master },
    { $set: { schema: metadata.schema, schemaVersionId: metadata.schemaVersionId, updatedAt: getTimezoneDate(params), lastModifiedBy: user } }
  )

  await createAuditLog(client, { masterName: master, operation: 'schema-rename-field', actor: user, status: 'success' })

  return createResponse({ status: 'success', master, schemaVersion: metadata.schemaVersionId, message: `Field '${field.name}' renamed to '${field.newName}'` })
}

async function handleReplaceSchema (client, metaCol, metadata, master, fields, user, params) {
  if (!fields || !Array.isArray(fields)) return createErrorResponse('Fields array is required')

  // Enforce maxSchemaFields from env
  const env = getEnvConfig(params)
  const maxSchemaFields = env.maxSchemaFields
  if (fields.length > maxSchemaFields) {
    return createErrorResponse(`Schema replacement has ${fields.length} fields — max ${maxSchemaFields} allowed.`, 422)
  }

  const currentSchemaVersion = parseInt((metadata.schemaVersionId || 'schema-v0').replace('schema-v', ''))
  const schemaVersionId = `schema-v${currentSchemaVersion + 1}`

  await metaCol.updateOne(
    { masterName: master },
    { $set: { schema: fields, schemaVersionId, updatedAt: getTimezoneDate(params), lastModifiedBy: user } }
  )

  return createResponse({ status: 'success', master, schemaVersion: schemaVersionId, message: 'Schema replaced' })
}

/**
 * Update facets configuration for a master.
 * Allows toggling facetable on fields + configuring facet display settings.
 */
async function handleUpdateFacets (client, metaCol, metadata, master, params, user) {
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
    { masterName: master },
    { $set: { schema: metadata.schema, facets, schemaVersionId, updatedAt: getTimezoneDate(params), lastModifiedBy: user } }
  )

  await createAuditLog(client, { masterName: master, operation: 'facets-update', actor: user, status: 'success' })

  return createResponse({
    status: 'success',
    master,
    schemaVersion: schemaVersionId,
    facets,
    message: `Facets configuration updated. ${facetFields.length} field(s) configured.`
  })
}

exports.main = main
