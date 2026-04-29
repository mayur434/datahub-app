/**
 * MDM Delta Update Action
 * Applies incremental changes (upsert, update-only, insert-only, mixed-action).
 */

const { getDbClient, safeFindOne, COLLECTIONS, parseCSV, createVersion, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  const user = getUserFromParams(params)

  let client
  try {
    const { entity, csvContent, mode } = params
    const deltaMode = mode || 'upsert'

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

    if (!metadata.allowedOperations.deltaUpdate) {
      return createErrorResponse('Delta update operation not allowed for this entity', 403)
    }

    const { records } = parseCSV(csvContent)

    let inserted = 0
    let updated = 0
    let deleted = 0
    let skipped = 0
    const errors = []

    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      const pk = record[metadata.primaryKey]
      const action = record._action ? record._action.toUpperCase() : null

      if (!pk && deltaMode !== 'mixed') {
        errors.push(`Row ${i + 2}: Missing primary key`)
        skipped++
        continue
      }

      const data = { ...record }
      delete data._action

      const existing = pk ? await safeFindOne(recordsCol, { entityName: entity, primaryKey: pk, deleted: false }) : null

      if (deltaMode === 'mixed' && action) {
        switch (action) {
          case 'CREATE':
            if (existing) { errors.push(`Row ${i + 2}: Record '${pk}' already exists`); skipped++ }
            else {
              await recordsCol.insertOne({ entityName: entity, primaryKey: pk, versionId: metadata.activeVersionId, data, status: 'active', deleted: false, createdAt: new Date().toISOString(), createdBy: user, updatedAt: new Date().toISOString(), updatedBy: user })
              inserted++
            }
            break
          case 'UPDATE':
            if (!existing) { errors.push(`Row ${i + 2}: Record '${pk}' not found`); skipped++ }
            else {
              await recordsCol.updateOne({ entityName: entity, primaryKey: pk }, { $set: { data: { ...existing.data, ...data }, updatedAt: new Date().toISOString(), updatedBy: user } })
              updated++
            }
            break
          case 'DELETE':
            if (!existing) { errors.push(`Row ${i + 2}: Record '${pk}' not found`); skipped++ }
            else {
              await recordsCol.updateOne({ entityName: entity, primaryKey: pk }, { $set: { deleted: true, status: 'deleted', updatedAt: new Date().toISOString(), updatedBy: user } })
              deleted++
            }
            break
          default:
            errors.push(`Row ${i + 2}: Unknown action '${action}'`); skipped++
        }
      } else if (deltaMode === 'upsert') {
        if (existing) {
          await recordsCol.updateOne({ entityName: entity, primaryKey: pk }, { $set: { data: { ...existing.data, ...data }, updatedAt: new Date().toISOString(), updatedBy: user } })
          updated++
        } else {
          await recordsCol.insertOne({ entityName: entity, primaryKey: pk, versionId: metadata.activeVersionId, data, status: 'active', deleted: false, createdAt: new Date().toISOString(), createdBy: user, updatedAt: new Date().toISOString(), updatedBy: user })
          inserted++
        }
      } else if (deltaMode === 'update-only') {
        if (!existing) { errors.push(`Row ${i + 2}: Record '${pk}' not found (update-only mode)`); skipped++ }
        else {
          await recordsCol.updateOne({ entityName: entity, primaryKey: pk }, { $set: { data: { ...existing.data, ...data }, updatedAt: new Date().toISOString(), updatedBy: user } })
          updated++
        }
      } else if (deltaMode === 'insert-only') {
        if (existing) { errors.push(`Row ${i + 2}: Record '${pk}' already exists (insert-only mode)`); skipped++ }
        else {
          await recordsCol.insertOne({ entityName: entity, primaryKey: pk, versionId: metadata.activeVersionId, data, status: 'active', deleted: false, createdAt: new Date().toISOString(), createdBy: user, updatedAt: new Date().toISOString(), updatedBy: user })
          inserted++
        }
      }
    }

    // Update record count
    const count = await recordsCol.countDocuments({ entityName: entity, deleted: false })

    // Create version
    const version = await createVersion(client, entity, 'delta-update', user, { inserted, updated, deleted }, count)

    // Update metadata
    await metaCol.updateOne(
      { entityName: entity },
      { $set: { activeVersionId: version.versionId, recordCount: count, updatedAt: new Date().toISOString() } }
    )

    // Audit
    await createAuditLog(client, {
      entityName: entity,
      operation: 'delta-update',
      actor: user,
      status: errors.length === 0 ? 'success' : 'partial',
      afterVersion: version.versionId,
      affectedRecords: inserted + updated + deleted
    })

    return createResponse({
      entity,
      operation: 'delta-update',
      mode: deltaMode,
      versionId: version.versionId,
      inserted,
      updated,
      deleted,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
      status: errors.length === 0 ? 'success' : 'partial'
    })
  } catch (error) {
    console.error('Delta update error:', error)
    return createErrorResponse(`Delta update failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
