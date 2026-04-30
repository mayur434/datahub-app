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

    if (!/^[a-z][a-z0-9_-]*$/.test(entity)) {
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

      // Pick up individual filter params from URL query string only
      if (params.__ow_query) {
        const queryParams = new URLSearchParams(params.__ow_query)
        for (const [key, value] of queryParams.entries()) {
          if (!systemParams.includes(key) && !key.startsWith('__') && value) {
            filters[key] = value
          }
        }
      }

      // Query with entityName only — aio-lib-db does not reliably support
      // compound filters with booleans. JS-level safety filter applied after fetch.
      const allRecords = await recordsCol.find({ entityName: entity }).toArray()
      const activeRecords = allRecords.filter(r => r.deleted !== true && r.status !== 'deleted')
      const filterKeys = Object.keys(filters)

      // Compute aggregation for each facet field
      for (const facet of response.facets) {
        const fieldName = facet.field
        const maxValues = facet.limit || facetsConfig.maxValuesPerFacet || 100

        // Exclude current field from filter for "OR" style faceting (shows all options)
        const facetRecords = activeRecords.filter(r => {
          if (!r.data) return false
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
        if (facet.sortBy === 'count') {
          sortedValues.sort((a, b) => facet.sortOrder === 'asc' ? a[1] - b[1] : b[1] - a[1])
        } else {
          sortedValues.sort((a, b) => facet.sortOrder === 'asc' ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0]))
        }
        sortedValues = sortedValues.slice(0, maxValues)

        facet.values = sortedValues.map(([value, count]) => ({
          value,
          count,
          selected: filters[fieldName] ? String(filters[fieldName]).toLowerCase() === value.toLowerCase() : false
        }))
        facet.totalValues = sortedValues.length
      }

      // Total active records for this entity
      response.totalRecords = activeRecords.length
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
