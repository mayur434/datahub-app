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
const { getDbClient, safeFindOne, escapeRegex, validateMasterName, getMasterCollection } = require('../mdm-utils')

// ============ Main Action ============

async function main (params) {
  const logger = Core.Logger('mdm-facets', { level: params.LOG_LEVEL || 'info' })

  if (params.__ow_method === 'options') return createResponse({})

  let client
  try {
    const entity = params.master || params.entity
    if (!entity) return createErrorResponse('Missing required parameter: master', 400)

    if (!validateMasterName(entity)) {
      return createErrorResponse('Invalid master name', 400)
    }

    client = await getDbClient(params)
    const metaCol = await client.collection('metadata')
    const metadata = await safeFindOne(metaCol, { masterName: entity })

    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Master '${entity}' not found`, 404)
    }

    // Visibility check
    if (metadata.visibility === 'private') {
      const authHeader = params.__ow_headers && (params.__ow_headers.authorization || params.__ow_headers['x-forwarded-authorization'])
      if (!authHeader || authHeader.length < 20) {
        return createErrorResponse('Authentication required for private master', 401)
      }
    }

    // Check if facets are configured
    if (!metadata.facets || !metadata.facets.enabled || !metadata.facets.fields || metadata.facets.fields.length === 0) {
      return createResponse({
        master: entity,
        facetsEnabled: false,
        facets: [],
        message: 'No facets configured for this master. Configure facetable fields in the master schema.'
      })
    }

    const facetsConfig = metadata.facets

    // Build response with facet metadata
    const response = {
      master: entity,
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
      const masterCol = await getMasterCollection(client, entity)

      // Build base filter + any user-applied filters
      const systemParams = [
        'master', 'entity', 'values', 'page', 'pageSize', 'sort', 'order', 'fields', 'facets', 'filters',
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

      // Query per-master collection using DB-level queries
      const activeFilter = { deleted: { $ne: true }, status: { $ne: 'deleted' } }
      const filterKeys = Object.keys(filters)

      // Compute aggregation for each facet field using aggregation pipeline
      for (const facet of response.facets) {
        const fieldName = facet.field
        const maxValues = facet.limit || facetsConfig.maxValuesPerFacet || 100

        // Exclude current field from filter for "OR" style faceting (shows all options)
        const facetFilter = { ...activeFilter }
        for (const key of filterKeys) {
          if (key === fieldName) continue
          facetFilter[`data.${key}`] = { $regex: `^${escapeRegex(filters[key])}$`, $options: 'i' }
        }

        // Use aggregation pipeline for facet counting
        const sortStage = facet.sortBy === 'count'
          ? { count: facet.sortOrder === 'asc' ? 1 : -1 }
          : { _id: facet.sortOrder === 'asc' ? 1 : -1 }

        const pipeline = masterCol.aggregate()
          .match(facetFilter)
          .match({ [`data.${fieldName}`]: { $exists: true, $ne: null, $ne: '' } })
          .group({ _id: `$data.${fieldName}`, count: { $sum: 1 } })
          .sort(sortStage)
          .limit(maxValues)

        const facetResults = await pipeline.toArray()

        facet.values = facetResults.map(r => ({
          value: String(r._id),
          count: r.count,
          selected: filters[fieldName] ? String(filters[fieldName]).toLowerCase() === String(r._id).toLowerCase() : false
        }))
        facet.totalValues = facetResults.length
      }

      // Total active records for this entity
      response.totalRecords = await masterCol.countDocuments(activeFilter)
    }

    return createResponse(response)
  } catch (error) {
    logger.error('MDM Facets action error:', error)
    return createErrorResponse(`Facets query failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

// ============ Response Helpers (public API uses custom cache headers) ============

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
