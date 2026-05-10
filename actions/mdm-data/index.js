/**
 * MDM Data Action — Public API exposed via API Mesh
 *
 * This is the SINGLE action invoked by API Mesh to serve master data.
 *
 * Caching is handled by API Mesh CDN layer. This action always queries
 * the database directly.
 *
 * No IMS auth required for public entities.
 * IMS auth required for private entities (passed via Mesh headers).
 */

const { Core } = require('@adobe/aio-sdk')
const { getDbClient, safeFindOne, escapeRegex, validateMasterName, checkRateLimit, COLLECTIONS, getMasterCollection, getEnvConfig, getCachedSettings, validatePartner, createAuditLog, validateRecord, computeFieldChanges, publishMutationEvent, checkStorageGuardrails, getNextSequenceId } = require('../mdm-utils')

// ============ Main Action ============

/**
 * System audit fields that are NEVER exposed via API Mesh responses.
 * They are only visible in Admin UI (query-data, record-crud) and CSV exports.
 */
const SYSTEM_AUDIT_FIELDS = ['_createdAt', '_updatedAt', '_createdBy', '_updatedBy']

/** Strip system audit fields from a data record for public API responses */
function stripSystemFields (data) {
  if (!data || typeof data !== 'object') return data
  const clean = { ...data }
  for (const f of SYSTEM_AUDIT_FIELDS) delete clean[f]
  return clean
}

