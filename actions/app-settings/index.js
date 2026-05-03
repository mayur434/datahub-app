/**
 * MDM App Settings Action
 * Manages all application-level settings stored in the 'settings' collection.
 * Supports GET (read all settings) and POST (update settings).
 */

const { getDbClient, safeFindOne, COLLECTIONS, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams, getEnvConfig, invalidateSettingsCache, getTimezoneDate, registerUserSession, deregisterUserSession } = require('../mdm-utils')

const SETTINGS_DOC_ID = 'app-settings'

/**
 * Build default settings from environment config.
 * Env vars provide the baseline; user overrides are stored in DB and deep-merged on read.
 */
function buildDefaultSettings (env) {
  return {
    general: {
      appName: 'AEM MDM Console',
      environment: 'production',
      defaultVisibility: 'private',
      defaultCrudEnabled: true,
      masterNamePattern: '^[a-z][a-z0-9_]*$',
      timezone: env.appTimezone
    },
    guardrails: {
      maxStorageMB: env.mdmMaxStorageMB,
      maxFileSizeMB: 10
    },
    dataManagement: {
      maxRecordsPerFile: 50000,
      maxFileSizeMB: 10,
      allowedFileTypes: ['csv'],
      primaryKeyRequired: true,
      autoGenerateSchema: true,
      defaultFieldType: 'string',
      maxSchemaFields: env.maxSchemaFields,
      maxMasterNameLength: 60
    },
    api: {
      defaultPageSize: env.defaultPageSize,
      maxPageSize: env.maxPageSize,
      rateLimitPerMinute: env.rateLimitPerMinute,
      enableCORS: true,
      corsOrigins: '*',
      requireAuthForPublic: false,
      apiMeshCacheTTL: env.apiMeshCacheTTL,
      enableFieldSelection: true,
      enableSorting: true,
      enableFiltering: true
    },
    audit: {
      enabled: true,
      retentionDays: env.auditRetentionDays,
      cleanupSchedule: '0 2 * * *',
      archiveRetentionDays: env.archiveRetentionDays,
      logReadOperations: false,
      logLevel: 'operations',
      alertOnFailure: false,
      alertThreshold: 10,
      includePayloadInLog: false,
      maxPayloadLogSize: 1024
    },
    security: {
      requireIMSAuth: true,
      allowS2SAuth: true,
      tokenValidation: 'strict',
      enableIPWhitelist: false,
      ipWhitelist: [],
      sessionTimeout: 3600,
      maxLoginAttempts: 5
    },
    ui: {
      theme: 'auto',
      defaultPageSize: env.defaultPageSize,
      showSystemEntities: false,
      enableExport: true,
      enableBulkOperations: true,
      dateFormat: 'YYYY-MM-DD HH:mm:ss',
      maxInlineEditFields: 20
    },
    notifications: {
      enabled: false,
      channels: ['ui'],
      notifyOnUpload: true,
      notifyOnDelete: true,
      notifyOnSchemaChange: true,
      notifyOnError: true,
      webhookUrl: '',
      webhookSecret: ''
    },
    performance: {
      dbRegion: env.dbRegion,
      connectionPoolSize: 10,
      queryTimeout: env.queryTimeout,
      enableIndexing: true,
      bulkBatchSize: env.bulkBatchSize
    },
    archival: {
      enabled: true,
      defaultThreshold: 50000,
      defaultRetentionDays: env.auditRetentionDays,
      defaultKeepLatest: 10000,
      archiveFormat: 'csv',
      notifyEmail: '',
      scheduleTime: '0 3 * * *',
      maxArchiveSizeMB: 50,
      compressArchives: false,
      autoCleanupExpired: true
    }
  }
}

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  const method = (params.__ow_method || 'get').toLowerCase()
  const env = getEnvConfig(params)
  const DEFAULT_SETTINGS = buildDefaultSettings(env)

  let client
  try {
    client = await getDbClient(params)
    const user = await getUserFromParams(params, client)
    const settingsCol = await client.collection(COLLECTIONS.SETTINGS)

    // Session management operations
    if (method === 'post' && params.sessionOperation) {
      if (params.sessionOperation === 'register') {
        const session = await registerUserSession(client, params)
        return createResponse({ status: 'success', message: 'Session registered', user: session })
      } else if (params.sessionOperation === 'deregister') {
        await deregisterUserSession(client, params)
        return createResponse({ status: 'success', message: 'Session deregistered' })
      }
    }

    if (method === 'get') {
      return await handleGet(settingsCol, DEFAULT_SETTINGS)
    } else if (method === 'post') {
      return await handleUpdate(client, settingsCol, params, user, DEFAULT_SETTINGS)
    } else {
      return createErrorResponse(`Unsupported method: ${method}`)
    }
  } catch (error) {
    console.error('App settings error:', error)
    return createErrorResponse(`Settings operation failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

async function handleGet (settingsCol, DEFAULT_SETTINGS) {
  const settings = await safeFindOne(settingsCol, { settingsId: SETTINGS_DOC_ID })
  if (!settings) {
    return createResponse({ settings: DEFAULT_SETTINGS, isDefault: true })
  }
  const { _id, settingsId, ...rest } = settings
  const merged = deepMerge(DEFAULT_SETTINGS, rest)

  // Enforce env-sourced infrastructure values — these ALWAYS come from .env,
  // never from saved DB settings, to prevent stale overrides.
  enforceEnvValues(merged, DEFAULT_SETTINGS)

  return createResponse({ settings: merged, isDefault: false })
}

async function handleUpdate (client, settingsCol, params, user, DEFAULT_SETTINGS) {
  const { settings } = params
  if (!settings || typeof settings !== 'object') {
    return createErrorResponse('Missing or invalid settings object')
  }

  // Validation
  const errors = validateSettings(settings)
  if (errors.length > 0) {
    return createErrorResponse(`Validation failed: ${errors.join('; ')}`)
  }

  const existing = await safeFindOne(settingsCol, { settingsId: SETTINGS_DOC_ID })

  // Deep merge: DEFAULT → existing → new settings
  const merged = deepMerge(DEFAULT_SETTINGS, existing || {}, settings)

  // Enforce env-sourced values — prevent stale DB values from persisting
  enforceEnvValues(merged, DEFAULT_SETTINGS)

  const settingsDoc = {
    ...merged,
    settingsId: SETTINGS_DOC_ID,
    updatedAt: getTimezoneDate(params),
    updatedBy: user
  }

  delete settingsDoc._id

  if (existing) {
    await settingsCol.updateOne(
      { settingsId: SETTINGS_DOC_ID },
      { $set: settingsDoc }
    )
  } else {
    await settingsCol.insertOne(settingsDoc)
  }

  // Invalidate settings read-cache so next action reads fresh settings
  await invalidateSettingsCache()

  await createAuditLog(client, {
    masterName: '_system',
    operation: 'settings-update',
    actor: user,
    status: 'success',
    sections: Object.keys(settings)
  })

  const { _id: removeId, settingsId: removeSid, ...responseSettings } = settingsDoc
  return createResponse({
    status: 'success',
    settings: responseSettings,
    message: 'Settings updated successfully'
  })
}

function validateSettings (settings) {
  const errors = []

  if (settings.guardrails) {
    const g = settings.guardrails
    // maxStorageMB is env-level only — reject if client tries to override it
    if (g.maxStorageMB !== undefined) {
      errors.push('guardrails.maxStorageMB is read-only — set via MDM_MAX_STORAGE_MB in .env')
    }
    if (g.maxFileSizeMB !== undefined && (g.maxFileSizeMB < 1 || g.maxFileSizeMB > 100)) {
      errors.push('guardrails.maxFileSizeMB must be 1–100')
    }
  }

  if (settings.dataManagement) {
    const dm = settings.dataManagement
    if (dm.maxRecordsPerFile !== undefined && (dm.maxRecordsPerFile < 1 || dm.maxRecordsPerFile > 500000)) {
      errors.push('dataManagement.maxRecordsPerFile must be 1–500000')
    }
    if (dm.maxFileSizeMB !== undefined && (dm.maxFileSizeMB < 1 || dm.maxFileSizeMB > 100)) {
      errors.push('dataManagement.maxFileSizeMB must be 1–100')
    }
    if (dm.maxSchemaFields !== undefined && (dm.maxSchemaFields < 5 || dm.maxSchemaFields > 500)) {
      errors.push('dataManagement.maxSchemaFields must be 5–500')
    }
  }

  if (settings.api) {
    const api = settings.api
    if (api.defaultPageSize !== undefined && (api.defaultPageSize < 1 || api.defaultPageSize > 100)) {
      errors.push('api.defaultPageSize must be 1–100')
    }
    if (api.maxPageSize !== undefined && (api.maxPageSize < 1 || api.maxPageSize > 1000)) {
      errors.push('api.maxPageSize must be 1–1000')
    }
    if (api.rateLimitPerMinute !== undefined && (api.rateLimitPerMinute < 10 || api.rateLimitPerMinute > 100000)) {
      errors.push('api.rateLimitPerMinute must be 10–100000')
    }
    if (api.apiMeshCacheTTL !== undefined && (api.apiMeshCacheTTL < 0 || api.apiMeshCacheTTL > 86400)) {
      errors.push('api.apiMeshCacheTTL must be 0–86400')
    }
  }

  if (settings.audit) {
    const audit = settings.audit
    if (audit.retentionDays !== undefined && (audit.retentionDays < 1 || audit.retentionDays > 730)) {
      errors.push('audit.retentionDays must be 1–730')
    }
    if (audit.alertThreshold !== undefined && (audit.alertThreshold < 1 || audit.alertThreshold > 1000)) {
      errors.push('audit.alertThreshold must be 1–1000')
    }
  }

  if (settings.security) {
    const sec = settings.security
    if (sec.sessionTimeout !== undefined && (sec.sessionTimeout < 300 || sec.sessionTimeout > 86400)) {
      errors.push('security.sessionTimeout must be 300–86400')
    }
  }

  if (settings.performance) {
    const perf = settings.performance
    if (perf.queryTimeout !== undefined && (perf.queryTimeout < 1000 || perf.queryTimeout > 120000)) {
      errors.push('performance.queryTimeout must be 1000–120000')
    }
    if (perf.bulkBatchSize !== undefined && (perf.bulkBatchSize < 100 || perf.bulkBatchSize > 10000)) {
      errors.push('performance.bulkBatchSize must be 100–10000')
    }
  }

  return errors
}

/**
 * Force env-sourced infrastructure values back into merged settings.
 * These are deployment-level configs that must NEVER be overridden by DB-saved values.
 * If .env changes, the next GET reflects the new value immediately.
 */
function enforceEnvValues (merged, defaults) {
  // guardrails — maxStorageMB is deployment-level
  if (merged.guardrails) merged.guardrails.maxStorageMB = defaults.guardrails.maxStorageMB

  // general — timezone is deployment-level
  if (merged.general) merged.general.timezone = defaults.general.timezone

  // performance — dbRegion, queryTimeout, bulkBatchSize are deployment-level
  if (merged.performance) {
    merged.performance.dbRegion = defaults.performance.dbRegion
    merged.performance.queryTimeout = defaults.performance.queryTimeout
    merged.performance.bulkBatchSize = defaults.performance.bulkBatchSize
  }

  // api — env-sourced defaults
  if (merged.api) {
    merged.api.defaultPageSize = defaults.api.defaultPageSize
    merged.api.maxPageSize = defaults.api.maxPageSize
    merged.api.rateLimitPerMinute = defaults.api.rateLimitPerMinute
    merged.api.apiMeshCacheTTL = defaults.api.apiMeshCacheTTL
  }

  // audit — retentionDays and archiveRetentionDays from env
  if (merged.audit) {
    merged.audit.retentionDays = defaults.audit.retentionDays
    merged.audit.archiveRetentionDays = defaults.audit.archiveRetentionDays
  }

  // dataManagement — maxSchemaFields from env
  if (merged.dataManagement) merged.dataManagement.maxSchemaFields = defaults.dataManagement.maxSchemaFields
}

function deepMerge (...objects) {
  const result = {}
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue
    for (const key of Object.keys(obj)) {
      if (key === '_id' || key === 'settingsId') continue
      if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        result[key] = deepMerge(result[key] || {}, obj[key])
      } else {
        result[key] = obj[key]
      }
    }
  }
  return result
}

exports.main = main
