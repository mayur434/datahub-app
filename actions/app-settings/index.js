/**
 * MDM App Settings Action
 * Manages all application-level settings stored in the 'settings' collection.
 * Supports GET (read all settings) and POST (update settings).
 */

const { getDbClient, safeFindOne, COLLECTIONS, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams } = require('../mdm-utils')

const SETTINGS_DOC_ID = 'app-settings'

// Comprehensive default settings for the entire application
const DEFAULT_SETTINGS = {
  general: {
    appName: 'AEM MDM Console',
    environment: 'production',
    defaultVisibility: 'private',
    defaultCrudEnabled: true,
    entityNamePattern: '^[a-z][a-z0-9-]*$',
    timezone: 'UTC'
  },
  dataManagement: {
    maxRecordsPerFile: 50000,
    maxFileSizeMB: 10,
    allowedFileTypes: ['csv'],
    primaryKeyRequired: true,
    autoGenerateSchema: true,
    defaultFieldType: 'string',
    maxSchemaFields: 100,
    maxEntityNameLength: 50
  },
  api: {
    defaultPageSize: 25,
    maxPageSize: 100,
    rateLimitPerMinute: 1000,
    enableCORS: true,
    corsOrigins: '*',
    requireAuthForPublic: false,
    apiMeshCacheTTL: 300,
    enableFieldSelection: true,
    enableSorting: true,
    enableFiltering: true
  },
  versioning: {
    enabled: true,
    retentionPolicy: 'last-10-versions',
    maxVersionsPerEntity: 50,
    autoVersionOnUpload: true,
    enableRollback: true
  },
  audit: {
    enabled: true,
    retentionDays: 90,
    cleanupEnabled: false,
    cleanupSchedule: '0 2 * * *',
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
    defaultPageSize: 25,
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
    dbRegion: 'apac',
    connectionPoolSize: 10,
    queryTimeout: 30000,
    enableIndexing: true,
    bulkBatchSize: 1000
  },
  archival: {
    enabled: true,
    defaultThreshold: 50000,
    defaultRetentionDays: 90,
    defaultKeepLatest: 10000,
    archiveFormat: 'csv',
    notifyEmail: '',
    scheduleTime: '0 3 * * *',
    maxArchiveSizeMB: 50,
    compressArchives: false,
    autoCleanupExpired: true
  }
}

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  const user = getUserFromParams(params)
  const method = (params.__ow_method || 'get').toLowerCase()

  let client
  try {
    client = await getDbClient(params)
    const settingsCol = await client.collection(COLLECTIONS.SETTINGS)

    if (method === 'get') {
      return await handleGet(settingsCol)
    } else if (method === 'post') {
      return await handleUpdate(client, settingsCol, params, user)
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

async function handleGet (settingsCol) {
  const settings = await safeFindOne(settingsCol, { settingsId: SETTINGS_DOC_ID })
  if (!settings) {
    return createResponse({ settings: DEFAULT_SETTINGS, isDefault: true })
  }
  const { _id, settingsId, ...rest } = settings
  return createResponse({ settings: deepMerge(DEFAULT_SETTINGS, rest), isDefault: false })
}

async function handleUpdate (client, settingsCol, params, user) {
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
  const settingsDoc = {
    ...merged,
    settingsId: SETTINGS_DOC_ID,
    updatedAt: new Date().toISOString(),
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

  await createAuditLog(client, {
    entityName: '_system',
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

  if (settings.dataManagement) {
    const dm = settings.dataManagement
    if (dm.maxRecordsPerFile !== undefined && (dm.maxRecordsPerFile < 100 || dm.maxRecordsPerFile > 500000)) {
      errors.push('dataManagement.maxRecordsPerFile must be 100–500000')
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

  if (settings.versioning) {
    const v = settings.versioning
    if (v.maxVersionsPerEntity !== undefined && (v.maxVersionsPerEntity < 1 || v.maxVersionsPerEntity > 500)) {
      errors.push('versioning.maxVersionsPerEntity must be 1–500')
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
