/**
 * Data Export Action — Enterprise Data Extraction
 *
 * Exports master data records as CSV or JSON with:
 *   - Field selection (choose which columns to export)
 *   - Filter support (only export matching records)
 *   - Format options (CSV, JSON, JSONL)
 *   - Presigned download URL via aio-lib-files (for large exports)
 *   - Inline response for small datasets
 *
 * Operations:
 *   export   — Generate export file and return download URL
 *   preview  — Return first N records for export preview
 *   quality  — Compute data quality report for the entity
 *   duplicates — Find potential duplicate records
 *   versions — Get version history for a specific record
 *   rollback — Rollback a record to a previous version
 *
 * Security: IMS-secured, requires 'masters' or 'query_console' permission.
 */

const {
  getDbClient, safeFindOne, COLLECTIONS, getMasterCollection,
  createResponse, createErrorResponse, validateIMSToken, validateMasterName,
  enforceAppPermission, getUserFromParams, escapeRegex, getEnvConfig,
  getFilesClient, getTimezoneDate, createAuditLog,
  computeRecordQuality, computeEntityQuality,
  findDuplicates, getRecordVersions, rollbackRecord
} = require('../mdm-utils')

const INLINE_LIMIT = 5000 // Max records for inline response (vs file download)
const MAX_EXPORT_RECORDS = 50000 // Hard cap for serverless execution time

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    client = await getDbClient(params)

    // App-level RBAC — allow users with masters, query_console, or record_management
    const appPerm = await enforceAppPermission(client, params, 'query-data')
    if (!appPerm.allowed) return appPerm.response

    const op = (params.op || 'export').toLowerCase()

    switch (op) {
      case 'export':
        return await handleExport(client, params)
      case 'preview':
        return await handlePreview(client, params)
      case 'quality':
        return await handleQuality(client, params)
      case 'duplicates':
        return await handleDuplicates(client, params)
      case 'versions':
        return await handleVersions(client, params)
      case 'rollback':
        return await handleRollback(client, params)
      default:
        return createErrorResponse(`Unknown operation: ${op}`)
    }
  } catch (error) {
    console.error('Data export error:', error)
    return createErrorResponse(`Export failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

// ============ Export ============

async function handleExport (client, params) {
  const master = params.master || params.entity
  if (!master) return createErrorResponse('Missing required parameter: master')
  if (!validateMasterName(master)) return createErrorResponse('Invalid master name')

  const format = (params.format || 'csv').toLowerCase()
  if (!['csv', 'json', 'jsonl'].includes(format)) {
    return createErrorResponse('Supported formats: csv, json, jsonl')
  }

  const metaCol = await client.collection(COLLECTIONS.METADATA)
  const metadata = await safeFindOne(metaCol, { masterName: master })
  if (!metadata || metadata.status === 'deleted') {
    return createErrorResponse(`Master '${master}' not found`, 404)
  }

  const masterCol = await getMasterCollection(client, master)

  // Build query filter
  const dbFilter = buildExportFilter(params, metadata)

  // Field selection
  const selectedFields = params.fields
    ? (Array.isArray(params.fields) ? params.fields : params.fields.split(',').map(f => f.trim()))
    : metadata.schema.map(f => f.name)

  // Count total matching records
  let totalRecords = 0
  try { totalRecords = await masterCol.countDocuments(dbFilter) } catch (e) { /* fallback below */ }

  if (totalRecords === 0) {
    return createResponse({ status: 'empty', message: 'No records match the export criteria', count: 0 })
  }

  if (totalRecords > MAX_EXPORT_RECORDS) {
    return createErrorResponse(
      `Export would include ${totalRecords} records, exceeding the limit of ${MAX_EXPORT_RECORDS}. Add filters to reduce the dataset.`,
      413
    )
  }

  // Fetch records
  const sort = params.sort ? { [`data.${params.sort}`]: params.order === 'desc' ? -1 : 1 } : { createdAt: -1 }
  const records = await masterCol.find(dbFilter).sort(sort).limit(MAX_EXPORT_RECORDS).toArray()

  // Generate export content
  let content, contentType, extension
  if (format === 'csv') {
    content = generateCSV(records, selectedFields, metadata)
    contentType = 'text/csv'
    extension = 'csv'
  } else if (format === 'jsonl') {
    content = records.map(r => JSON.stringify(pickFields(r.data, selectedFields))).join('\n')
    contentType = 'application/x-ndjson'
    extension = 'jsonl'
  } else {
    content = JSON.stringify(records.map(r => pickFields(r.data, selectedFields)), null, 2)
    contentType = 'application/json'
    extension = 'json'
  }

  // For small exports, return inline
  if (records.length <= INLINE_LIMIT) {
    const user = await getUserFromParams(params, client)
    await createAuditLog(client, {
      masterName: master,
      operation: 'export-data',
      actor: user,
      status: 'success',
      detail: `Exported ${records.length} records as ${format} (inline)`,
      affectedRecords: records.length
    })

    return createResponse({
      status: 'success',
      format,
      count: records.length,
      totalAvailable: totalRecords,
      fields: selectedFields,
      content,
      contentType
    })
  }

  // For large exports, write to aio-lib-files and return presigned URL
  const filesClient = await getFilesClient()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = `exports/${master}/${timestamp}.${extension}`

  await filesClient.write(filePath, content)
  const presignUrl = await filesClient.generatePresignURL(filePath, { expiryInSeconds: 3600 })

  const user = await getUserFromParams(params, client)
  await createAuditLog(client, {
    masterName: master,
    operation: 'export-data',
    actor: user,
    status: 'success',
    detail: `Exported ${records.length} records as ${format} (file)`,
    affectedRecords: records.length
  })

  return createResponse({
    status: 'success',
    format,
    count: records.length,
    totalAvailable: totalRecords,
    fields: selectedFields,
    downloadUrl: presignUrl,
    expiresIn: '1 hour'
  })
}

// ============ Preview ============

async function handlePreview (client, params) {
  const master = params.master || params.entity
  if (!master) return createErrorResponse('Missing required parameter: master')
  if (!validateMasterName(master)) return createErrorResponse('Invalid master name')

  const metaCol = await client.collection(COLLECTIONS.METADATA)
  const metadata = await safeFindOne(metaCol, { masterName: master })
  if (!metadata || metadata.status === 'deleted') {
    return createErrorResponse(`Master '${master}' not found`, 404)
  }

  const masterCol = await getMasterCollection(client, master)
  const dbFilter = buildExportFilter(params, metadata)
  const limit = Math.min(Number(params.limit) || 10, 100)

  const records = await masterCol.find(dbFilter).limit(limit).toArray()
  let totalCount = 0
  try { totalCount = await masterCol.countDocuments(dbFilter) } catch (e) { /* best-effort */ }

  return createResponse({
    status: 'success',
    records: records.map(r => r.data),
    count: records.length,
    totalAvailable: totalCount,
    schema: metadata.schema.map(f => ({ name: f.name, type: f.type, required: f.required }))
  })
}

// ============ Data Quality ============

async function handleQuality (client, params) {
  const master = params.master || params.entity
  if (!master) return createErrorResponse('Missing required parameter: master')
  if (!validateMasterName(master)) return createErrorResponse('Invalid master name')

  const metaCol = await client.collection(COLLECTIONS.METADATA)
  const metadata = await safeFindOne(metaCol, { masterName: master })
  if (!metadata || metadata.status === 'deleted') {
    return createErrorResponse(`Master '${master}' not found`, 404)
  }

  // Single record quality
  if (params.recordId) {
    const masterCol = await getMasterCollection(client, master)
    const record = await safeFindOne(masterCol, { primaryKey: String(params.recordId), deleted: false })
    if (!record) return createErrorResponse(`Record '${params.recordId}' not found`, 404)

    const quality = computeRecordQuality(record.data, metadata.schema)
    return createResponse({ status: 'success', master, recordId: params.recordId, quality })
  }

  // Entity-level quality
  const sampleSize = Math.min(Number(params.sampleSize) || 500, 2000)
  const quality = await computeEntityQuality(client, master, metadata, sampleSize)

  return createResponse({ status: 'success', master, quality })
}

// ============ Duplicate Detection ============

async function handleDuplicates (client, params) {
  const master = params.master || params.entity
  if (!master) return createErrorResponse('Missing required parameter: master')
  if (!validateMasterName(master)) return createErrorResponse('Invalid master name')

  const metaCol = await client.collection(COLLECTIONS.METADATA)
  const metadata = await safeFindOne(metaCol, { masterName: master })
  if (!metadata || metadata.status === 'deleted') {
    return createErrorResponse(`Master '${master}' not found`, 404)
  }

  const opts = {
    matchFields: params.matchFields ? (Array.isArray(params.matchFields) ? params.matchFields : params.matchFields.split(',')) : undefined,
    threshold: params.threshold ? Number(params.threshold) / 100 : undefined,
    limit: params.limit ? Number(params.limit) : undefined,
    sampleSize: params.sampleSize ? Number(params.sampleSize) : undefined
  }

  const result = await findDuplicates(client, master, metadata, opts)

  return createResponse({ status: 'success', master, ...result })
}

// ============ Version History ============

async function handleVersions (client, params) {
  const master = params.master || params.entity
  const recordId = params.recordId || params.id
  if (!master) return createErrorResponse('Missing required parameter: master')
  if (!recordId) return createErrorResponse('Missing required parameter: recordId')
  if (!validateMasterName(master)) return createErrorResponse('Invalid master name')

  const result = await getRecordVersions(client, master, recordId, {
    page: Number(params.page) || 1,
    pageSize: Number(params.pageSize) || 20
  })

  return createResponse({ status: 'success', master, recordId, ...result })
}

// ============ Rollback ============

async function handleRollback (client, params) {
  const master = params.master || params.entity
  const recordId = params.recordId || params.id
  const targetVersion = Number(params.targetVersion || params.version)
  if (!master) return createErrorResponse('Missing required parameter: master')
  if (!recordId) return createErrorResponse('Missing required parameter: recordId')
  if (!targetVersion) return createErrorResponse('Missing required parameter: targetVersion')
  if (!validateMasterName(master)) return createErrorResponse('Invalid master name')

  const user = await getUserFromParams(params, client)
  const result = await rollbackRecord(client, master, recordId, targetVersion, user, params)

  return createResponse(result)
}

// ============ Helpers ============

function buildExportFilter (params, metadata) {
  const filter = { deleted: false }

  // Status filter (for approval workflow)
  if (params.status) {
    filter.workflowStatus = params.status
  }

  // Data-level filters: field=value pairs
  if (params.filter) {
    const filterParts = params.filter.split('&')
    filterParts.forEach(part => {
      const eqIdx = part.indexOf('=')
      if (eqIdx > 0) {
        const key = part.substring(0, eqIdx).trim()
        const val = part.substring(eqIdx + 1).trim()
        if (key && val) {
          filter[`data.${key}`] = { $regex: `^${escapeRegex(val)}`, $options: 'i' }
        }
      }
    })
  }

  // Date range filter
  if (params.createdAfter) {
    filter.createdAt = { ...(filter.createdAt || {}), $gte: new Date(params.createdAfter) }
  }
  if (params.createdBefore) {
    filter.createdAt = { ...(filter.createdAt || {}), $lte: new Date(params.createdBefore) }
  }

  return filter
}

function pickFields (data, fields) {
  if (!data || !fields) return data
  const result = {}
  for (const f of fields) {
    if (data[f] !== undefined) result[f] = data[f]
  }
  return result
}

function generateCSV (records, fields, metadata) {
  // Header row
  const lines = [fields.join(',')]

  for (const record of records) {
    const values = fields.map(f => {
      const val = record.data[f]
      if (val === undefined || val === null) return ''
      const str = String(val)
      // Escape CSV: quote if contains comma, newline, or double-quote
      if (str.includes(',') || str.includes('\n') || str.includes('"')) {
        return '"' + str.replace(/"/g, '""') + '"'
      }
      return str
    })
    lines.push(values.join(','))
  }

  return lines.join('\n')
}

exports.main = main
