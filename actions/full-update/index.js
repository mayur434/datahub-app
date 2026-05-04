/**
 * MDM Full Update Action
 * Replaces the entire dataset for a master.
 * Deletes old records, inserts new ones from CSV into per-master collection.
 */

const { getDbClient, safeFindOne, COLLECTIONS, getMasterCollection, parseCSV, validateCSV, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams, checkPermission, checkStorageGuardrails, estimateFileSizeMB, enforceAppPermission, decompressCsvContent } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const master = params.master || params.entity
    const csvContent = decompressCsvContent(params)
    if (!master || !csvContent) {
      return createErrorResponse('Missing required parameters: master, csvContent')
    }

    client = await getDbClient(params)

    // App-level RBAC
    const appPerm = await enforceAppPermission(client, params, 'full-update')
    if (!appPerm.allowed) return appPerm.response

    const user = await getUserFromParams(params, client)

    // RBAC check
    const perm = await checkPermission(client, user, 'full-update', master)
    if (!perm.allowed) {
      return createErrorResponse(`Permission denied: role '${perm.role}' cannot perform 'full-update' on '${master}'`, 403)
    }

    const metaCol = await client.collection(COLLECTIONS.METADATA)
    const masterCol = await getMasterCollection(client, master)

    const metadata = await safeFindOne(metaCol, { masterName: master })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Master '${master}' not found`, 404)
    }

    if (!metadata.allowedOperations.fullUpdate) {
      return createErrorResponse('Full update operation not allowed for this master', 403)
    }

    // Parse new CSV
    const { headers, records } = parseCSV(csvContent)
    const validationErrors = validateCSV(headers, records, metadata)
    if (validationErrors.length > 0) {
      return createResponse({ status: 'validation_failed', errors: validationErrors }, 422)
    }

    // Storage guardrail — full-update replaces, so net new = newRecords - oldRecords
    const fileSizeMB = estimateFileSizeMB(csvContent)
    const oldRecordCount = await masterCol.countDocuments({ deleted: { $ne: true } })
    const netNew = Math.max(0, records.length - oldRecordCount)
    if (netNew > 0) {
      const guardrail = await checkStorageGuardrails(client, {
        newDocumentCount: netNew + 1,
        entity: master,
        currentEntityRecords: records.length,
        fileSizeMB,
        params
      })
      if (!guardrail.allowed) {
        return createErrorResponse(`Storage guardrail: ${guardrail.reason}`, 507)
      }
    }

    // Insert new records first (before deleting old) for atomicity
    const auditConfig = metadata.recordAudit
    const now = new Date()
    const recordDocs = records.map(record => {
      if (auditConfig && auditConfig.enabled) {
        if (auditConfig.createdAt) record._createdAt = now
        if (auditConfig.updatedAt) record._updatedAt = now
        if (auditConfig.createdBy) record._createdBy = user
        if (auditConfig.updatedBy) record._updatedBy = user
      }
      return {
        primaryKey: String(record[metadata.primaryKey]),
        data: record,
        status: 'active',
        deleted: false,
        createdAt: now,
        createdBy: user,
        updatedAt: now,
        updatedBy: user
      }
    })

    await masterCol.insertMany(recordDocs)

    // Delete old records (those NOT in the new batch) using $nin for efficiency
    const newPKs = recordDocs.map(r => r.primaryKey)
    await masterCol.deleteMany({ primaryKey: { $nin: newPKs } })

    // Update metadata
    await metaCol.updateOne(
      { masterName: master },
      { $set: { recordCount: records.length, lastModifiedBy: user }, $currentDate: { updatedAt: true } }
    )


    // Audit
    await createAuditLog(client, {
      masterName: master,
      operation: 'full-update',
      actor: user,
      status: 'success',
      affectedRecords: records.length,
      
    })

    return createResponse({
      master,
      operation: 'full-update',
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
