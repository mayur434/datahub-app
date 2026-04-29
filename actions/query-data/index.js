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

    // Build filter from query params
    const systemParams = ['entity', 'id', 'page', 'pageSize', 'sort', 'order', 'fields', 'filter', 'filters', '__ow_method', '__ow_headers', '__ow_path', '__ow_query', '__ow_body', '__ims_oauth_s2s', 'LOG_LEVEL', 'apiKey']
    const filter = { entityName: entity, deleted: false, status: 'active' }

    // Parse 'filter' param: format is "field=value&field2=value2" or "field=value"
    if (params.filter) {
      const filterParts = params.filter.split('&')
      filterParts.forEach(part => {
        const eqIdx = part.indexOf('=')
        if (eqIdx > 0) {
          const key = part.substring(0, eqIdx).trim()
          const val = part.substring(eqIdx + 1).trim()
          if (key && val) {
            filter[`data.${key}`] = { $regex: `^${escapeRegex(val)}$`, $options: 'i' }
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
            filter[`data.${key}`] = { $regex: `^${escapeRegex(parsed[key])}$`, $options: 'i' }
          })
        }
      } catch (e) { /* ignore invalid JSON */ }
    }

    // Also pick up individual filter params (direct key=value in query string)
    Object.keys(params).forEach(key => {
      if (!systemParams.includes(key) && !key.startsWith('__')) {
        filter[`data.${key}`] = { $regex: `^${escapeRegex(params[key])}$`, $options: 'i' }
      }
    })

    // Pagination / sorting
    const page = Math.max(1, parseInt(params.page) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize) || 25))
    const sort = params.sort || metadata.primaryKey
    const order = params.order === 'desc' ? -1 : 1
    const fields = params.fields ? params.fields.split(',').map(f => f.trim()) : null

    // Get total count
    const total = await recordsCol.countDocuments(filter)

    // Query with pagination
    let cursor = recordsCol.find(filter)
      .sort({ [`data.${sort}`]: order })
      .skip((page - 1) * pageSize)
      .limit(pageSize)

    // Field projection
    if (fields && fields.length > 0) {
      const projection = { 'data': 1 }
      cursor = cursor.project(projection)
    }

    const records = await cursor.toArray()

    // Extract data field and apply field selection
    let responseData = records.map(r => r.data)
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
