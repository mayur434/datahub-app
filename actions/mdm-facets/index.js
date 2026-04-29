/**
 * MDM Facets Metadata Action — Public API exposed via API Mesh
 *
 * Returns the facet/aggregation configuration for an entity.
 * Optionally returns live facet values (counts) for use in frontend filtering UIs.
 *
 * Use cases:
 *   1. GET ?entity=products — Returns facet config (which fields are facetable, labels, types)
 *   2. GET ?entity=products&values=true — Returns config + live aggregated values/counts
 *   3. GET ?entity=products&values=true&brand=Nike — Returns values with filters applied
 *
 * No IMS auth required for public entities.
 * IMS auth required for private entities.
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

async function safeFindOne (collection, filter) {
  try {
    return await collection.findOne(filter)
  } catch (e) {
    if (e.message && e.message.includes('Document not found')) return null
    throw e
  }
}

// ============ Main Action ============

async function main (params) {
  const logger = Core.Logger('mdm-facets', { level: params.LOG_LEVEL || 'info' })

  if (params.__ow_method === 'options') return createResponse({})

  let client
  try {
    const entity = params.entity
    if (!entity) return createErrorResponse('Missing required parameter: entity', 400)

    if (!/^[a-z][a-z0-9-]*$/.test(entity)) {
      return createErrorResponse('Invalid entity name', 400)
    }

    client = await getDbClient(params)
    const metaCol = await client.collection('metadata')
    const metadata = await safeFindOne(metaCol, { entityName: entity })

    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Entity '${entity}' not found`, 404)
    }

    // Visibility check
    if (metadata.visibility === 'private') {
      const authHeader = params.__ow_headers && (params.__ow_headers.authorization || params.__ow_headers['x-forwarded-authorization'])
      if (!authHeader || authHeader.length < 20) {
        return createErrorResponse('Authentication required for private entity', 401)
      }
    }

    // Check if facets are configured
    if (!metadata.facets || !metadata.facets.enabled || !metadata.facets.fields || metadata.facets.fields.length === 0) {
      return createResponse({
        entity,
        facetsEnabled: false,
        facets: [],
        message: 'No facets configured for this entity. Configure facetable fields in the entity schema.'
      })
    }

    const facetsConfig = metadata.facets

    // Build response with facet metadata
    const response = {
      entity,
      facetsEnabled: true,
      totalFields: metadata.schema.length,
      facetableFields: facetsConfig.fields.length,
      config: {
        returnWithQuery: facetsConfig.returnWithQuery,
        maxValuesPerFacet: facetsConfig.maxValuesPerFacet
      },
      facets: facetsConfig.fields.map(f => ({
        field: f.field,
        label: f.label,
        type: f.type,
        sortBy: f.sortBy,
        sortOrder: f.sortOrder,
        limit: f.limit,
        showCount: f.showCount,
        collapsed: f.collapsed,
        fieldType: (metadata.schema.find(s => s.name === f.field) || {}).type || 'string'
      }))
    }

    // If values=true, compute live aggregations
    const returnValues = params.values === 'true' || params.values === '1'
    if (returnValues) {
      const recordsCol = await client.collection('records')

      // Build base filter + any user-applied filters
      const systemParams = [
        'entity', 'values', 'page', 'pageSize', 'sort', 'order', 'fields', 'facets', 'filters',
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
          logger.warn('Could not parse filters param:', params.filters)
        }
      }

      Object.keys(params).forEach(key => {
        if (!systemParams.includes(key) && !key.startsWith('__')) {
          filters[key] = params[key]
        }
      })

      const baseFilter = { entityName: entity, deleted: false, status: 'active' }
      Object.keys(filters).forEach(key => {
        baseFilter[`data.${key}`] = { $regex: `^${escapeRegex(filters[key])}$`, $options: 'i' }
      })

      // Compute aggregation for each facet field
      for (const facet of response.facets) {
        const fieldName = facet.field
        const maxValues = facet.limit || facetsConfig.maxValuesPerFacet || 100

        // Exclude current field from filter for "OR" style faceting (shows all options)
        const facetFilter = { ...baseFilter }
        delete facetFilter[`data.${fieldName}`]

        const pipeline = [
          { $match: facetFilter },
          { $group: { _id: `$data.${fieldName}`, count: { $sum: 1 } } },
          { $match: { _id: { $ne: null } } }
        ]

        if (facet.sortBy === 'count') {
          pipeline.push({ $sort: { count: facet.sortOrder === 'asc' ? 1 : -1 } })
        } else {
          pipeline.push({ $sort: { _id: facet.sortOrder === 'asc' ? 1 : -1 } })
        }

        pipeline.push({ $limit: maxValues })

        const results = await recordsCol.aggregate(pipeline).toArray()

        facet.values = results.map(r => ({
          value: r._id,
          count: r.count,
          selected: filters[fieldName] ? String(filters[fieldName]).toLowerCase() === String(r._id).toLowerCase() : false
        }))
        facet.totalValues = results.length
      }

      // Also return total matching count
      const totalMatching = await recordsCol.countDocuments(baseFilter)
      response.totalRecords = totalMatching
    }

    return createResponse(response)
  } catch (error) {
    logger.error('MDM Facets action error:', error)
    return createErrorResponse(`Facets query failed: ${error.message}`, 500)
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
      'Cache-Control': 'public, max-age=30'
    },
    body
  }
}

function createErrorResponse (message, statusCode = 400) {
  return createResponse({ error: message }, statusCode)
}

exports.main = main
