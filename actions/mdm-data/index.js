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
const { getDbClient, safeFindOne, escapeRegex, validateMasterName, checkRateLimit, COLLECTIONS, getMasterCollection, getEnvConfig, getCachedSettings, validatePartner, createAuditLog, createVersion, validateRecord, computeFieldChanges, publishMutationEvent, checkStorageGuardrails, injectRecordAuditFields, getTimezoneDate } = require('../mdm-utils')

// ============ Main Action ============

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

    // Bulk operations routed via 'operation' query param
    const operation = params.operation
    if (operation) {
      switch (operation) {
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
    const id = params.id || null

    // --- Visibility check ---
    if (metadata.visibility === 'private') {
      const authHeader = params.__ow_headers && (params.__ow_headers.authorization || params.__ow_headers['x-forwarded-authorization'])
      if (!authHeader || authHeader.length < 20) {
        return createErrorResponse('Authentication required for private master', 401)
      }
    }

    // --- Single record by ID ---
    if (id) {
      const masterCol = await getMasterCollection(client, entity)
      const record = await safeFindOne(masterCol, { primaryKey: id, deleted: false })

      if (!record) return createErrorResponse(`Record '${id}' not found`, 404)

      return createResponse({
        master: entity,
        data: record.data
      })
    }

    // --- Multiple records by IDs (bulk fetch) ---
    if (params.ids) {
      const idList = params.ids.split(',').map(s => s.trim()).filter(Boolean)
      const masterCol = await getMasterCollection(client, entity)
      const allRecs = await masterCol.find({}).toArray()
      const found = []
      const notFound = []
      for (const rid of idList) {
        const rec = allRecs.find(r => r.primaryKey === rid && r.deleted !== true)
        if (rec) found.push(rec.data)
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
    const needsJsFilter = filterKeys.length > 0

    let responseData, total

    if (!needsJsFilter) {
      // Fast path: DB-level pagination
      const allRecs = await masterCol.find({}).toArray()
      const active = allRecs.filter(r => r.deleted !== true && r.status !== 'deleted')
      total = active.length
      active.sort((a, b) => {
        const va = a.data?.[sort] || ''
        const vb = b.data?.[sort] || ''
        return sortDir === 1 ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
      })
      const paged = active.slice((page - 1) * pageSize, page * pageSize)
      responseData = paged.map(r => r.data)
    } else {
      // Slow path: filters require JS-level matching
      const allRecords = await masterCol.find({}).toArray()

      let filtered = allRecords.filter(r => r.deleted !== true && r.status !== 'deleted')

      // Apply data-level filters (case-insensitive match)
      filtered = filtered.filter(r => {
        if (!r.data) return false
        return filterKeys.every(key => {
          const pattern = new RegExp(`^${escapeRegex(filters[key])}$`, 'i')
          return pattern.test(String(r.data[key] || ''))
        })
      })

      total = filtered.length
      const paged = filtered.slice((page - 1) * pageSize, page * pageSize)
      responseData = paged.map(r => r.data)
    }

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
      // Facets still require full scan — but only when facets are requested
      const allRecords = await masterCol.find({}).toArray()
      const activeRecords = allRecords.filter(r => r.deleted !== true && r.status !== 'deleted')
      const aggregations = []

      for (const facetConfig of metadata.facets.fields) {
        const fieldName = facetConfig.field
        const maxValues = facetConfig.limit || metadata.facets.maxValuesPerFacet || 100

        // Compute facet values from active records, excluding the current facet field filter
        const facetRecords = activeRecords.filter(r => {
          if (!r.data) return false
          // Apply all data filters EXCEPT the current facet field
          return filterKeys.every(key => {
            if (key === fieldName) return true
            const pattern = new RegExp(`^${escapeRegex(filters[key])}$`, 'i')
            return pattern.test(String(r.data[key] || ''))
          })
        })

        // Count distinct values
        const valueCounts = {}
        for (const r of facetRecords) {
          const val = r.data[fieldName]
          if (val != null && val !== '') {
            const strVal = String(val)
            valueCounts[strVal] = (valueCounts[strVal] || 0) + 1
          }
        }

        // Sort facet values
        let sortedValues = Object.entries(valueCounts)
        if (facetConfig.sortBy === 'count') {
          sortedValues.sort((a, b) => facetConfig.sortOrder === 'asc' ? a[1] - b[1] : b[1] - a[1])
        } else {
          sortedValues.sort((a, b) => facetConfig.sortOrder === 'asc' ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0]))
        }
        sortedValues = sortedValues.slice(0, maxValues)

        aggregations.push({
          field: fieldName,
          label: facetConfig.label || fieldName,
          type: facetConfig.type || 'value',
          showCount: facetConfig.showCount !== false,
          collapsed: facetConfig.collapsed || false,
          values: sortedValues.map(([value, count]) => ({
            value,
            count,
            selected: filters[fieldName] ? String(filters[fieldName]).toLowerCase() === value.toLowerCase() : false
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

async function getNextAutoIncrementId (masterCol, pkField) {
  const allRecs = await masterCol.find({}).toArray()
  let maxId = 0
  for (const r of allRecs) {
    const val = parseInt(r.data?.[pkField])
    if (!isNaN(val) && val > maxId) maxId = val
  }
  return maxId + 1
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

  // Auto-generate primary key if not provided (auto-increment)
  if (!data[pkField]) {
    data[pkField] = await getNextAutoIncrementId(masterCol, pkField)
  }

  // Check allowed operations (stored as object: { create: true, update: true, ... })
  const allowedOps = metadata.allowedOperations || { create: true, update: true, delete: true }
  if (!allowedOps.create) {
    return createMutationResponse({ error: 'Create operation is not allowed for this master' }, 403)
  }

  // Validate against schema if present
  if (metadata.schema && metadata.schema.length > 0) {
    const validationErrors = validateRecord(data, metadata.schema)
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

  const now = getTimezoneDate(params)

  // Inject record-level audit fields with partner name as actor
  const partnerActor = `partner:${partner.name}`
  if (metadata.recordAudit) {
    injectRecordAuditFields(data, metadata.recordAudit, partnerActor, null, true)
  }

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

  // Update record count + lastModifiedBy with partner name
  const allRecs = await masterCol.find({}).toArray()
  const activeCount = allRecs.filter(r => r.deleted !== true).length
  await metaCol.updateOne({ masterName: entity }, { $set: { recordCount: activeCount, updatedAt: now, lastModifiedBy: partnerActor } })

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
    record: data
  }, 201)
}

async function handlePublicUpdate (client, masterCol, metadata, entity, params, partner) {
  const data = parseRecordData(params)
  const body = typeof params.__ow_body === 'string' ? (() => { try { return JSON.parse(params.__ow_body) } catch (e) { return {} } })() : (params.__ow_body || {})
  const id = params.id || body.id
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
    const validationErrors = validateRecord(data, metadata.schema)
    if (validationErrors.length > 0) {
      return createMutationResponse({ error: `Validation failed: ${validationErrors.join(', ')}` }, 400)
    }
  }

  const changes = computeFieldChanges(existing.data, data)
  const now = getTimezoneDate(params)
  const partnerActor = `partner:${partner.name}`

  // Inject record-level audit fields with partner name
  if (metadata.recordAudit) {
    injectRecordAuditFields(data, metadata.recordAudit, partnerActor, null, false)
  }

  // Full replace of data
  await masterCol.updateOne(
    { primaryKey: id, deleted: false },
    { $set: { data, updatedAt: now, source: 'api', partnerId: partner.partnerId } }
  )

  // Update lastModifiedBy on master metadata
  const metaCol = await client.collection(COLLECTIONS.METADATA)
  await metaCol.updateOne({ masterName: entity }, { $set: { lastModifiedBy: partnerActor, updatedAt: now } })

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
    record: data
  })
}

async function handlePublicPatch (client, masterCol, metadata, entity, params, partner) {
  const data = parseRecordData(params)
  const body = typeof params.__ow_body === 'string' ? (() => { try { return JSON.parse(params.__ow_body) } catch (e) { return {} } })() : (params.__ow_body || {})
  const id = params.id || body.id
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

  // Merge: existing data + patch fields
  const merged = { ...existing.data, ...data }

  // Validate merged result against schema
  if (metadata.schema && metadata.schema.length > 0) {
    const validationErrors = validateRecord(merged, metadata.schema)
    if (validationErrors.length > 0) {
      return createMutationResponse({ error: `Validation failed: ${validationErrors.join(', ')}` }, 400)
    }
  }

  const changes = computeFieldChanges(existing.data, merged)
  const now = getTimezoneDate(params)
  const partnerActor = `partner:${partner.name}`

  // Inject record-level audit fields with partner name
  if (metadata.recordAudit) {
    injectRecordAuditFields(merged, metadata.recordAudit, partnerActor, null, false)
  }

  await masterCol.updateOne(
    { primaryKey: id, deleted: false },
    { $set: { data: merged, updatedAt: now, source: 'api', partnerId: partner.partnerId } }
  )

  // Update lastModifiedBy on master metadata
  const metaCol = await client.collection(COLLECTIONS.METADATA)
  await metaCol.updateOne({ masterName: entity }, { $set: { lastModifiedBy: partnerActor, updatedAt: now } })

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
    record: merged
  })
}

async function handlePublicDelete (client, metaCol, masterCol, metadata, entity, params, partner) {
  const body = typeof params.__ow_body === 'string' ? (() => { try { return JSON.parse(params.__ow_body) } catch (e) { return {} } })() : (params.__ow_body || {})
  const id = params.id || body.id
  if (!id) return createMutationResponse({ error: 'Missing record ID (pass as "id" parameter or in body)' }, 400)

  const allowedOps = metadata.allowedOperations || { create: true, update: true, delete: true }
  if (!allowedOps.delete) {
    return createMutationResponse({ error: 'Delete operation is not allowed for this master' }, 403)
  }

  const existing = await safeFindOne(masterCol, { primaryKey: id, deleted: false })
  if (!existing) return createMutationResponse({ error: `Record '${id}' not found` }, 404)

  const now = getTimezoneDate(params)

  // Soft delete
  await masterCol.updateOne(
    { primaryKey: id, deleted: false },
    { $set: { deleted: true, deletedAt: now, deletedBy: `partner:${partner.partnerId}`, source: 'api' } }
  )

  // Update record count + lastModifiedBy
  const allRecs = await masterCol.find({}).toArray()
  const activeCount = allRecs.filter(r => r.deleted !== true).length
  await metaCol.updateOne({ masterName: entity }, { $set: { recordCount: activeCount, updatedAt: now, lastModifiedBy: `partner:${partner.name}` } })

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

  const now = getTimezoneDate(params)
  const partnerActor = `partner:${partner.name}`
  let nextAutoId = await getNextAutoIncrementId(masterCol, pkField)
  const results = []

  for (const data of records) {
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

      // Auto-generate primary key if not provided (auto-increment)
      if (!data[pkField]) {
        data[pkField] = nextAutoId++
      }
      const pk = String(data[pkField])

      if (metadata.schema && metadata.schema.length > 0) {
        const errors = validateRecord(data, metadata.schema)
        if (errors.length > 0) {
          results.push({ success: false, id: pk, error: `Validation: ${errors.join(', ')}` })
          continue
        }
      }

      const existing = await safeFindOne(masterCol, { primaryKey: pk, deleted: false })
      if (existing) {
        results.push({ success: false, id: pk, error: 'Already exists' })
        continue
      }

      if (metadata.recordAudit) {
        injectRecordAuditFields(data, metadata.recordAudit, partnerActor, null, true)
      }

      await masterCol.insertOne({
        primaryKey: pk, data, deleted: false,
        createdAt: now, updatedAt: now,
        source: 'api', partnerId: partner.partnerId
      })
      results.push({ success: true, id: pk })
    } catch (e) {
      results.push({ success: false, id: data?.[pkField] || null, error: e.message })
    }
  }

  const allRecs = await masterCol.find({}).toArray()
  const activeCount = allRecs.filter(r => !r.deleted).length
  await metaCol.updateOne({ masterName: entity }, { $set: { recordCount: activeCount, updatedAt: now, lastModifiedBy: partnerActor } })

  const succeeded = results.filter(r => r.success).length
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

  const now = getTimezoneDate(params)
  const partnerActor = `partner:${partner.name}`
  const results = []

  for (const item of items) {
    try {
      const id = item.id
      const data = item.data
      if (!id) { results.push({ success: false, id: null, error: 'Missing "id"' }); continue }
      if (!data || typeof data !== 'object') { results.push({ success: false, id, error: 'Missing or invalid "data"' }); continue }
      ;['createdAt', 'updatedAt', 'createdBy', 'updatedBy'].forEach(f => delete data[f])

      const existing = await safeFindOne(masterCol, { primaryKey: id, deleted: false })
      if (!existing) { results.push({ success: false, id, error: 'Not found' }); continue }

      // Primary key is immutable — preserve existing value
      const pkField = metadata.primaryKey
      if (pkField) data[pkField] = existing.data[pkField]

      if (metadata.schema && metadata.schema.length > 0) {
        const errors = validateRecord(data, metadata.schema)
        if (errors.length > 0) {
          results.push({ success: false, id, error: `Validation: ${errors.join(', ')}` })
          continue
        }
      }

      if (metadata.recordAudit) {
        injectRecordAuditFields(data, metadata.recordAudit, partnerActor, null, false)
      }

      await masterCol.updateOne(
        { primaryKey: id, deleted: false },
        { $set: { data, updatedAt: now, source: 'api', partnerId: partner.partnerId } }
      )
      results.push({ success: true, id })
    } catch (e) {
      results.push({ success: false, id: item?.id || null, error: e.message })
    }
  }

  const metaCol = await client.collection(COLLECTIONS.METADATA)
  await metaCol.updateOne({ masterName: entity }, { $set: { lastModifiedBy: partnerActor, updatedAt: now } })

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

  const now = getTimezoneDate(params)
  const partnerActor = `partner:${partner.name}`
  const results = []

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

      const existing = await safeFindOne(masterCol, { primaryKey: id, deleted: false })
      if (!existing) { results.push({ success: false, id, error: 'Not found' }); continue }

      const merged = { ...existing.data, ...data }

      if (metadata.schema && metadata.schema.length > 0) {
        const errors = validateRecord(merged, metadata.schema)
        if (errors.length > 0) {
          results.push({ success: false, id, error: `Validation: ${errors.join(', ')}` })
          continue
        }
      }

      if (metadata.recordAudit) {
        injectRecordAuditFields(merged, metadata.recordAudit, partnerActor, null, false)
      }

      await masterCol.updateOne(
        { primaryKey: id, deleted: false },
        { $set: { data: merged, updatedAt: now, source: 'api', partnerId: partner.partnerId } }
      )
      results.push({ success: true, id })
    } catch (e) {
      results.push({ success: false, id: item?.id || null, error: e.message })
    }
  }

  const metaCol = await client.collection(COLLECTIONS.METADATA)
  await metaCol.updateOne({ masterName: entity }, { $set: { lastModifiedBy: partnerActor, updatedAt: now } })

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

  const now = getTimezoneDate(params)
  const partnerActor = `partner:${partner.name}`
  const results = []

  for (const id of ids) {
    try {
      if (!id || typeof id !== 'string') {
        results.push({ success: false, id: String(id || ''), error: 'Invalid ID' })
        continue
      }

      const existing = await safeFindOne(masterCol, { primaryKey: id, deleted: false })
      if (!existing) { results.push({ success: false, id, error: 'Not found' }); continue }

      await masterCol.updateOne(
        { primaryKey: id, deleted: false },
        { $set: { deleted: true, deletedAt: now, deletedBy: `partner:${partner.partnerId}`, source: 'api' } }
      )
      results.push({ success: true, id })
    } catch (e) {
      results.push({ success: false, id: String(id || ''), error: e.message })
    }
  }

  const allRecs = await masterCol.find({}).toArray()
  const activeCount = allRecs.filter(r => !r.deleted).length
  await metaCol.updateOne({ masterName: entity }, { $set: { recordCount: activeCount, updatedAt: now, lastModifiedBy: partnerActor } })

  const succeeded = results.filter(r => r.success).length
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
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-forwarded-authorization, x-partner-id, x-partner-key',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Cache-Control': 'public, max-age=60, s-maxage=900'
    },
    body
  }
}

function createMutationResponse (body, statusCode = 200) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-forwarded-authorization, x-partner-id, x-partner-key',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Cache-Control': 'no-store'
    },
    body
  }
}

function createErrorResponse (message, statusCode = 400) {
  return createResponse({ error: message }, statusCode)
}

exports.main = main