async function main (params) {
  const logger = Core.Logger('mdm-data', { level: params.LOG_LEVEL || 'info' })

  if (params.__ow_method === 'options') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-forwarded-authorization, x-partner-id, x-partner-key',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
      },
      body: {}
    }
  }

  const method = (params.__ow_method || 'get').toLowerCase()

  // For POST/PUT/PATCH, body may arrive in __ow_body (base64 or JSON) — merge into params
  if (['post', 'put', 'patch'].includes(method) && params.__ow_body && !params.data) {
    try {
      const raw = params.__ow_body
      const parsed = typeof raw === 'object' ? raw
        : (() => { try { return JSON.parse(raw) } catch (e) { return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8')) } })()
      Object.assign(params, parsed)
    } catch (e) { /* ignore parse errors */ }
  }

  let client
  try {
    const entity = params.master || params.entity
    if (!entity) return createErrorResponse('Missing required parameter: master', 400)
    if (!validateMasterName(entity)) return createErrorResponse('Invalid master name', 400)

    client = await getDbClient(params)

    // Rate limiting check
    const env = getEnvConfig(params)
    const clientIp = (params.__ow_headers && params.__ow_headers['x-forwarded-for']) || 'anonymous'
    const settingsDoc = await getCachedSettings(client)
    const rateLimit = settingsDoc?.api?.rateLimitPerMinute || settingsDoc?.performance?.rateLimitPerMinute || env.rateLimitPerMinute
    const rateLimitResult = await checkRateLimit(client, clientIp, rateLimit)
    if (!rateLimitResult.allowed) {
      return createErrorResponse('Rate limit exceeded. Try again later.', 429)
    }

    const metaCol = await client.collection('metadata')
    const metadata = await safeFindOne(metaCol, { masterName: entity })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Master '${entity}' not found`, 404)
    }

    // Route by method
    if (method === 'get') {
      return await handleRead(params, client, metadata, entity, settingsDoc, env, logger)
    }

    // --- Write operations (POST/PUT/PATCH/DELETE) ---
    // Require public visibility
    if (metadata.visibility !== 'public') {
      return createErrorResponse('CRUD operations via API are only available for public masters', 403)
    }

    // Require CRUD to be enabled
    if (!metadata.crudEnabled) {
      return createErrorResponse('CRUD operations are disabled for this master. Enable them in the Admin Console.', 403)
    }

    // Require valid partner credentials
    const partnerResult = await validatePartner(client, params)
    if (!partnerResult.valid) {
      return createErrorResponse(partnerResult.error, 401)
    }

    // Check if partner is allowed to access this master
    const partner = partnerResult.partner
    const allowedMasters = partner.allowedMasters || partner.allowedEntities || []
    if (!allowedMasters.includes(entity)) {
      return createErrorResponse(`Partner '${partner.name}' is not authorized for master '${entity}'`, 403)
    }

    const masterCol = await getMasterCollection(client, entity)

    // All mutations routed via 'operation' query param (everything is POST from API Mesh)
    const operation = params.operation
    if (operation) {
      switch (operation) {
        case 'create':
          return await handlePublicCreate(client, metaCol, masterCol, metadata, entity, params, partner)
        case 'update':
          return await handlePublicUpdate(client, masterCol, metadata, entity, params, partner)
        case 'patch':
          return await handlePublicPatch(client, masterCol, metadata, entity, params, partner)
        case 'delete':
          return await handlePublicDelete(client, metaCol, masterCol, metadata, entity, params, partner)
        case 'bulkCreate':
          return await handleBulkCreate(client, metaCol, masterCol, metadata, entity, params, partner)
        case 'bulkUpdate':
          return await handleBulkUpdate(client, masterCol, metadata, entity, params, partner)
        case 'bulkPatch':
          return await handleBulkPatch(client, masterCol, metadata, entity, params, partner)
        case 'bulkDelete':
          return await handleBulkDelete(client, metaCol, masterCol, metadata, entity, params, partner)
        default:
          return createErrorResponse(`Unknown operation: ${operation}`, 400)
      }
    }

    // Fallback: route by HTTP method (backwards compat for direct API calls)
    switch (method) {
      case 'post':
        return await handlePublicCreate(client, metaCol, masterCol, metadata, entity, params, partner)
      case 'put':
        return await handlePublicUpdate(client, masterCol, metadata, entity, params, partner)
      case 'patch':
        return await handlePublicPatch(client, masterCol, metadata, entity, params, partner)
      case 'delete':
        return await handlePublicDelete(client, metaCol, masterCol, metadata, entity, params, partner)
      default:
        return createErrorResponse(`Unsupported method: ${method}`, 405)
    }
  } catch (error) {
    logger.error('MDM Data action error:', error)
    return createErrorResponse(`Operation failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

// ============ Read Handler ============

async function handleRead (params, client, metadata, entity, settingsDoc, env, logger) {
    const id = params.id != null ? String(params.id) : null

    // --- Visibility check ---
    if (metadata.visibility === 'private') {
      const authHeader = params.__ow_headers && (params.__ow_headers.authorization || params.__ow_headers['x-forwarded-authorization'])
      if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.length < 30) {
        return createErrorResponse('Authentication required for private master. Provide a valid Bearer token.', 401)
      }
    }

    // --- Single record by ID ---
    if (id) {
      const masterCol = await getMasterCollection(client, entity)
      const record = await safeFindOne(masterCol, { primaryKey: id, deleted: false })

      if (!record) return createErrorResponse(`Record '${id}' not found`, 404)

      return createResponse({
        master: entity,
        data: stripSystemFields(record.data)
      })
    }

    // --- Multiple records by IDs (bulk fetch) ---
    if (params.ids) {
      const idList = params.ids.split(',').map(s => s.trim()).filter(Boolean)
      const masterCol = await getMasterCollection(client, entity)
      const matchedRecs = await masterCol.find({ primaryKey: { $in: idList }, deleted: { $ne: true } }).toArray()
      const foundMap = new Map(matchedRecs.map(r => [r.primaryKey, stripSystemFields(r.data)]))
      const found = []
      const notFound = []
      for (const rid of idList) {
        if (foundMap.has(rid)) found.push(foundMap.get(rid))
        else notFound.push(rid)
      }
      return createResponse({
        master: entity,
        count: found.length,
        requested: idList.length,
        data: found,
        notFound: notFound.length > 0 ? notFound : undefined
      })
    }

    // --- List query with filters ---
    const systemParams = [
      'master', 'entity', 'id', 'ids', 'operation', 'page', 'pageSize', 'sort', 'order', 'fields', 'facets', 'filters',
      '__ow_method', '__ow_headers', '__ow_path', '__ow_query', '__ow_body',
      '__ims_oauth_s2s', 'LOG_LEVEL'
    ]
    const filters = {}

    // Support filters as JSON string, key=value pairs, or individual query params
    if (params.filters && params.filters !== 'undefined') {
      try {
        const parsed = typeof params.filters === 'string' ? JSON.parse(params.filters) : params.filters
        if (parsed && typeof parsed === 'object') {
          Object.assign(filters, parsed)
        }
      } catch (e) {
        // Not valid JSON — parse as key=value pairs (e.g. "sku=1" or "sku=1,name=test" or "sku=1&name=test")
        const pairs = params.filters.split(/[,&]/)
        for (const pair of pairs) {
          const eqIdx = pair.indexOf('=')
          if (eqIdx > 0) {
            const key = decodeURIComponent(pair.substring(0, eqIdx).trim())
            const val = decodeURIComponent(pair.substring(eqIdx + 1).trim())
            if (key) filters[key] = val
          }
        }
      }
    }

    // Also pick up individual filter params from the actual URL query string only
    // (avoids runtime-injected params being treated as data filters)
    if (params.__ow_query) {
      const queryParams = new URLSearchParams(params.__ow_query)
      for (const [key, value] of queryParams.entries()) {
        if (!systemParams.includes(key) && !key.startsWith('__') && value) {
          filters[key] = value
        }
      }
    }

    const page = Math.max(1, parseInt(params.page) || 1)
    const apiSettings = settingsDoc?.value?.api || settingsDoc?.api || {}
    const maxPageSize = apiSettings.maxPageSize || env.maxPageSize
    const defaultPageSize = apiSettings.defaultPageSize || env.defaultPageSize
    const pageSize = Math.min(maxPageSize, Math.max(1, parseInt(params.pageSize) || defaultPageSize))
    const sort = (params.sort && params.sort !== 'undefined') ? params.sort : metadata.primaryKey
    const order = params.order === 'desc' ? 'desc' : 'asc'
    const fields = (params.fields && params.fields !== 'undefined') ? params.fields.split(',').map(f => f.trim()) : null

    // --- Query from DB (per-master collection) ---
    const masterCol = await getMasterCollection(client, entity)

    const sortDir = order === 'asc' ? 1 : -1
    const filterKeys = Object.keys(filters)

    let responseData, total

    // Build DB-level query filter
    const dbFilter = { deleted: { $ne: true }, status: { $ne: 'deleted' } }

    // Apply data-level filters at DB level (case-insensitive regex match)
    for (const key of filterKeys) {
      dbFilter[`data.${key}`] = { $regex: `^${escapeRegex(filters[key])}$`, $options: 'i' }
    }

    // DB-level count, sort, skip, limit
    total = await masterCol.countDocuments(dbFilter)
    const cursor = masterCol.find(dbFilter)
      .sort({ [`data.${sort}`]: sortDir })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
    const paged = await cursor.toArray()
    responseData = paged.map(r => stripSystemFields(r.data))

    // Apply field selection
    if (fields && fields.length > 0) {
      responseData = responseData.map(record => {
        const selected = {}
        fields.forEach(f => { if (record[f] !== undefined) selected[f] = record[f] })
        return selected
      })
    }

    const responseBody = {
      master: entity,
      count: responseData.length,
      page,
      pageSize,
      total,
      data: responseData
    }

    // --- Compute aggregations/facets if configured ---
    const facetsParam = params.facets
    const shouldReturnFacets = metadata.facets && metadata.facets.enabled &&
      (metadata.facets.returnWithQuery || facetsParam === 'true' || facetsParam === '1') &&
      facetsParam !== 'undefined'

    if (shouldReturnFacets && metadata.facets.fields && metadata.facets.fields.length > 0) {
      const aggregations = []

      for (const facetConfig of metadata.facets.fields) {
        const fieldName = facetConfig.field
        const maxValues = facetConfig.limit || metadata.facets.maxValuesPerFacet || 100

        // Build facet filter: all active filters EXCEPT the current facet field (OR-style faceting)
        const facetFilter = { deleted: { $ne: true }, status: { $ne: 'deleted' } }
        for (const key of filterKeys) {
          if (key === fieldName) continue
          facetFilter[`data.${key}`] = { $regex: `^${escapeRegex(filters[key])}$`, $options: 'i' }
        }

        // Use aggregation pipeline for facet counting
        const sortStage = facetConfig.sortBy === 'count'
          ? { count: facetConfig.sortOrder === 'asc' ? 1 : -1 }
          : { _id: facetConfig.sortOrder === 'asc' ? 1 : -1 }

        const pipeline = masterCol.aggregate()
          .match(facetFilter)
          .match({ [`data.${fieldName}`]: { $exists: true, $ne: null, $ne: '' } })
          .group({ _id: `$data.${fieldName}`, count: { $sum: 1 } })
          .sort(sortStage)
          .limit(maxValues)

        const facetResults = await pipeline.toArray()

        aggregations.push({
          field: fieldName,
          label: facetConfig.label || fieldName,
          type: facetConfig.type || 'value',
          showCount: facetConfig.showCount !== false,
          collapsed: facetConfig.collapsed || false,
          values: facetResults.map(r => ({
            value: String(r._id),
            count: r.count,
            selected: filters[fieldName] ? String(filters[fieldName]).toLowerCase() === String(r._id).toLowerCase() : false
          }))
        })
      }

      responseBody.aggregations = aggregations
    }

    return createResponse(responseBody)
}

// ============ Public CRUD Handlers ============

/**
 * Parse record data from params.
 * Data can come from: params.data (JSON string from mesh arg), __ow_body (base64 or plain JSON).
 */
function parseRecordData (params) {
  // 1. params.data — directly merged from POST body or mesh arg
  if (params.data && typeof params.data === 'string') {
    try { return JSON.parse(params.data) } catch (e) { return null }
  }
  if (params.data && typeof params.data === 'object') return params.data

  // 2. __ow_body — may be base64-encoded or plain JSON string
  let body = null
  if (params.__ow_body) {
    const raw = params.__ow_body
    if (typeof raw === 'object') {
      body = raw
    } else if (typeof raw === 'string') {
      // Try plain JSON first, then base64
      try { body = JSON.parse(raw) } catch (e) {
        try { body = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8')) } catch (e2) { body = {} }
      }
    }
  }
  if (body && body.data) {
    if (typeof body.data === 'string') {
      try { return JSON.parse(body.data) } catch (e) { return null }
    }
    if (typeof body.data === 'object') return body.data
  }
  return null
}

function injectAudit (data, auditConfig, actor, isCreate, now) {
  if (!auditConfig || !auditConfig.enabled) return
  if (isCreate) {
    if (auditConfig.createdAt) data._createdAt = now
    if (auditConfig.updatedAt) data._updatedAt = now
    if (auditConfig.createdBy) data._createdBy = actor
    if (auditConfig.updatedBy) data._updatedBy = actor
  } else {
    if (auditConfig.updatedAt) data._updatedAt = now
    if (auditConfig.updatedBy) data._updatedBy = actor
  }
}

async function handlePublicCreate (client, metaCol, masterCol, metadata, entity, params, partner) {
  const data = parseRecordData(params)
  if (!data || typeof data !== 'object') {
    return createMutationResponse({ error: 'Missing or invalid "data" in request body' }, 400)
  }

  // Strip system fields — auto-managed server-side
  ;['createdAt', 'updatedAt', 'createdBy', 'updatedBy'].forEach(f => delete data[f])

  const pkField = metadata.primaryKey
  if (!pkField) {
    return createMutationResponse({ error: 'Primary key field is not configured' }, 400)
  }

  // Auto-generate primary key if not provided (auto-increment with collision retry)
  const autoGenPk = !data[pkField]
  if (autoGenPk) {
    data[pkField] = await getNextSequenceId(client, entity)
    // If this PK already exists (counter out of sync), keep incrementing
    let retries = 10
    while (retries-- > 0) {
      const collision = await safeFindOne(masterCol, { primaryKey: String(data[pkField]) })
      if (!collision) break
      data[pkField] = await getNextSequenceId(client, entity)
    }
  }

  // Check allowed operations (stored as object: { create: true, update: true, ... })
  const allowedOps = metadata.allowedOperations || { create: true, update: true, delete: true }
  if (!allowedOps.create) {
    return createMutationResponse({ error: 'Create operation is not allowed for this master' }, 403)
  }

  // Validate against schema if present
  if (metadata.schema && metadata.schema.length > 0) {
    const validationErrors = validateRecord(data, metadata.schema, { primaryKey: metadata.primaryKey })
    if (validationErrors.length > 0) {
      return createMutationResponse({ error: `Validation failed: ${validationErrors.join(', ')}` }, 400)
    }
  }

  // Check for duplicate primary key
  const existing = await safeFindOne(masterCol, { primaryKey: String(data[pkField]), deleted: false })
  if (existing) {
    return createMutationResponse({ error: `Record with ${pkField}="${data[pkField]}" already exists` }, 409)
  }

  // Storage guardrails
  const guardrails = await checkStorageGuardrails(client, { newDocumentCount: 1, entity, params })
  if (!guardrails.allowed) {
    return createMutationResponse({ error: `Storage guardrail: ${guardrails.reason}` }, 507)
  }

  const now = new Date()

  // Inject record-level audit fields with partner name as actor
  const partnerActor = `partner:${partner.name}`
  injectAudit(data, metadata.recordAudit, partnerActor, true, now)

  const record = {
    primaryKey: String(data[pkField]),
    data,
    deleted: false,
    createdAt: now,
    updatedAt: now,
    source: 'api',
    partnerId: partner.partnerId
  }

  await masterCol.insertOne(record)

  // Atomically increment record count + update lastModifiedBy
  await metaCol.updateOne({ masterName: entity }, { $set: { lastModifiedBy: partnerActor }, $currentDate: { updatedAt: true }, $inc: { recordCount: 1 } })

  // Audit log
  await createAuditLog(client, {
    action: 'api-create',
    masterName: entity,
    user: `partner:${partner.partnerId} (${partner.name})`,
    detail: `Record created via public API: ${pkField}=${data[pkField]}`
  })

  return createMutationResponse({
    success: true,
    master: entity,
    operation: 'create',
    record: stripSystemFields(data)
  }, 201)
}

async function handlePublicUpdate (client, masterCol, metadata, entity, params, partner) {
  const data = parseRecordData(params)
  const body = typeof params.__ow_body === 'string' ? (() => { try { return JSON.parse(params.__ow_body) } catch (e) { return {} } })() : (params.__ow_body || {})
  const id = (params.id || body.id) != null ? String(params.id || body.id) : null
  if (!id) return createMutationResponse({ error: 'Missing record ID (pass as "id" parameter or in body)' }, 400)
  if (!data || typeof data !== 'object') {
    return createMutationResponse({ error: 'Missing or invalid "data" in request body' }, 400)
  }

  // Strip system fields — auto-managed server-side
  ;['createdAt', 'updatedAt', 'createdBy', 'updatedBy'].forEach(f => delete data[f])

  const allowedOps = metadata.allowedOperations || { create: true, update: true, delete: true }
  if (!allowedOps.update) {
    return createMutationResponse({ error: 'Update operation is not allowed for this master' }, 403)
  }

  const existing = await safeFindOne(masterCol, { primaryKey: id, deleted: false })
  if (!existing) return createMutationResponse({ error: `Record '${id}' not found` }, 404)

  // Primary key is immutable — preserve existing value
  const pkField = metadata.primaryKey
  if (pkField) data[pkField] = existing.data[pkField]

  // Validate against schema
  if (metadata.schema && metadata.schema.length > 0) {
    const validationErrors = validateRecord(data, metadata.schema, { primaryKey: metadata.primaryKey })
    if (validationErrors.length > 0) {
      return createMutationResponse({ error: `Validation failed: ${validationErrors.join(', ')}` }, 400)
    }
  }

  const changes = computeFieldChanges(existing.data, data)
  const now = new Date()
  const partnerActor = `partner:${partner.name}`

  // Inject record-level audit fields with partner name
  injectAudit(data, metadata.recordAudit, partnerActor, false, now)

  // Full replace of data
  await masterCol.updateOne(
    { primaryKey: id, deleted: false },
    { $set: { data, source: 'api', partnerId: partner.partnerId }, $currentDate: { updatedAt: true } }
  )

  // Update lastModifiedBy on master metadata
  const metaCol = await client.collection(COLLECTIONS.METADATA)
  await metaCol.updateOne({ masterName: entity }, { $set: { lastModifiedBy: partnerActor }, $currentDate: { updatedAt: true } })

  await createAuditLog(client, {
    action: 'api-update',
    masterName: entity,
    user: `partner:${partner.partnerId} (${partner.name})`,
    detail: `Record updated via public API: ${id}`,
    changes
  })

  return createMutationResponse({
    success: true,
    master: entity,
    operation: 'update',
    record: stripSystemFields(data)
  })
}

async function handlePublicPatch (client, masterCol, metadata, entity, params, partner) {
  const data = parseRecordData(params)
  const body = typeof params.__ow_body === 'string' ? (() => { try { return JSON.parse(params.__ow_body) } catch (e) { return {} } })() : (params.__ow_body || {})
  const id = (params.id || body.id) != null ? String(params.id || body.id) : null
  if (!id) return createMutationResponse({ error: 'Missing record ID (pass as "id" parameter or in body)' }, 400)
  if (!data || typeof data !== 'object') {
    return createMutationResponse({ error: 'Missing or invalid "data" in request body' }, 400)
  }

  const allowedOps = metadata.allowedOperations || { create: true, update: true, delete: true }
  if (!allowedOps.update && !allowedOps.patch) {
    return createMutationResponse({ error: 'Patch/update operation is not allowed for this master' }, 403)
  }

  const existing = await safeFindOne(masterCol, { primaryKey: id, deleted: false })
  if (!existing) return createMutationResponse({ error: `Record '${id}' not found` }, 404)

  // Strip system fields — auto-managed server-side
  ;['createdAt', 'updatedAt', 'createdBy', 'updatedBy'].forEach(f => delete data[f])

  // Primary key is immutable — cannot be changed via patch
  const pkField = metadata.primaryKey
  if (pkField) delete data[pkField]

  // Strip unknown fields from patch data before merge
  if (metadata.schema && metadata.schema.length > 0) {
    const schemaFieldNames = new Set(metadata.schema.map(f => f.name))
    Object.keys(data).forEach(k => { if (!schemaFieldNames.has(k)) delete data[k] })
  }

  // Merge: existing data + patch fields
  const merged = { ...existing.data, ...data }

  // Validate merged result against schema
  if (metadata.schema && metadata.schema.length > 0) {
    const validationErrors = validateRecord(merged, metadata.schema, { primaryKey: metadata.primaryKey })
    if (validationErrors.length > 0) {
      return createMutationResponse({ error: `Validation failed: ${validationErrors.join(', ')}` }, 400)
    }
  }

  const changes = computeFieldChanges(existing.data, merged)
  const now = new Date()
  const partnerActor = `partner:${partner.name}`

  // Inject record-level audit fields with partner name
  injectAudit(merged, metadata.recordAudit, partnerActor, false, now)

  await masterCol.updateOne(
    { primaryKey: id, deleted: false },
    { $set: { data: merged, source: 'api', partnerId: partner.partnerId }, $currentDate: { updatedAt: true } }
  )

  // Update lastModifiedBy on master metadata
  const metaCol = await client.collection(COLLECTIONS.METADATA)
  await metaCol.updateOne({ masterName: entity }, { $set: { lastModifiedBy: partnerActor }, $currentDate: { updatedAt: true } })

  await createAuditLog(client, {
    action: 'api-patch',
    masterName: entity,
    user: `partner:${partner.partnerId} (${partner.name})`,
    detail: `Record patched via public API: ${id}`,
    changes
  })

  return createMutationResponse({
    success: true,
    master: entity,
    operation: 'patch',
    record: stripSystemFields(merged)
  })
}

async function handlePublicDelete (client, metaCol, masterCol, metadata, entity, params, partner) {
  const body = typeof params.__ow_body === 'string' ? (() => { try { return JSON.parse(params.__ow_body) } catch (e) { return {} } })() : (params.__ow_body || {})
  const id = (params.id || body.id) != null ? String(params.id || body.id) : null
  if (!id) return createMutationResponse({ error: 'Missing record ID (pass as "id" parameter or in body)' }, 400)

  const allowedOps = metadata.allowedOperations || { create: true, update: true, delete: true }
  if (!allowedOps.delete) {
    return createMutationResponse({ error: 'Delete operation is not allowed for this master' }, 403)
  }

  const existing = await safeFindOne(masterCol, { primaryKey: id, deleted: false })
  if (!existing) return createMutationResponse({ error: `Record '${id}' not found` }, 404)

  // Soft delete
  await masterCol.updateOne(
    { primaryKey: id, deleted: false },
    { $set: { deleted: true, deletedBy: `partner:${partner.partnerId}`, source: 'api' }, $currentDate: { updatedAt: true, deletedAt: true } }
  )

  // Atomically decrement record count + update lastModifiedBy
  await metaCol.updateOne({ masterName: entity }, { $set: { lastModifiedBy: `partner:${partner.name}` }, $currentDate: { updatedAt: true }, $inc: { recordCount: -1 } })

  await createAuditLog(client, {
    action: 'api-delete',
    masterName: entity,
    user: `partner:${partner.partnerId} (${partner.name})`,
    detail: `Record deleted via public API: ${id}`
  })

  return createMutationResponse({
    success: true,
    master: entity,
    operation: 'delete',
    id
  })
}

// ============ Bulk CRUD Handlers ============

/**
 * Parse bulk data from params. Expects a JSON string of an array.
 */
function parseBulkData (params) {
  if (params.data && typeof params.data === 'string') {
    try {
      const parsed = JSON.parse(params.data)
      return Array.isArray(parsed) ? parsed : null
    } catch (e) { return null }
  }
  if (params.data && Array.isArray(params.data)) return params.data
  if (params.__ow_body) {
    const raw = params.__ow_body
    let body = null
    if (typeof raw === 'object') body = raw
    else if (typeof raw === 'string') {
      try { body = JSON.parse(raw) } catch (e) {
        try { body = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8')) } catch (e2) { return null }
      }
    }
    if (body) {
      if (Array.isArray(body)) return body
      if (body.data) {
        if (typeof body.data === 'string') {
          try { const arr = JSON.parse(body.data); return Array.isArray(arr) ? arr : null } catch (e) { return null }
        }
        if (Array.isArray(body.data)) return body.data
      }
    }
  }
  return null
}

async function handleBulkCreate (client, metaCol, masterCol, metadata, entity, params, partner) {
  const records = parseBulkData(params)
  if (!records || records.length === 0) {
    return createMutationResponse({ error: 'Missing or invalid "data" — expected JSON array of records' }, 400)
  }

  const pkField = metadata.primaryKey
  const allowedOps = metadata.allowedOperations || { create: true, update: true, delete: true }
  if (!allowedOps.create) {
    return createMutationResponse({ error: 'Create operation is not allowed for this master' }, 403)
  }

  const guardrails = await checkStorageGuardrails(client, { newDocumentCount: records.length, entity, params })
  if (!guardrails.allowed) {
    return createMutationResponse({ error: `Storage guardrail: ${guardrails.reason}` }, 507)
  }

  const now = new Date()
  const partnerActor = `partner:${partner.name}`

  // Count records needing auto-generated IDs
  const needAutoIdCount = records.filter(d => d && typeof d === 'object' && !d[pkField]).length
  let lastAutoId = 0
  if (needAutoIdCount > 0) {
    lastAutoId = await getNextSequenceId(client, entity, needAutoIdCount)
  }
  let autoIdStart = lastAutoId - needAutoIdCount + 1

  const results = []
  const bulkOps = []

  // Pre-compute PKs and batch-fetch existing records with $in
  const pksToCheck = []
  const recordPks = []
  for (const data of records) {
    if (!data || typeof data !== 'object') { recordPks.push(null); continue }
    let pk = data[pkField]
    if (!pk) {
      pk = autoIdStart++
      recordPks.push(String(pk))
    } else {
      pk = String(pk)
      recordPks.push(pk)
    }
    pksToCheck.push(pk)
  }
  const existingRecords = pksToCheck.length > 0
    ? await masterCol.find({ primaryKey: { $in: pksToCheck }, deleted: false }).toArray()
    : []
  const existingSet = new Set(existingRecords.map(r => r.primaryKey))

  for (let i = 0; i < records.length; i++) {
    const data = records[i]
    try {
      if (!data || typeof data !== 'object') {
        results.push({ success: false, id: null, error: 'Invalid record data' })
        continue
      }
      ;['createdAt', 'updatedAt', 'createdBy', 'updatedBy'].forEach(f => delete data[f])

      if (!pkField) {
        results.push({ success: false, id: null, error: 'Primary key field is not configured' })
        continue
      }

      const pk = recordPks[i]
      if (!data[pkField]) data[pkField] = pk

      if (metadata.schema && metadata.schema.length > 0) {
        const errors = validateRecord(data, metadata.schema, { primaryKey: metadata.primaryKey })
        if (errors.length > 0) {
          results.push({ success: false, id: pk, error: `Validation: ${errors.join(', ')}` })
          continue
        }
      }

      if (existingSet.has(pk)) {
        results.push({ success: false, id: pk, error: 'Already exists' })
        continue
      }

      injectAudit(data, metadata.recordAudit, partnerActor, true, now)

      bulkOps.push({
        insertOne: {
          document: {
            primaryKey: pk, data, deleted: false,
            createdAt: now, updatedAt: now,
            source: 'api', partnerId: partner.partnerId
          }
        }
      })
      results.push({ success: true, id: pk })
    } catch (e) {
      results.push({ success: false, id: data?.[pkField] || null, error: e.message })
    }
  }

  // Execute all inserts in a single bulkWrite call
  if (bulkOps.length > 0) {
    await masterCol.bulkWrite(bulkOps, { ordered: false })
  }

  const succeeded = results.filter(r => r.success).length
  if (succeeded > 0) {
    await metaCol.updateOne({ masterName: entity }, { $set: { lastModifiedBy: partnerActor }, $currentDate: { updatedAt: true }, $inc: { recordCount: succeeded } })
  }

  await createAuditLog(client, {
    action: 'api-bulk-create',
    masterName: entity,
    user: `partner:${partner.partnerId} (${partner.name})`,
    detail: `Bulk created ${succeeded}/${records.length} records via API`
  })

  return createMutationResponse({
    master: entity, operation: 'bulkCreate',
    total: records.length, succeeded, failed: records.length - succeeded,
    results
  })
}

async function handleBulkUpdate (client, masterCol, metadata, entity, params, partner) {
  const items = parseBulkData(params)
  if (!items || items.length === 0) {
    return createMutationResponse({ error: 'Missing or invalid "data" — expected JSON array of {id, data} objects' }, 400)
  }

  const allowedOps = metadata.allowedOperations || { create: true, update: true, delete: true }
  if (!allowedOps.update) {
    return createMutationResponse({ error: 'Update operation is not allowed for this master' }, 403)
  }

  const now = new Date()
  const partnerActor = `partner:${partner.name}`
  const results = []
  const bulkOps = []

  // Batch-fetch all existing records with $in
  const idsToFetch = items.map(item => item.id).filter(Boolean)
  const existingRecords = idsToFetch.length > 0
    ? await masterCol.find({ primaryKey: { $in: idsToFetch }, deleted: false }).toArray()
    : []
  const existingMap = new Map(existingRecords.map(r => [r.primaryKey, r]))

  for (const item of items) {
    try {
      const id = item.id
      const data = item.data
      if (!id) { results.push({ success: false, id: null, error: 'Missing "id"' }); continue }
      if (!data || typeof data !== 'object') { results.push({ success: false, id, error: 'Missing or invalid "data"' }); continue }
      ;['createdAt', 'updatedAt', 'createdBy', 'updatedBy'].forEach(f => delete data[f])

      const existing = existingMap.get(id)
      if (!existing) { results.push({ success: false, id, error: 'Not found' }); continue }

      // Primary key is immutable — preserve existing value
      const pkField = metadata.primaryKey
      if (pkField) data[pkField] = existing.data[pkField]

      if (metadata.schema && metadata.schema.length > 0) {
        const errors = validateRecord(data, metadata.schema, { primaryKey: metadata.primaryKey })
        if (errors.length > 0) {
          results.push({ success: false, id, error: `Validation: ${errors.join(', ')}` })
          continue
        }
      }

      injectAudit(data, metadata.recordAudit, partnerActor, false, now)

      bulkOps.push({
        updateOne: {
          filter: { primaryKey: id, deleted: false },
          update: { $set: { data, source: 'api', partnerId: partner.partnerId }, $currentDate: { updatedAt: true } }
        }
      })
      results.push({ success: true, id })
    } catch (e) {
      results.push({ success: false, id: item?.id || null, error: e.message })
    }
  }

  // Execute all updates in a single bulkWrite call
  if (bulkOps.length > 0) {
    await masterCol.bulkWrite(bulkOps, { ordered: false })
  }

  const metaCol = await client.collection(COLLECTIONS.METADATA)
  await metaCol.updateOne({ masterName: entity }, { $set: { lastModifiedBy: partnerActor }, $currentDate: { updatedAt: true } })

  const succeeded = results.filter(r => r.success).length
  await createAuditLog(client, {
    action: 'api-bulk-update',
    masterName: entity,
    user: `partner:${partner.partnerId} (${partner.name})`,
    detail: `Bulk updated ${succeeded}/${items.length} records via API`
  })

  return createMutationResponse({
    master: entity, operation: 'bulkUpdate',
    total: items.length, succeeded, failed: items.length - succeeded,
    results
  })
}

async function handleBulkPatch (client, masterCol, metadata, entity, params, partner) {
  const items = parseBulkData(params)
  if (!items || items.length === 0) {
    return createMutationResponse({ error: 'Missing or invalid "data" — expected JSON array of {id, data} objects' }, 400)
  }

  const allowedOps = metadata.allowedOperations || { create: true, update: true, delete: true }
  if (!allowedOps.update && !allowedOps.patch) {
    return createMutationResponse({ error: 'Patch/update operation is not allowed for this master' }, 403)
  }

  const now = new Date()
  const partnerActor = `partner:${partner.name}`
  const results = []
  const bulkOps = []

  // Batch-fetch all existing records with $in
  const idsToFetch = items.map(item => item.id).filter(Boolean)
  const existingRecords = idsToFetch.length > 0
    ? await masterCol.find({ primaryKey: { $in: idsToFetch }, deleted: false }).toArray()
    : []
  const existingMap = new Map(existingRecords.map(r => [r.primaryKey, r]))

  for (const item of items) {
    try {
      const id = item.id
      const data = item.data
      if (!id) { results.push({ success: false, id: null, error: 'Missing "id"' }); continue }
      if (!data || typeof data !== 'object') { results.push({ success: false, id, error: 'Missing or invalid "data"' }); continue }
      ;['createdAt', 'updatedAt', 'createdBy', 'updatedBy'].forEach(f => delete data[f])

      // Primary key is immutable — cannot be changed via patch
      const pkField = metadata.primaryKey
      if (pkField) delete data[pkField]

      const existing = existingMap.get(id)
      if (!existing) { results.push({ success: false, id, error: 'Not found' }); continue }

      // Strip unknown fields from patch data before merge
      if (metadata.schema && metadata.schema.length > 0) {
        const schemaFieldNames = new Set(metadata.schema.map(f => f.name))
        Object.keys(data).forEach(k => { if (!schemaFieldNames.has(k)) delete data[k] })
      }

      const merged = { ...existing.data, ...data }

      if (metadata.schema && metadata.schema.length > 0) {
        const errors = validateRecord(merged, metadata.schema, { primaryKey: metadata.primaryKey })
        if (errors.length > 0) {
          results.push({ success: false, id, error: `Validation: ${errors.join(', ')}` })
          continue
        }
      }

      injectAudit(merged, metadata.recordAudit, partnerActor, false, now)

      bulkOps.push({
        updateOne: {
          filter: { primaryKey: id, deleted: false },
          update: { $set: { data: merged, source: 'api', partnerId: partner.partnerId }, $currentDate: { updatedAt: true } }
        }
      })
      results.push({ success: true, id })
    } catch (e) {
      results.push({ success: false, id: item?.id || null, error: e.message })
    }
  }

  // Execute all patches in a single bulkWrite call
  if (bulkOps.length > 0) {
    await masterCol.bulkWrite(bulkOps, { ordered: false })
  }

  const metaCol = await client.collection(COLLECTIONS.METADATA)
  await metaCol.updateOne({ masterName: entity }, { $set: { lastModifiedBy: partnerActor }, $currentDate: { updatedAt: true } })

  const succeeded = results.filter(r => r.success).length
  await createAuditLog(client, {
    action: 'api-bulk-patch',
    masterName: entity,
    user: `partner:${partner.partnerId} (${partner.name})`,
    detail: `Bulk patched ${succeeded}/${items.length} records via API`
  })

  return createMutationResponse({
    master: entity, operation: 'bulkPatch',
    total: items.length, succeeded, failed: items.length - succeeded,
    results
  })
}

async function handleBulkDelete (client, metaCol, masterCol, metadata, entity, params, partner) {
  const ids = parseBulkData(params)
  if (!ids || ids.length === 0) {
    return createMutationResponse({ error: 'Missing or invalid "data" — expected JSON array of ID strings' }, 400)
  }

  const allowedOps = metadata.allowedOperations || { create: true, update: true, delete: true }
  if (!allowedOps.delete) {
    return createMutationResponse({ error: 'Delete operation is not allowed for this master' }, 403)
  }

  const now = new Date()
  const partnerActor = `partner:${partner.name}`
  const results = []
  const bulkOps = []

  // Batch-fetch all existing records with $in
  const validIds = ids.filter(id => id && typeof id === 'string')
  const existingRecords = validIds.length > 0
    ? await masterCol.find({ primaryKey: { $in: validIds }, deleted: false }).toArray()
    : []
  const existingSet = new Set(existingRecords.map(r => r.primaryKey))

  for (const id of ids) {
    try {
      if (!id || typeof id !== 'string') {
        results.push({ success: false, id: String(id || ''), error: 'Invalid ID' })
        continue
      }

      if (!existingSet.has(id)) { results.push({ success: false, id, error: 'Not found' }); continue }

      bulkOps.push({
        updateOne: {
          filter: { primaryKey: id, deleted: false },
          update: { $set: { deleted: true, deletedBy: `partner:${partner.partnerId}`, source: 'api' }, $currentDate: { updatedAt: true, deletedAt: true } }
        }
      })
      results.push({ success: true, id })
    } catch (e) {
      results.push({ success: false, id: String(id || ''), error: e.message })
    }
  }

  // Execute all deletes in a single bulkWrite call
  if (bulkOps.length > 0) {
    await masterCol.bulkWrite(bulkOps, { ordered: false })
  }

  const succeeded = results.filter(r => r.success).length
  if (succeeded > 0) {
    await metaCol.updateOne({ masterName: entity }, { $set: { lastModifiedBy: partnerActor }, $currentDate: { updatedAt: true }, $inc: { recordCount: -succeeded } })
  }

  await createAuditLog(client, {
    action: 'api-bulk-delete',
    masterName: entity,
    user: `partner:${partner.partnerId} (${partner.name})`,
    detail: `Bulk deleted ${succeeded}/${ids.length} records via API`
  })

  return createMutationResponse({
    master: entity, operation: 'bulkDelete',
    total: ids.length, succeeded, failed: ids.length - succeeded,
    results
  })
}

// ============ Response Helpers (public API uses custom cache headers) ============

function createResponse (body, statusCode = 200) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-forwarded-authorization, x-partner-id, x-partner-key',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Cache-Control': statusCode >= 400 ? 'no-store' : 'public, max-age=60, s-maxage=900'
    },
    body: statusCode === 200 ? body : { ...body, statusCode }
  }
}

function createMutationResponse (body, statusCode = 200) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-forwarded-authorization, x-partner-id, x-partner-key',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Cache-Control': 'no-store'
    },
    body: statusCode === 200 ? body : { ...body, statusCode }
  }
}

function createErrorResponse (message, statusCode = 400) {
  return createResponse({ error: message }, statusCode)
}

exports.main = main
