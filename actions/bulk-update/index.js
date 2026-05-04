/**
 * MDM Bulk Update Action
 * Handles bulk row operations from CSV or JSON payload.
 * Supports: upsert, replace, patch, delete modes + dry-run preview.
 * Operates on per-master collections.
 */

const { getDbClient, safeFindOne, COLLECTIONS, getMasterCollection, parseCSV, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams, checkPermission, checkStorageGuardrails, getEnvConfig, getCachedSettings, enforceAppPermission } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const master = params.master || params.entity
    const { records, csvContent, operationType, dryRun } = params
    if (!master) return createErrorResponse('Missing required parameter: master')

    client = await getDbClient(params)

    // App-level RBAC
    const appPerm = await enforceAppPermission(client, params, 'bulk-update')
    if (!appPerm.allowed) return appPerm.response

    const user = await getUserFromParams(params, client)

    // RBAC check
    const perm = await checkPermission(client, user, 'bulk-update', master)
    if (!perm.allowed) {
      return createErrorResponse(`Permission denied: role '${perm.role}' cannot perform 'bulk-update' on '${master}'`, 403)
    }

    const metaCol = await client.collection(COLLECTIONS.METADATA)
    const masterCol = await getMasterCollection(client, master)

    const metadata = await safeFindOne(metaCol, { masterName: master })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Master '${master}' not found`, 404)
    }

    if (!metadata.allowedOperations.bulkUpdate) {
      return createErrorResponse('Bulk update operation not allowed for this master', 403)
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

    // Storage guardrail check (worst-case: all inserts)
    if (opType !== 'delete') {
      const guardrail = await checkStorageGuardrails(client, {
        newDocumentCount: bulkRecords.length + 1,
        entity: master,
        currentEntityRecords: metadata.recordCount || 0,
        params
      })
      if (!guardrail.allowed) {
        return createErrorResponse(`Storage guardrail: ${guardrail.reason}`, 507)
      }
    }

    // Batch-fetch existing records upfront using $in query to avoid N+1
    const pks = bulkRecords.map(r => r[metadata.primaryKey]).filter(Boolean)
    const existingRecords = pks.length > 0
      ? await masterCol.find({ primaryKey: { $in: pks }, deleted: { $ne: true } }).toArray()
      : []
    const existingMap = new Map(existingRecords.map(r => [r.primaryKey, r]))

    // Dry run — validate and return preview
    if (dryRun) {
      const preview = { toInsert: 0, toUpdate: 0, toDelete: 0, errors: [] }
      for (const record of bulkRecords) {
        const pk = record[metadata.primaryKey]
        if (!pk) { preview.errors.push('Missing primary key for record'); continue }
        const exists = existingMap.has(pk)
        if (opType === 'delete') {
          preview.toDelete += exists ? 1 : 0
        } else if (opType === 'upsert') {
          exists ? preview.toUpdate++ : preview.toInsert++
        } else if (opType === 'replace' || opType === 'patch') {
          exists ? preview.toUpdate++ : preview.errors.push(`Record '${pk}' not found`)
        }
      }
      return createResponse({ master, dryRun: true, preview, status: 'preview' })
    }

    // Execute bulk operations
    let inserted = 0, updated = 0, deleted = 0, failed = 0
    const errors = []
    const auditConfig = metadata.recordAudit
    const now = new Date()

    function injectAudit (data, isCreate) {
      if (!auditConfig || !auditConfig.enabled) return
      if (isCreate) {
        if (auditConfig.createdAt) data._createdAt = now
        if (auditConfig.updatedAt) data._updatedAt = now
        if (auditConfig.createdBy) data._createdBy = user
        if (auditConfig.updatedBy) data._updatedBy = user
      } else {
        if (auditConfig.updatedAt) data._updatedAt = now
        if (auditConfig.updatedBy) data._updatedBy = user
      }
    }

    // Use bulkWrite for performance
    const ops = []
    for (let i = 0; i < bulkRecords.length; i++) {
      const record = bulkRecords[i]
      const pk = record[metadata.primaryKey] ? String(record[metadata.primaryKey]) : null
      if (!pk) { errors.push(`Record ${i + 1}: Missing primary key`); failed++; continue }

      try {
        const existing = existingMap.get(pk) || null
        const exists = !!existing

        switch (opType) {
          case 'upsert':
            if (exists) {
              const mergedData = { ...existing.data, ...record }
              injectAudit(mergedData, false)
              ops.push({ updateOne: { filter: { primaryKey: pk }, update: { $set: { data: mergedData, updatedBy: user }, $currentDate: { updatedAt: true } } } })
              updated++
            } else {
              injectAudit(record, true)
              ops.push({ insertOne: { document: { primaryKey: pk, data: record, status: 'active', deleted: false, createdAt: now, createdBy: user, updatedAt: now, updatedBy: user } } })
              inserted++
            }
            break
          case 'replace':
            if (!exists) { errors.push(`Record ${i + 1}: '${pk}' not found`); failed++ }
            else {
              injectAudit(record, false)
              ops.push({ updateOne: { filter: { primaryKey: pk }, update: { $set: { data: record, updatedBy: user }, $currentDate: { updatedAt: true } } } })
              updated++
            }
            break
          case 'patch':
            if (!exists) { errors.push(`Record ${i + 1}: '${pk}' not found`); failed++ }
            else {
              const patchedData = { ...existing.data, ...record }
              injectAudit(patchedData, false)
              ops.push({ updateOne: { filter: { primaryKey: pk }, update: { $set: { data: patchedData, updatedBy: user }, $currentDate: { updatedAt: true } } } })
              updated++
            }
            break
          case 'delete':
            if (!exists) { errors.push(`Record ${i + 1}: '${pk}' not found`); failed++ }
            else {
              ops.push({ updateOne: { filter: { primaryKey: pk }, update: { $set: { deleted: true, status: 'deleted', updatedBy: user }, $currentDate: { updatedAt: true } } } })
              deleted++
            }
            break
        }
      } catch (err) {
        errors.push(`Record ${i + 1}: ${err.message}`); failed++
      }
    }

    // Execute bulk write in batches
    if (ops.length > 0) {
      const settingsDoc = await getCachedSettings(client)
      const env = getEnvConfig(params)
      const batchSize = settingsDoc?.performance?.bulkBatchSize || env.bulkBatchSize

      for (let b = 0; b < ops.length; b += batchSize) {
        await masterCol.bulkWrite(ops.slice(b, b + batchSize))
      }
    }

    // Update count using countDocuments
    const count = await masterCol.countDocuments({ deleted: { $ne: true } })

    await metaCol.updateOne(
      { masterName: master },
      { $set: { recordCount: count, lastModifiedBy: user }, $currentDate: { updatedAt: true } }
    )

    await createAuditLog(client, {
      masterName: master,
      operation: 'bulk-update',
      actor: user,
      status: failed === 0 ? 'success' : 'partial',
      affectedRecords: inserted + updated + deleted,
      
    })

    return createResponse({
      master,
      operation: 'bulk-update',
      operationType: opType,
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
