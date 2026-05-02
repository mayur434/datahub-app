/**
 * MDM Archive Config Action
 * Manages per-entity archival configuration (override global settings).
 * Supports GET (read config) and POST (update config).
 */

const { getDbClient, safeFindOne, COLLECTIONS, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams, getEnvConfig, getCachedSettings, getTimezoneDate } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const entity = params.master || params.entity
    if (!entity) return createErrorResponse('Missing required parameter: master')

    client = await getDbClient(params)
    const user = await getUserFromParams(params, client)
    const metaCol = await client.collection(COLLECTIONS.METADATA)

    const metadata = await safeFindOne(metaCol, { masterName: entity })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Master '${entity}' not found`, 404)
    }

    const method = (params.__ow_method || 'get').toLowerCase()

    // GET: Return current archival config
    if (method === 'get') {
      const settingsCol = await client.collection(COLLECTIONS.SETTINGS)
      let globalSettings = null
      try {
        globalSettings = await getCachedSettings(client)
      } catch (e) { /* use defaults */ }

      const globalArchival = (globalSettings && globalSettings.archival) || {
        enabled: true,
        defaultThreshold: 50000,
        defaultRetentionDays: 90,
        defaultKeepLatest: 10000,
        archiveFormat: 'csv',
        notifyEmail: ''
      }

      const entityConfig = metadata.archival || {}

      return createResponse({
        master: entity,
        displayName: metadata.displayName,
        recordCount: metadata.recordCount || 0,
        globalDefaults: globalArchival,
        entityConfig,
        effectiveConfig: {
          enabled: entityConfig.enabled !== undefined ? entityConfig.enabled : false,
          threshold: entityConfig.threshold || globalArchival.defaultThreshold,
          retentionDays: entityConfig.retentionDays || globalArchival.defaultRetentionDays,
          keepLatest: entityConfig.keepLatest || globalArchival.defaultKeepLatest,
          archiveFormat: entityConfig.archiveFormat || globalArchival.archiveFormat,
          notifyEmail: entityConfig.notifyEmail || globalArchival.notifyEmail,
          lastArchiveAt: entityConfig.lastArchiveAt || null,
          totalArchived: entityConfig.totalArchived || 0
        }
      })
    }

    // POST: Update archival config for this master
    const { archival } = params
    if (!archival) return createErrorResponse('Missing archival configuration object')

    // Validate config
    const errors = []
    if (archival.threshold !== undefined && (archival.threshold < 100 || archival.threshold > 10000000)) {
      errors.push('threshold must be between 100 and 10,000,000')
    }
    if (archival.retentionDays !== undefined && (archival.retentionDays < 1 || archival.retentionDays > 3650)) {
      errors.push('retentionDays must be between 1 and 3650')
    }
    if (archival.keepLatest !== undefined && (archival.keepLatest < 0 || archival.keepLatest > 10000000)) {
      errors.push('keepLatest must be between 0 and 10,000,000')
    }
    if (archival.keepLatest !== undefined && archival.threshold !== undefined && archival.keepLatest >= archival.threshold) {
      errors.push('keepLatest must be less than threshold')
    }
    if (archival.archiveFormat && !['csv', 'json'].includes(archival.archiveFormat)) {
      errors.push('archiveFormat must be "csv" or "json"')
    }
    if (archival.notifyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(archival.notifyEmail)) {
      errors.push('notifyEmail must be a valid email address')
    }
    if (errors.length > 0) {
      return createErrorResponse(`Validation failed: ${errors.join('; ')}`, 422)
    }

    // Merge with existing config (preserve system fields like lastArchiveAt, totalArchived)
    const env = getEnvConfig(params)
    const existingArchival = metadata.archival || {}
    const updatedArchival = {
      enabled: archival.enabled !== undefined ? archival.enabled : existingArchival.enabled,
      threshold: archival.threshold || existingArchival.threshold || 50000,
      retentionDays: archival.retentionDays || existingArchival.retentionDays || env.auditRetentionDays,
      keepLatest: archival.keepLatest || existingArchival.keepLatest || 10000,
      archiveFormat: archival.archiveFormat || existingArchival.archiveFormat || 'csv',
      notifyEmail: archival.notifyEmail !== undefined ? archival.notifyEmail : (existingArchival.notifyEmail || ''),
      lastArchiveAt: existingArchival.lastArchiveAt || null,
      totalArchived: existingArchival.totalArchived || 0
    }

    await metaCol.updateOne(
      { masterName: entity },
      { $set: { archival: updatedArchival, updatedAt: getTimezoneDate(params) } }
    )

    await createAuditLog(client, {
      masterName: entity,
      operation: 'archive-config-update',
      actor: user,
      status: 'success'
    })

    return createResponse({
      status: 'success',
      master: entity,
      archival: updatedArchival,
      message: 'Archival configuration updated successfully'
    })
  } catch (error) {
    console.error('Archive config error:', error)
    return createErrorResponse(`Failed to update archive config: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
