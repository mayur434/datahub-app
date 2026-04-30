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

    if (!/^[a-z][a-z0-9_-]*$/.test(entity)) {
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
    const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize) || 25))
    const sort = (params.sort && params.sort !== 'undefined') ? params.sort : metadata.primaryKey
    const order = params.order === 'desc' ? 'desc' : 'asc'
    const fields = (params.fields && params.fields !== 'undefined') ? params.fields.split(',').map(f => f.trim()) : null

    // --- Query from DB ---
    const recordsCol = await client.collection('records')

    // Query with entityName only — aio-lib-db does not reliably support
    // compound filters with booleans (deleted: false) or mixed types.
    // JS-level safety filter applied after fetch (same pattern as file-list/dashboard).
    const sortDir = order === 'asc' ? 1 : -1
    const allRecords = await recordsCol.find({ entityName: entity })
      .sort({ [`data.${sort}`]: sortDir })
      .toArray()

    // JS-level safety filter: exclude deleted/inactive records
    let filtered = allRecords.filter(r => r.deleted !== true && r.status !== 'deleted')

    // Apply data-level filters (case-insensitive match)
    const filterKeys = Object.keys(filters)
    if (filterKeys.length > 0) {
      filtered = filtered.filter(r => {
        if (!r.data) return false
        return filterKeys.every(key => {
          const pattern = new RegExp(`^${escapeRegex(filters[key])}$`, 'i')
          return pattern.test(String(r.data[key] || ''))
        })
      })
    }

    const total = filtered.length

    // Apply pagination
    const paged = filtered.slice((page - 1) * pageSize, page * pageSize)

    // Extract data and apply field selection
    let responseData = paged.map(r => r.data)
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
      (metadata.facets.returnWithQuery || facetsParam === 'true' || facetsParam === '1') &&
      facetsParam !== 'undefined'

    if (shouldReturnFacets && metadata.facets.fields && metadata.facets.fields.length > 0) {
      const aggregations = []

      for (const facetConfig of metadata.facets.fields) {
        const fieldName = facetConfig.field
        const maxValues = facetConfig.limit || metadata.facets.maxValuesPerFacet || 100

        // Compute facet values from active records, excluding the current facet field filter
        const facetRecords = allRecords.filter(r => {
          if (r.deleted === true || r.status === 'deleted') return false
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
