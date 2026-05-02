/**
 * MDM Audit List Action
 * Query audit logs with filtering, pagination, and sorting.
 * Returns normalized log entries from aio-lib-db audit collection.
 */

const { getDbClient, safeFindOne, COLLECTIONS, createResponse, createErrorResponse, validateIMSToken, getEnvConfig, getCachedSettings } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const entity = params.master || params.entity
    const operation = params.action || params.operation
    const actor = params.user || params.actor
    const { status, page, pageSize, startDate, endDate } = params

    client = await getDbClient(params)
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

    // Fetch all matching logs then apply JS-level filtering for operation/actor
    // (aio-lib-db doesn't reliably support $or/$regex compound filters)
    let allLogs = await auditCol.find(filter)
      .sort({ timestamp: -1 })
      .toArray()

    // JS-level filter for operation/action (stored under either key depending on source)
    if (operation) {
      const opLower = operation.toLowerCase()
      allLogs = allLogs.filter(log =>
        (log.operation || '').toLowerCase().includes(opLower) ||
        (log.action || '').toLowerCase().includes(opLower)
      )
    }

    // JS-level filter for actor/user (stored under either key depending on source)
    if (actor) {
      const actorLower = actor.toLowerCase()
      allLogs = allLogs.filter(log =>
        (log.actor || '').toLowerCase().includes(actorLower) ||
        (log.user || '').toLowerCase().includes(actorLower)
      )
    }

    const total = allLogs.length
    const rawLogs = allLogs.slice((p - 1) * ps, p * ps)

    // Normalize log entries for frontend consumption
    const logs = rawLogs.map(log => {
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
    })

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

exports.main = main
