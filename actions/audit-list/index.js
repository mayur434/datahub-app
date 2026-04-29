/**
 * MDM Audit List Action
 * Query audit logs with filtering, pagination, and sorting.
 * Returns normalized log entries from aio-lib-db audit collection.
 */

const { getDbClient, COLLECTIONS, createResponse, createErrorResponse, validateIMSToken } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const { entity, operation, actor, status, page, pageSize, startDate, endDate } = params

    client = await getDbClient(params)
    const auditCol = await client.collection(COLLECTIONS.AUDIT)

    // Build filter
    const filter = {}
    if (entity) filter.entityName = entity
    if (operation) filter.operation = operation
    if (actor) filter.actor = { $regex: actor, $options: 'i' }
    if (status) filter.status = status

    // Date range filter
    if (startDate || endDate) {
      filter.timestamp = {}
      if (startDate) filter.timestamp.$gte = startDate
      if (endDate) filter.timestamp.$lte = endDate
    }

    // Pagination
    const p = Math.max(1, parseInt(page) || 1)
    const ps = Math.min(100, Math.max(1, parseInt(pageSize) || 25))

    const total = await auditCol.countDocuments(filter)

    const rawLogs = await auditCol.find(filter)
      .sort({ timestamp: -1 })
      .skip((p - 1) * ps)
      .limit(ps)
      .toArray()

    // Normalize log entries for frontend consumption
    const logs = rawLogs.map(log => {
      const { _id, entityName, operation: op, actor: user, status: s, timestamp, ...rest } = log
      return {
        id: _id || `${timestamp}-${entityName}-${op}`,
        timestamp: timestamp || null,
        entity: entityName || '_system',
        operation: op || 'unknown',
        actor: user || 'system',
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
