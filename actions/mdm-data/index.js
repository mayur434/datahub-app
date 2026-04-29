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
const libDb = require('@adobe/aio-lib-db')

// ============ DB Connection ============

async function getDbClient (params) {
  const { generateAccessToken } = Core.AuthClient
  const token = await generateAccessToken(params)
  const region = process.env.AIO_DB_REGION || 'apac'
  const db = await libDb.init({ token: token.access_token, region })
  return await db.connect()
}

// ============ Helpers ============

async function safeFindOne (collection, filter) {
  try {
    return await collection.findOne(filter)
  } catch (e) {
    if (e.message && e.message.includes('Document not found')) {
      return null
    }
    throw e
  }
}

// ============ Main Action ============

async function main (params) {
  const logger = Core.Logger('mdm-data', { level: params.LOG_LEVEL || 'info' })

  if (params.__ow_method === 'options') return createResponse({})

  let client
  try {
    const entity = params.entity
    if (!entity) return createErrorResponse('Missing required parameter: entity', 400)

    if (!/^[a-z][a-z0-9-]*$/.test(entity)) {
      return createErrorResponse('Invalid entity name', 400)
    }

    const id = params.id || null

    // --- Fetch metadata from DB ---
    client = await getDbClient(params)
    const metaCol = await client.collection('metadata')
    const metadata = await safeFindOne(metaCol, { entityName: entity })

    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Entity '${entity}' not found`, 404)
    }

    // --- Visibility check ---
    if (metadata.visibility === 'private') {
      const authHeader = params.__ow_headers && (params.__ow_headers.authorization || params.__ow_headers['x-forwarded-authorization'])
      if (!authHeader || authHeader.length < 20) {
        return createErrorResponse('Authentication required for private entity', 401)
      }
    }

    // --- Single record by ID ---
    if (id) {
      const recordsCol = await client.collection('records')
      const record = await safeFindOne(recordsCol, { entityName: entity, primaryKey: id, deleted: false })

      if (!record) return createErrorResponse(`Record '${id}' not found`, 404)

      return createResponse({
        entity,
        data: record.data
      })
    }

    // --- List query with filters ---
    const systemParams = [
      'entity', 'id', 'page', 'pageSize', 'sort', 'order', 'fields', 'facets', 'filters',
      '__ow_method', '__ow_headers', '__ow_path', '__ow_query', '__ow_body',
      '__ims_oauth_s2s', 'LOG_LEVEL', 'apiKey'
    ]
    const filters = {}

    // Support filters as JSON string (from API Mesh) or as individual query params
    if (params.filters) {
      try {
        const parsed = typeof params.filters === 'string' ? JSON.parse(params.filters) : params.filters
        if (parsed && typeof parsed === 'object') {
          Object.assign(filters, parsed)
        }
      } catch (e) {
        // If not valid JSON, ignore
        logger.warn('Could not parse filters param:', params.filters)
      }
    }

    // Also pick up individual filter params (for direct REST calls / Query Console)
    Object.keys(params).forEach(key => {
      if (!systemParams.includes(key) && !key.startsWith('__')) {
        filters[key] = params[key]
      }
    })

    const page = Math.max(1, parseInt(params.page) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize) || 25))
    const sort = params.sort || metadata.primaryKey
    const order = params.order === 'desc' ? 'desc' : 'asc'
    const fields = params.fields ? params.fields.split(',').map(f => f.trim()) : null

    // --- Query from DB ---
    const recordsCol = await client.collection('records')

    // Build MongoDB filter
    const dbFilter = { entityName: entity, deleted: false, status: 'active' }
    Object.keys(filters).forEach(key => {
      dbFilter[`data.${key}`] = { $regex: `^${escapeRegex(filters[key])}$`, $options: 'i' }
    })

    // Get total count
    const total = await recordsCol.countDocuments(dbFilter)

    // Query with sort + pagination
    const sortDir = order === 'asc' ? 1 : -1
    const cursor = recordsCol.find(dbFilter)
      .sort({ [`data.${sort}`]: sortDir })
      .skip((page - 1) * pageSize)
      .limit(pageSize)

    const records = await cursor.toArray()

    // Extract data and apply field selection
    let responseData = records.map(r => r.data)
    if (fields && fields.length > 0) {
      responseData = responseData.map(record => {
        const selected = {}
        fields.forEach(f => { if (record[f] !== undefined) selected[f] = record[f] })
        return selected
      })
    }

    const responseBody = {
      entity,
      count: responseData.length,
      page,
      pageSize,
      total,
      data: responseData
    }

    // --- Compute aggregations/facets if configured ---
    const facetsParam = params.facets
    const shouldReturnFacets = metadata.facets && metadata.facets.enabled &&
      (metadata.facets.returnWithQuery || facetsParam === 'true' || facetsParam === '1')

    if (shouldReturnFacets && metadata.facets.fields && metadata.facets.fields.length > 0) {
      const aggregations = []

      for (const facetConfig of metadata.facets.fields) {
        const fieldName = facetConfig.field
        const maxValues = facetConfig.limit || metadata.facets.maxValuesPerFacet || 100

        // Build aggregation pipeline
        // Use base filter (entity + deleted + status) + current filters EXCEPT the facet field itself
        const facetFilter = { ...dbFilter }
        delete facetFilter[`data.${fieldName}`]

        // Aggregate distinct values and counts
        const pipeline = [
          { $match: facetFilter },
          { $group: { _id: `$data.${fieldName}`, count: { $sum: 1 } } },
          { $match: { _id: { $ne: null } } }
        ]

        // Sort
        if (facetConfig.sortBy === 'count') {
          pipeline.push({ $sort: { count: facetConfig.sortOrder === 'asc' ? 1 : -1 } })
        } else {
          pipeline.push({ $sort: { _id: facetConfig.sortOrder === 'asc' ? 1 : -1 } })
        }

        pipeline.push({ $limit: maxValues })

        const facetResults = await recordsCol.aggregate(pipeline).toArray()

        aggregations.push({
          field: fieldName,
          label: facetConfig.label || fieldName,
          type: facetConfig.type || 'value',
          showCount: facetConfig.showCount !== false,
          collapsed: facetConfig.collapsed || false,
          values: facetResults.map(r => ({
            value: r._id,
            count: r.count,
            selected: filters[fieldName] ? String(filters[fieldName]).toLowerCase() === String(r._id).toLowerCase() : false
          }))
        })
      }

      responseBody.aggregations = aggregations
    }

    return createResponse(responseBody)
  } catch (error) {
    logger.error('MDM Data action error:', error)
    return createErrorResponse(`Query failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

// ============ Helpers ============

function escapeRegex (str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createResponse (body, statusCode = 200) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-forwarded-authorization',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'public, max-age=60'
    },
    body
  }
}

function createErrorResponse (message, statusCode = 400) {
  return createResponse({ error: message }, statusCode)
}

exports.main = main
