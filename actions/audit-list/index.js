/**
 * MDM Audit List Action
 * Query audit logs with filtering, pagination, and sorting.
 * Also supports type=archives to list audit archive files.
 * Returns normalized log entries from aio-lib-db audit collection.
 */

const { getDbClient, safeFindOne, COLLECTIONS, createResponse, createErrorResponse, validateIMSToken, getEnvConfig, getCachedSettings, enforceAppPermission } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  // Route to archives listing if type=archives
  if (params.type === 'archives') {
    return handleArchivesList(params)
  }

  let client
  try {
    const entity = params.master || params.entity
    const operation = params.action || params.operation
    const actor = params.user || params.actor
    const { status, page, pageSize, startDate, endDate } = params

    client = await getDbClient(params)

    // App-level RBAC
    const appPerm = await enforceAppPermission(client, params, 'audit-list')
    if (!appPerm.allowed) return appPerm.response

    const auditCol = await client.collection(COLLECTIONS.AUDIT)

    // Build DB-safe filter (only simple equality filters for aio-lib-db compatibility)
    const filter = {}
    if (entity) filter.masterName = entity
    if (status) filter.status = status

    // Date range filter
    if (startDate || endDate) {
      filter.timestamp = {}
      if (startDate) filter.timestamp.$gte = startDate
      if (endDate) filter.timestamp.$lte = endDate
    }

    // Pagination — use settings-configured limits
    const settingsDoc = await getCachedSettings(client)
    const env = getEnvConfig(params)
    const apiSettings = settingsDoc?.api || {}
    const maxPageSize = apiSettings.maxPageSize || env.maxPageSize
    const defaultPageSize = apiSettings.defaultPageSize || env.defaultPageSize

    const p = Math.max(1, parseInt(page) || 1)
    const ps = Math.min(maxPageSize, Math.max(1, parseInt(pageSize) || defaultPageSize))

    // Determine if we need JS-level substring filtering
    const needsJsFilter = !!operation || !!actor

    let logs, total

    if (!needsJsFilter) {
      // Fast path: DB-level pagination via skip/limit (no JS post-filtering needed)
      const cursor = auditCol.find(filter).sort({ timestamp: -1 })
      total = await auditCol.countDocuments(filter)
      const rawLogs = await cursor.skip((p - 1) * ps).limit(ps).toArray()
      logs = rawLogs.map(normalizLog)
    } else {
      // Use DB-level $regex for operation/actor substring search
      const regexFilter = { ...filter }

      if (operation) {
        regexFilter.$or = [
          { operation: { $regex: operation, $options: 'i' } },
          { action: { $regex: operation, $options: 'i' } }
        ]
      }

      if (actor) {
        const actorConditions = [
          { actor: { $regex: actor, $options: 'i' } },
          { user: { $regex: actor, $options: 'i' } }
        ]
        if (regexFilter.$or) {
          // Both operation and actor filters: combine with $and
          regexFilter.$and = [
            { $or: regexFilter.$or },
            { $or: actorConditions }
          ]
          delete regexFilter.$or
        } else {
          regexFilter.$or = actorConditions
        }
      }

      total = await auditCol.countDocuments(regexFilter)
      const rawLogs = await auditCol.find(regexFilter)
        .sort({ timestamp: -1 })
        .skip((p - 1) * ps)
        .limit(ps)
        .toArray()
      logs = rawLogs.map(normalizLog)
    }

    return createResponse({
      logs,
      page: p,
      pageSize: ps,
      total
    })
  } catch (error) {
    console.error('Audit list error:', error)
    return createErrorResponse(`Failed to list audit logs: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

/** Normalize a raw audit-log document for frontend consumption */
function normalizLog (log) {
  const { _id, masterName, operation: op, action: act, actor: usr, user: usr2, status: s, timestamp, ...rest } = log
  const operation = op || act || 'unknown'
  const user = usr || usr2 || 'system'
  return {
    id: _id || `${timestamp}-${masterName}-${operation}`,
    timestamp: timestamp || null,
    master: masterName || '_system',
    action: operation,
    operation,
    user,
    actor: user,
    status: s || 'unknown',
    details: rest
  }
}

/** List audit archive files from audit_archives collection */
async function handleArchivesList (params) {
  let client
  try {
    const { status, page, pageSize } = params

    client = await getDbClient(params)
    const archivesCol = await client.collection(COLLECTIONS.AUDIT_ARCHIVES)

    // Build filter
    const filter = {}
    if (status) {
      filter.status = status
    }

    // Pagination
    const settingsDoc = await getCachedSettings(client)
    const env = getEnvConfig(params)
    const apiSettings = settingsDoc?.api || {}
    const maxPageSize = apiSettings.maxPageSize || env.maxPageSize
    const defaultPageSize = apiSettings.defaultPageSize || env.defaultPageSize

    const p = Math.max(1, parseInt(page) || 1)
    const ps = Math.min(maxPageSize, Math.max(1, parseInt(pageSize) || defaultPageSize))

    const total = await archivesCol.countDocuments(filter)
    const archives = await archivesCol.find(filter)
      .sort({ archivedAt: -1 })
      .skip((p - 1) * ps)
      .limit(ps)
      .toArray()

    // Enrich with computed fields and strip internal DB id
    const now = new Date()
    const enrichedArchives = archives.map(({ _id, ...a }) => ({
      ...a,
      isExpired: a.status === 'expired' || new Date(a.expiresAt) < now,
      daysUntilExpiry: Math.max(0, Math.ceil((new Date(a.expiresAt) - now) / 86400000))
    }))

    // Summary
    const summary = {
      totalArchives: total,
      totalRecords: archives.reduce((sum, a) => sum + (a.recordCount || 0), 0),
      totalSizeBytes: archives.reduce((sum, a) => sum + (a.sizeBytes || 0), 0)
    }

    return createResponse({
      archives: enrichedArchives,
      summary,
      page: p,
      pageSize: ps,
      total
    })
  } catch (error) {
    console.error('Audit archives list error:', error)
    return createErrorResponse(`Failed to list audit archives: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
