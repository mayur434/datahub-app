/**
 * MDM Delta Update Action
 * Applies incremental changes (upsert, update-only, insert-only, mixed-action).
 * Operates on per-master collections.
 */

const { getDbClient, safeFindOne, COLLECTIONS, getMasterCollection, parseCSV, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams, checkPermission, checkStorageGuardrails, estimateFileSizeMB, enforceAppPermission, decompressCsvContent } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const master = params.master || params.entity
    const csvContent = decompressCsvContent(params)
    const { mode } = params
    const deltaMode = mode || 'upsert'

    if (!master || !csvContent) {
      return createErrorResponse('Missing required parameters: master, csvContent')
    }

    client = await getDbClient(params)

    // App-level RBAC
    const appPerm = await enforceAppPermission(client, params, 'delta-update')
    if (!appPerm.allowed) return appPerm.response

    const user = await getUserFromParams(params, client)

    // RBAC check
    const perm = await checkPermission(client, user, 'delta-update', master)
    if (!perm.allowed) {
      return createErrorResponse(`Permission denied: role '${perm.role}' cannot perform 'delta-update' on '${master}'`, 403)
    }

    const metaCol = await client.collection(COLLECTIONS.METADATA)
    const masterCol = await getMasterCollection(client, master)

    const metadata = await safeFindOne(metaCol, { masterName: master })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Master '${master}' not found`, 404)
    }

    if (!metadata.allowedOperations.deltaUpdate) {
      return createErrorResponse('Delta update operation not allowed for this master', 403)
    }

    const { records } = parseCSV(csvContent)

    // Storage guardrail — estimate worst-case (all inserts)
    const fileSizeMB = estimateFileSizeMB(csvContent)
    const guardrail = await checkStorageGuardrails(client, {
      newDocumentCount: records.length + 1,
      entity: master,
      currentEntityRecords: metadata.recordCount || 0,
      fileSizeMB,
      params
    })
    if (!guardrail.allowed) {
      return createErrorResponse(`Storage guardrail: ${guardrail.reason}`, 507)
    }

    // Batch-fetch existing records upfront using $in query to avoid N+1
    const pks = records.map(r => r[metadata.primaryKey]).filter(Boolean)
    const existingRecords = pks.length > 0
      ? await masterCol.find({ primaryKey: { $in: pks }, deleted: { $ne: true } }).toArray()
      : []
    const existingMap = new Map(existingRecords.map(r => [r.primaryKey, r]))

    let inserted = 0
    let updated = 0
    let deleted = 0
    let skipped = 0
    const errors = []
    const auditConfig = metadata.recordAudit
    const bulkOps = []
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

    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      const pk = record[metadata.primaryKey] ? String(record[metadata.primaryKey]) : null
      const action = record._action ? record._action.toUpperCase() : null

      if (!pk && deltaMode !== 'mixed') {
        errors.push(`Row ${i + 2}: Missing primary key`)
        skipped++
        continue
      }

      const data = { ...record }
      delete data._action

      const existing = pk ? existingMap.get(pk) || null : null

      if (deltaMode === 'mixed' && action) {
        switch (action) {
          case 'CREATE':
            if (existing) { errors.push(`Row ${i + 2}: Record '${pk}' already exists`); skipped++ }
            else {
              injectAudit(data, true)
              bulkOps.push({ insertOne: { document: { primaryKey: pk, data, status: 'active', deleted: false, createdAt: now, createdBy: user, updatedAt: now, updatedBy: user } } })
              inserted++
            }
            break
          case 'UPDATE':
            if (!existing) { errors.push(`Row ${i + 2}: Record '${pk}' not found`); skipped++ }
            else {
              const mergedData = { ...existing.data, ...data }
              injectAudit(mergedData, false)
              bulkOps.push({ updateOne: { filter: { primaryKey: pk }, update: { $set: { data: mergedData, updatedBy: user }, $currentDate: { updatedAt: true } } } })
              updated++
            }
            break
          case 'DELETE':
            if (!existing) { errors.push(`Row ${i + 2}: Record '${pk}' not found`); skipped++ }
            else {
              bulkOps.push({ updateOne: { filter: { primaryKey: pk }, update: { $set: { deleted: true, status: 'deleted', updatedBy: user }, $currentDate: { updatedAt: true } } } })
              deleted++
            }
            break
          default:
            errors.push(`Row ${i + 2}: Unknown action '${action}'`); skipped++
        }
      } else if (deltaMode === 'upsert') {
        if (existing) {
          const mergedData = { ...existing.data, ...data }
          injectAudit(mergedData, false)
          bulkOps.push({ updateOne: { filter: { primaryKey: pk }, update: { $set: { data: mergedData, updatedBy: user }, $currentDate: { updatedAt: true } } } })
          updated++
        } else {
          injectAudit(data, true)
          bulkOps.push({ insertOne: { document: { primaryKey: pk, data, status: 'active', deleted: false, createdAt: now, createdBy: user, updatedAt: now, updatedBy: user } } })
          inserted++
        }
      } else if (deltaMode === 'update-only') {
        if (!existing) { errors.push(`Row ${i + 2}: Record '${pk}' not found (update-only mode)`); skipped++ }
        else {
          const mergedData = { ...existing.data, ...data }
          injectAudit(mergedData, false)
          bulkOps.push({ updateOne: { filter: { primaryKey: pk }, update: { $set: { data: mergedData, updatedBy: user }, $currentDate: { updatedAt: true } } } })
          updated++
        }
      } else if (deltaMode === 'insert-only') {
        if (existing) { errors.push(`Row ${i + 2}: Record '${pk}' already exists (insert-only mode)`); skipped++ }
        else {
          injectAudit(data, true)
          bulkOps.push({ insertOne: { document: { primaryKey: pk, data, status: 'active', deleted: false, createdAt: now, createdBy: user, updatedAt: now, updatedBy: user } } })
          inserted++
        }
      }
    }

    // Execute all writes in a single bulkWrite call
    if (bulkOps.length > 0) {
      await masterCol.bulkWrite(bulkOps, { ordered: false })
    }

    // Update record count using countDocuments
    const count = await masterCol.countDocuments({ deleted: { $ne: true } })

    // Update metadata
    await metaCol.updateOne(
      { masterName: master },
      { $set: { recordCount: count, lastModifiedBy: user }, $currentDate: { updatedAt: true } }
    )

    // Audit
    await createAuditLog(client, {
      masterName: master,
      operation: 'delta-update',
      actor: user,
      status: errors.length === 0 ? 'success' : 'partial',
      affectedRecords: inserted + updated + deleted
    })

    return createResponse({
      master,
      operation: 'delta-update',
      mode: deltaMode,
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
