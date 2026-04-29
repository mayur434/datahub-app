/**
 * MDM Bulk Update Action
 * Handles bulk row operations from CSV or JSON payload.
 * Supports: upsert, replace, patch, delete modes + dry-run preview.
 */

const { getDbClient, safeFindOne, COLLECTIONS, parseCSV, createVersion, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  const user = getUserFromParams(params)

  let client
  try {
    const { entity, records, csvContent, operationType, dryRun } = params
    if (!entity) return createErrorResponse('Missing required parameter: entity')

    client = await getDbClient(params)
    const metaCol = await client.collection(COLLECTIONS.METADATA)
    const recordsCol = await client.collection(COLLECTIONS.RECORDS)

    const metadata = await safeFindOne(metaCol, { entityName: entity })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Entity '${entity}' not found`, 404)
    }

    if (!metadata.allowedOperations.bulkUpdate) {
      return createErrorResponse('Bulk update operation not allowed for this entity', 403)
    }

    // Parse records from CSV or use provided array
    let bulkRecords = records
    if (csvContent) {
      const parsed = parseCSV(csvContent)
      bulkRecords = parsed.records
    }

    if (!bulkRecords || !Array.isArray(bulkRecords) || bulkRecords.length === 0) {
      return createErrorResponse('No records provided for bulk update')
    }

    const opType = operationType || 'upsert'

    // Dry run — validate and return preview
    if (dryRun) {
      const preview = { toInsert: 0, toUpdate: 0, toDelete: 0, errors: [] }
      for (const record of bulkRecords) {
        const pk = record[metadata.primaryKey]
        if (!pk) { preview.errors.push('Missing primary key for record'); continue }
        const exists = await safeFindOne(recordsCol, { entityName: entity, primaryKey: pk, deleted: false })
        if (opType === 'delete') {
          preview.toDelete += exists ? 1 : 0
        } else if (opType === 'upsert') {
          exists ? preview.toUpdate++ : preview.toInsert++
        } else if (opType === 'replace' || opType === 'patch') {
          exists ? preview.toUpdate++ : preview.errors.push(`Record '${pk}' not found`)
        }
      }
      return createResponse({ entity, dryRun: true, preview, status: 'preview' })
    }

    // Execute bulk operations
    let inserted = 0, updated = 0, deleted = 0, failed = 0
    const errors = []

    // Use bulkWrite for performance
    const ops = []
    for (let i = 0; i < bulkRecords.length; i++) {
      const record = bulkRecords[i]
      const pk = record[metadata.primaryKey]
      if (!pk) { errors.push(`Record ${i + 1}: Missing primary key`); failed++; continue }

      try {
        const existing = await safeFindOne(recordsCol, { entityName: entity, primaryKey: pk, deleted: false })
        const exists = !!existing

        switch (opType) {
          case 'upsert':
            if (exists) {
              ops.push({ updateOne: { filter: { entityName: entity, primaryKey: pk }, update: { $set: { data: { ...existing.data, ...record }, updatedAt: new Date().toISOString(), updatedBy: user } } } })
              updated++
            } else {
              ops.push({ insertOne: { document: { entityName: entity, primaryKey: pk, versionId: metadata.activeVersionId, data: record, status: 'active', deleted: false, createdAt: new Date().toISOString(), createdBy: user, updatedAt: new Date().toISOString(), updatedBy: user } } })
              inserted++
            }
            break
          case 'replace':
            if (!exists) { errors.push(`Record ${i + 1}: '${pk}' not found`); failed++ }
            else {
              ops.push({ updateOne: { filter: { entityName: entity, primaryKey: pk }, update: { $set: { data: record, updatedAt: new Date().toISOString(), updatedBy: user } } } })
              updated++
            }
            break
          case 'patch':
            if (!exists) { errors.push(`Record ${i + 1}: '${pk}' not found`); failed++ }
            else {
              ops.push({ updateOne: { filter: { entityName: entity, primaryKey: pk }, update: { $set: { data: { ...existing.data, ...record }, updatedAt: new Date().toISOString(), updatedBy: user } } } })
              updated++
            }
            break
          case 'delete':
            if (!exists) { errors.push(`Record ${i + 1}: '${pk}' not found`); failed++ }
            else {
              ops.push({ updateOne: { filter: { entityName: entity, primaryKey: pk }, update: { $set: { deleted: true, status: 'deleted', updatedAt: new Date().toISOString(), updatedBy: user } } } })
              deleted++
            }
            break
        }
      } catch (err) {
        errors.push(`Record ${i + 1}: ${err.message}`); failed++
      }
    }

    // Execute bulk write
    if (ops.length > 0) {
      await recordsCol.bulkWrite(ops)
    }

    // Update count + version
    const count = await recordsCol.countDocuments({ entityName: entity, deleted: false })
    const version = await createVersion(client, entity, 'bulk-update', user, { inserted, updated, deleted }, count)

    await metaCol.updateOne(
      { entityName: entity },
      { $set: { activeVersionId: version.versionId, recordCount: count, updatedAt: new Date().toISOString() } }
    )

    await createAuditLog(client, {
      entityName: entity,
      operation: 'bulk-update',
      actor: user,
      status: failed === 0 ? 'success' : 'partial',
      afterVersion: version.versionId,
      affectedRecords: inserted + updated + deleted,
      
    })

    return createResponse({
      entity,
      operation: 'bulk-update',
      operationType: opType,
      versionId: version.versionId,
      inserted,
      updated,
      deleted,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      status: failed === 0 ? 'success' : 'partial'
    })
  } catch (error) {
    console.error('Bulk update error:', error)
    return createErrorResponse(`Bulk update failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
