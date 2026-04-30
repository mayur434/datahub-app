/**
 * MDM Query Data Action — Admin UI only
 * 
 * Used by Admin UI to preview/browse records.
 * Reads DIRECTLY from aio-lib-db (admin previews must be real-time).
 * For public data consumption, the `mdm-data` action is used via API Mesh.
 */

const { getDbClient, safeFindOne, COLLECTIONS, createResponse, createErrorResponse, validateIMSToken } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const { entity, id } = params
    if (!entity) return createErrorResponse('Missing required parameter: entity')

    client = await getDbClient(params)
    const metaCol = await client.collection(COLLECTIONS.METADATA)
    const recordsCol = await client.collection(COLLECTIONS.RECORDS)

    const metadata = await safeFindOne(metaCol, { entityName: entity })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Entity '${entity}' not found`, 404)
    }

    // Single record by ID
    if (id) {
      const record = await safeFindOne(recordsCol, { entityName: entity, primaryKey: id, deleted: false })
      if (!record) return createErrorResponse(`Record '${id}' not found`, 404)
      return createResponse({ entity, data: record.data })
    }

    // Build data-level filters from query params
    const systemParams = ['entity', 'id', 'page', 'pageSize', 'sort', 'order', 'fields', 'filter', 'filters', '__ow_method', '__ow_headers', '__ow_path', '__ow_query', '__ow_body', '__ims_oauth_s2s', 'LOG_LEVEL', 'apiKey']
    const dataFilters = {}

    // Parse 'filter' param: format is "field=value&field2=value2" or "field=value"
    if (params.filter) {
      const filterParts = params.filter.split('&')
      filterParts.forEach(part => {
        const eqIdx = part.indexOf('=')
        if (eqIdx > 0) {
          const key = part.substring(0, eqIdx).trim()
          const val = part.substring(eqIdx + 1).trim()
          if (key && val) {
            dataFilters[key] = val
          }
        }
      })
    }

    // Support 'filters' as JSON string
    if (params.filters) {
      try {
        const parsed = typeof params.filters === 'string' ? JSON.parse(params.filters) : params.filters
        if (parsed && typeof parsed === 'object') {
          Object.keys(parsed).forEach(key => {
            dataFilters[key] = parsed[key]
          })
        }
      } catch (e) { /* ignore invalid JSON */ }
    }

    // Pick up individual filter params from the actual URL query string only
    // (avoids runtime-injected params like IMS credentials being treated as data filters)
    if (params.__ow_query) {
      const queryParams = new URLSearchParams(params.__ow_query)
      for (const [key, value] of queryParams.entries()) {
        if (!systemParams.includes(key) && !key.startsWith('__') && value) {
          dataFilters[key] = value
        }
      }
    }

    // Pagination / sorting
    const page = Math.max(1, parseInt(params.page) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize) || 25))
    const sort = params.sort || metadata.primaryKey
    const order = params.order === 'desc' ? -1 : 1
    const fields = params.fields ? params.fields.split(',').map(f => f.trim()) : null

    // Query with entityName only — aio-lib-db does not reliably support
    // compound filters with booleans (deleted: false) or status strings.
    // JS-level safety filter is applied after fetch (same pattern as file-list/dashboard).
    const allRecords = await recordsCol.find({ entityName: entity })
      .sort({ [`data.${sort}`]: order })
      .toArray()

    // JS-level safety filter: exclude deleted/inactive records
    let filtered = allRecords.filter(r => r.deleted !== true && r.status !== 'deleted')

    // Apply data-level filters (case-insensitive match)
    const filterKeys = Object.keys(dataFilters)
    if (filterKeys.length > 0) {
      filtered = filtered.filter(r => {
        if (!r.data) return false
        return filterKeys.every(key => {
          const pattern = new RegExp(`^${escapeRegex(dataFilters[key])}$`, 'i')
          return pattern.test(String(r.data[key] || ''))
        })
      })
    }

    const total = filtered.length

    // Apply pagination
    const paged = filtered.slice((page - 1) * pageSize, page * pageSize)

    // Extract data field and apply field selection
    let responseData = paged.map(r => r.data)
    if (fields && fields.length > 0) {
      responseData = responseData.map(record => {
        const selected = {}
        fields.forEach(f => { if (record[f] !== undefined) selected[f] = record[f] })
        return selected
      })
    }

    return createResponse({
      entity,
      count: responseData.length,
      page,
      pageSize,
      total,
      data: responseData
    })
  } catch (error) {
    console.error('Query data error:', error)
    return createErrorResponse(`Query failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

function escapeRegex (str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

exports.main = main
