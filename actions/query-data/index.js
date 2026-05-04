/**
 * MDM Query Data Action — Admin UI only
 * 
 * Used by Admin UI to preview/browse records.
 * Reads DIRECTLY from per-master collections (admin previews must be real-time).
 * For public data consumption, the `mdm-data` action is used via API Mesh.
 */

const { getDbClient, safeFindOne, COLLECTIONS, getMasterCollection, createResponse, createErrorResponse, validateIMSToken, escapeRegex, getEnvConfig, getCachedSettings, enforceAppPermission } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const master = params.master || params.entity
    const { id } = params
    if (!master) return createErrorResponse('Missing required parameter: master')

    client = await getDbClient(params)

    // App-level RBAC
    const appPerm = await enforceAppPermission(client, params, 'query-data')
    if (!appPerm.allowed) return appPerm.response

    const metaCol = await client.collection(COLLECTIONS.METADATA)
    const masterCol = await getMasterCollection(client, master)

    const metadata = await safeFindOne(metaCol, { masterName: master })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Master '${master}' not found`, 404)
    }

    // Single record by ID
    if (id) {
      const record = await safeFindOne(masterCol, { primaryKey: id, deleted: false })
      if (!record) return createErrorResponse(`Record '${id}' not found`, 404)
      return createResponse({ master, data: { ...record.data, _systemFields: { createdAt: record.createdAt, updatedAt: record.updatedAt, createdBy: record.createdBy, updatedBy: record.updatedBy } } })
    }

    // Build data-level filters from query params
    const systemParams = ['master', 'entity', 'id', 'page', 'pageSize', 'sort', 'order', 'fields', 'filter', 'filters', 'includeMeta', '__ow_method', '__ow_headers', '__ow_path', '__ow_query', '__ow_body', '__ims_oauth_s2s', 'LOG_LEVEL', 'apiKey']
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

    // Pagination / sorting — use settings-configured limits
    const settingsDoc = await getCachedSettings(client)
    const env = getEnvConfig(params)
    const apiSettings = settingsDoc?.api || {}
    const maxPageSize = apiSettings.maxPageSize || env.maxPageSize
    const defaultPageSize = apiSettings.defaultPageSize || env.defaultPageSize

    const page = Math.max(1, parseInt(params.page) || 1)
    const pageSize = Math.min(maxPageSize, Math.max(1, parseInt(params.pageSize) || defaultPageSize))
    const sort = params.sort || metadata.primaryKey
    const order = params.order === 'desc' ? -1 : 1
    const fields = params.fields ? params.fields.split(',').map(f => f.trim()) : null

    // --- Optimized query: use DB-level filter, sort, skip/limit ---
    const filterKeys = Object.keys(dataFilters)

    let responseData, total

    // Build DB-level query filter
    const dbFilter = { deleted: { $ne: true }, status: { $ne: 'deleted' } }

    // Apply data-level filters at DB level (case-insensitive regex match)
    for (const key of filterKeys) {
      dbFilter[`data.${key}`] = { $regex: `^${escapeRegex(dataFilters[key])}$`, $options: 'i' }
    }

    // DB-level count, sort, skip, limit
    total = await masterCol.countDocuments(dbFilter)
    const cursor = masterCol.find(dbFilter)
      .sort({ [`data.${sort}`]: order })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
    const paged = await cursor.toArray()
    responseData = paged.map(r => ({ ...r.data, _systemFields: { createdAt: r.createdAt, updatedAt: r.updatedAt, createdBy: r.createdBy, updatedBy: r.updatedBy } }))

    // Apply field selection
    if (fields && fields.length > 0) {
      responseData = responseData.map(record => {
        const selected = {}
        fields.forEach(f => { if (record[f] !== undefined) selected[f] = record[f] })
        return selected
      })
    }

    return createResponse({
      master,
      count: responseData.length,
      page,
      pageSize,
      total,
      data: responseData,
      ...(params.includeMeta ? {
        file: {
          masterName: metadata.masterName,
          displayName: metadata.displayName,
          description: metadata.description,
          primaryKey: metadata.primaryKey,
          visibility: metadata.visibility,
          status: metadata.status,
          crudEnabled: metadata.crudEnabled,
          recordCount: metadata.recordCount,
          schema: metadata.schema,
          queryableFields: metadata.queryableFields,
          requiredFields: metadata.requiredFields,
          facetableFields: metadata.facetableFields,
          api: metadata.api,
          cache: metadata.cache,
          createdBy: metadata.createdBy,
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt
        }
      } : {})
    })
  } catch (error) {
    console.error('Query data error:', error)
    return createErrorResponse(`Query failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
