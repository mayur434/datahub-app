/**
 * MDM Full Update Action
 * Replaces the entire dataset for an entity.
 * Deletes old records, inserts new ones from CSV.
 */

const { getDbClient, safeFindOne, COLLECTIONS, parseCSV, validateCSV, createVersion, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  const user = getUserFromParams(params)

  let client
  try {
    const { entity, csvContent } = params
    if (!entity || !csvContent) {
      return createErrorResponse('Missing required parameters: entity, csvContent')
    }

    client = await getDbClient(params)
    const metaCol = await client.collection(COLLECTIONS.METADATA)
    const recordsCol = await client.collection(COLLECTIONS.RECORDS)

    const metadata = await safeFindOne(metaCol, { entityName: entity })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Entity '${entity}' not found`, 404)
    }

    if (!metadata.allowedOperations.fullUpdate) {
      return createErrorResponse('Full update operation not allowed for this entity', 403)
    }

    // Parse new CSV
    const { headers, records } = parseCSV(csvContent)
    const validationErrors = validateCSV(headers, records, metadata)
    if (validationErrors.length > 0) {
      return createResponse({ status: 'validation_failed', errors: validationErrors }, 422)
    }

    // Get old record count
    const oldRecordCount = await recordsCol.countDocuments({ entityName: entity, deleted: false })

    // Create version
    const version = await createVersion(client, entity, 'full-update', user, {
      inserted: records.length, updated: 0, deleted: oldRecordCount
    }, records.length)

    // Delete all old records for this entity
    await recordsCol.deleteMany({ entityName: entity })

    // Insert new records in bulk
    const recordDocs = records.map(record => ({
      entityName: entity,
      primaryKey: record[metadata.primaryKey],
      versionId: version.versionId,
      data: record,
      status: 'active',
      deleted: false,
      createdAt: new Date().toISOString(),
      createdBy: user,
      updatedAt: new Date().toISOString(),
      updatedBy: user
    }))

    await recordsCol.insertMany(recordDocs)

    // Update metadata
    await metaCol.updateOne(
      { entityName: entity },
      { $set: { activeVersionId: version.versionId, recordCount: records.length, updatedAt: new Date().toISOString() } }
    )


    // Audit
    await createAuditLog(client, {
      entityName: entity,
      operation: 'full-update',
      actor: user,
      status: 'success',
      afterVersion: version.versionId,
      affectedRecords: records.length,
      
    })

    return createResponse({
      entity,
      operation: 'full-update',
      versionId: version.versionId,
      inserted: records.length,
      deleted: oldRecordCount,
      status: 'success'
    })
  } catch (error) {
    console.error('Full update error:', error)
    return createErrorResponse(`Full update failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
