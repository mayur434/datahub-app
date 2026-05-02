/**
 * MDM Utility Functions
 * Shared utilities for all MDM runtime actions
 *
 * Storage Architecture:
 *   - Primary DB: @adobe/aio-lib-db (MongoDB-like document database)
 *     Collections: metadata, records, versions, audit
 *   - Caching: aio-lib-state (key-value store with native TTL expiry)
 */

// Module-level timezone cache — set on first action call, reused by internal helpers
let _appTimezone = null

const { Core } = require('@adobe/aio-sdk')
const libDb = require('@adobe/aio-lib-db')
const stateLib = require('@adobe/aio-lib-state')
const crypto = require('crypto')

// ============ Database Connection ============

/**
 * Initialize aio-lib-db and return a connected client.
 * Caller MUST call client.close() in finally block.
 */
async function getDbClient (params) {
  const { generateAccessToken } = Core.AuthClient
  const token = await generateAccessToken(params)
  const region = params.DB_REGION || process.env.AIO_DB_REGION || 'apac'
  const db = await libDb.init({ token: token.access_token, region })
  const client = await db.connect()
  return client
}

/**
 * Safe findOne wrapper — aio-lib-db throws when no document is found.
 * Returns null instead of throwing "Document not found".
 */
async function safeFindOne (collection, filter) {
  try {
    return await collection.findOne(filter)
  } catch (e) {
    if (e.message && e.message.includes('Document not found')) {
      return null
    }
    throw e
  }
}

// ============ Collection Names ============
const COLLECTIONS = {
  METADATA: 'metadata',
  VERSIONS: 'versions',
  AUDIT: 'audit',
  SETTINGS: 'settings',
  ARCHIVES: 'archives',
  ROLES: 'roles',
  PARTNERS: 'partners',
  USER_SESSIONS: 'user_sessions'
}

/**
 * System collection names — these are internal app collections, not user master data.
 * Used by the admin UI to separate system collections from master data collections.
 */
const SYSTEM_COLLECTION_NAMES = Object.values(COLLECTIONS)

/**
 * Derive the per-master collection name from the master name.
 * Convention: mdm_<masterName> (e.g. mdm_products, mdm_stores).
 * Master names are validated to be lowercase alphanumeric + underscores only.
 */
function getMasterCollectionName (masterName) {
  return `mdm_${masterName}`
}

/**
 * Get a per-master collection handle from the DB client.
 */
async function getMasterCollection (client, masterName) {
  return client.collection(getMasterCollectionName(masterName))
}

// ============ RBAC Helpers ============

/**
 * Role definitions with permissions
 */
const ROLE_PERMISSIONS = {
  admin: ['*'],
  editor: ['read', 'create', 'update', 'patch', 'delete', 'bulk-update', 'delta-update', 'full-update', 'upload', 'export'],
  viewer: ['read', 'export'],
  'api-consumer': ['read']
}

/**
 * Check if user has permission for an operation.
 * Fetches user role from the roles collection, defaults to settings-configured default.
 * Returns { allowed: true/false, role: string }
 */
async function checkPermission (client, user, operation, entity) {
  try {
    const rolesCol = await client.collection(COLLECTIONS.ROLES)
    const userRole = await safeFindOne(rolesCol, { userId: user })

    let role = 'admin' // default for backwards compatibility
    if (userRole) {
      // Check entity-specific role first, then global role
      if (entity && userRole.entityRoles && userRole.entityRoles[entity]) {
        role = userRole.entityRoles[entity]
      } else {
        role = userRole.role || 'admin'
      }
    } else {
      // Check app settings for default role
      const settings = await getCachedSettings(client)
      if (settings && settings.security && settings.security.defaultRole) {
        role = settings.security.defaultRole
      }
    }

    const permissions = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.viewer
    const allowed = permissions.includes('*') || permissions.includes(operation)
    return { allowed, role }
  } catch (e) {
    // If roles collection doesn't exist yet, allow all (backwards compatible)
    return { allowed: true, role: 'admin' }
  }
}

// ============ Validation Helpers ============

/**
 * Parse CSV string into array of objects
 */
function parseCSV (csvString) {
  const lines = csvString.trim().split('\n')
  if (lines.length < 2) {
    throw new Error('CSV must have at least a header row and one data row')
  }

  const headers = parseCSVLine(lines[0])
  const records = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    if (values.length === 0 || (values.length === 1 && values[0] === '')) continue

    const record = {}
    headers.forEach((header, idx) => {
      record[header.trim()] = values[idx] !== undefined ? values[idx].trim() : ''
    })
    records.push(record)
  }

  return { headers: headers.map(h => h.trim()), records }
}

/**
 * Parse a single CSV line handling quoted fields
 */
function parseCSVLine (line) {
  const result = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

/**
 * Validate CSV data against schema metadata
 */
function validateCSV (headers, records, metadata) {
  const errors = []

  const reservedFields = ['_id', '_entity', '_version', '_createdAt', '_updatedAt', '_createdBy', '_updatedBy', '_deleted', '_status', '_public']
  const reservedConflicts = headers.filter(h => reservedFields.includes(h) && h !== '_action')
  if (reservedConflicts.length > 0) {
    errors.push(`Reserved column names found: ${reservedConflicts.join(', ')}`)
  }

  const headerSet = new Set()
  headers.forEach(h => {
    if (headerSet.has(h)) {
      errors.push(`Duplicate header: ${h}`)
    }
    headerSet.add(h)
  })

  if (metadata && metadata.schema) {
    const requiredFields = metadata.schema.filter(s => s.required).map(s => s.name)
    const missingRequired = requiredFields.filter(f => !headers.includes(f))
    if (missingRequired.length > 0) {
      errors.push(`Missing required columns: ${missingRequired.join(', ')}`)
    }

    if (metadata.primaryKey && !headers.includes(metadata.primaryKey)) {
      errors.push(`Primary key column '${metadata.primaryKey}' not found`)
    }

    if (metadata.primaryKey) {
      const pkValues = new Set()
      records.forEach((record, idx) => {
        const pk = record[metadata.primaryKey]
        if (!pk || pk === '') {
          errors.push(`Empty primary key at row ${idx + 2}`)
        } else if (pkValues.has(pk)) {
          errors.push(`Duplicate primary key '${pk}' at row ${idx + 2}`)
        }
        pkValues.add(pk)
      })
    }

    metadata.schema.forEach(field => {
      records.forEach((record, idx) => {
        const value = record[field.name]
        if (value !== undefined && value !== '') {
          if (field.type === 'number' && isNaN(Number(value))) {
            errors.push(`Invalid number '${value}' for field '${field.name}' at row ${idx + 2}`)
          }
          if (field.type === 'boolean' && !['true', 'false', '1', '0'].includes(value.toLowerCase())) {
            errors.push(`Invalid boolean '${value}' for field '${field.name}' at row ${idx + 2}`)
          }
        }
      })
    })
  }

  return errors
}

// ============ Data Validation Rules Engine ============

/**
 * Validate a single record against schema validation rules.
 * Schema fields can have optional `validation` object with:
 *   - pattern: regex string for format validation
 *   - minLength / maxLength: string length constraints
 *   - min / max: numeric range constraints
 *   - enum: array of allowed values
 *   - unique: boolean (checked externally — flagged here for reference)
 *
 * Returns array of error strings (empty = valid).
 */
function validateRecord (data, schema) {
  const errors = []

  for (const field of schema) {
    const value = data[field.name]
    const rules = field.validation || {}
    const hasValue = value !== undefined && value !== null && value !== ''

    // Required check
    if (field.required && !hasValue && value !== 0) {
      errors.push(`Field '${field.name}' is required`)
      continue
    }

    if (!hasValue) continue

    // Type validation
    if (field.type === 'number') {
      const num = Number(value)
      if (isNaN(num)) {
        errors.push(`Field '${field.name}': expected number, got '${value}'`)
        continue
      }
      if (rules.min !== undefined && num < rules.min) {
        errors.push(`Field '${field.name}': value ${num} is below minimum ${rules.min}`)
      }
      if (rules.max !== undefined && num > rules.max) {
        errors.push(`Field '${field.name}': value ${num} exceeds maximum ${rules.max}`)
      }
    }

    if (field.type === 'boolean') {
      if (!['true', 'false', '1', '0', true, false].includes(typeof value === 'string' ? value.toLowerCase() : value)) {
        errors.push(`Field '${field.name}': expected boolean, got '${value}'`)
      }
    }

    const strValue = String(value)

    // String length constraints
    if (rules.minLength !== undefined && strValue.length < rules.minLength) {
      errors.push(`Field '${field.name}': length ${strValue.length} is below minimum ${rules.minLength}`)
    }
    if (rules.maxLength !== undefined && strValue.length > rules.maxLength) {
      errors.push(`Field '${field.name}': length ${strValue.length} exceeds maximum ${rules.maxLength}`)
    }

    // Pattern validation
    if (rules.pattern) {
      try {
        const regex = new RegExp(rules.pattern)
        if (!regex.test(strValue)) {
          errors.push(`Field '${field.name}': value '${strValue}' does not match pattern '${rules.pattern}'`)
        }
      } catch (e) {
        // Invalid regex in schema — skip
      }
    }

    // Enum validation
    if (rules.enum && Array.isArray(rules.enum)) {
      if (!rules.enum.includes(strValue)) {
        errors.push(`Field '${field.name}': value '${strValue}' is not in allowed values [${rules.enum.join(', ')}]`)
      }
    }
  }

  return errors
}

// ============ Auth Helpers ============

/**
 * Rate limiter using aio-lib-state with native TTL.
 * Uses a simple counter per user with 60-second auto-expiry.
 * No DocDB reads/writes — fast key-value operations only.
 * Returns { allowed: true/false, remaining: number }
 */
async function checkRateLimit (client, user, limit) {
  if (!limit || limit <= 0) return { allowed: true, remaining: limit }

  try {
    const state = await getStateClient()
    const stateKey = `rl_${user.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const entry = await state.get(stateKey)

    let count = 1
    if (entry && entry.value) {
      count = Number(entry.value) + 1
    }

    // Write the updated count with 60-second TTL (auto-expires = sliding window)
    await state.put(stateKey, String(count), { ttl: 60 })

    const allowed = count <= limit
    return { allowed, remaining: Math.max(0, limit - count) }
  } catch (e) {
    // Rate limiting is best-effort
    return { allowed: true, remaining: limit }
  }
}

/**
 * Validate IMS token from request headers
 */
function validateIMSToken (params) {
  const authHeader = params.__ow_headers && params.__ow_headers.authorization
  if (!authHeader) {
    return { valid: false, error: 'Missing Authorization header' }
  }
  const token = authHeader.replace('Bearer ', '')
  if (!token || token.length < 10) {
    return { valid: false, error: 'Invalid token' }
  }
  return { valid: true, token }
}

/**
 * Decode a JWT payload without verification.
 * The token is already validated by the require-adobe-auth proxy.
 */
function decodeJwtPayload (token) {
  try {
    const raw = token.startsWith('Bearer ') ? token.slice(7) : token
    const parts = raw.split('.')
    if (parts.length !== 3) return null
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8')
    return JSON.parse(payload)
  } catch (e) {
    return null
  }
}

/**
 * Extract the unique IMS user_id from the request token.
 * Falls back to S2S client_id or a default.
 */
function extractUserId (params) {
  const authHeader = (params.__ow_headers || {}).authorization || ''
  if (authHeader) {
    const decoded = decodeJwtPayload(authHeader)
    if (decoded && decoded.user_id) return decoded.user_id
  }
  if (params.__ims_oauth_s2s) {
    return params.__ims_oauth_s2s.client_id || 'system'
  }
  return (params.__ow_headers || {})['x-ims-user'] || 'admin@aem'
}

/**
 * Register a user session — called on login.
 * Fetches user profile from IMS and caches it in the DB.
 */
async function registerUserSession (client, params) {
  const authHeader = (params.__ow_headers || {}).authorization || ''
  if (!authHeader) throw new Error('No authorization token available')

  const decoded = decodeJwtPayload(authHeader)
  if (!decoded || !decoded.user_id) throw new Error('Could not extract user identity from token')

  const userId = decoded.user_id

  // Fetch user profile from Adobe IMS
  const profileRes = await fetch('https://ims-na1.adobelogin.com/ims/profile/v1', {
    headers: { Authorization: authHeader }
  })

  if (!profileRes.ok) {
    const errText = await profileRes.text()
    console.warn('IMS profile fetch failed:', profileRes.status, errText)
    throw new Error('Failed to fetch user profile from IMS')
  }

  const profile = await profileRes.json()
  const sessionCol = await client.collection(COLLECTIONS.USER_SESSIONS)
  const existing = await safeFindOne(sessionCol, { userId })

  const sessionData = {
    userId,
    email: profile.email || '',
    displayName: profile.displayName || profile.name || '',
    registeredAt: getTimezoneDate(params),
    lastActiveAt: getTimezoneDate(params)
  }

  if (existing) {
    await sessionCol.updateOne({ userId }, { $set: sessionData })
  } else {
    await sessionCol.insertOne(sessionData)
  }

  return { email: sessionData.email, displayName: sessionData.displayName }
}

/**
 * Deregister a user session — called on logout.
 * Removes the cached user identity from the DB.
 */
async function deregisterUserSession (client, params) {
  const userId = extractUserId(params)
  if (userId === 'system' || userId === 'admin@aem') return { status: 'ok' }

  const sessionCol = await client.collection(COLLECTIONS.USER_SESSIONS)
  await sessionCol.deleteOne({ userId })
  return { status: 'ok' }
}

/**
 * Resolve user identity from the session cache.
 * Returns email if cached, otherwise the raw userId.
 * Must be called after DB client is created (async).
 */
async function getUserFromParams (params, client) {
  const userId = extractUserId(params)
  if (!client || userId === 'system' || userId === 'admin@aem') return userId

  try {
    const sessionCol = await client.collection(COLLECTIONS.USER_SESSIONS)
    const session = await safeFindOne(sessionCol, { userId })
    if (session && session.email) return session.email
    if (session && session.displayName) return session.displayName
  } catch (e) {
    console.warn('User identity resolution failed, using raw userId:', e.message)
  }
  return userId
}

// ============ Partner Integration Helpers ============

/**
 * Validate partner credentials for public CRUD operations.
 * Checks x-partner-id and x-partner-key headers against the partners collection.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param {object} client - DB client
 * @param {object} params - Action params (contains headers)
 * @returns {{ valid: boolean, partner?: object, error?: string }}
 */
async function validatePartner (client, params) {
  const headers = params.__ow_headers || {}
  const partnerId = headers['x-partner-id'] || headers['x-forwarded-x-partner-id']
  const partnerKey = headers['x-partner-key'] || headers['x-forwarded-x-partner-key']

  if (!partnerId || !partnerKey) {
    return { valid: false, error: 'Missing x-partner-id and/or x-partner-key headers' }
  }

  const partnersCol = await client.collection(COLLECTIONS.PARTNERS)
  const partner = await safeFindOne(partnersCol, { partnerId })

  if (!partner) {
    return { valid: false, error: 'Unknown partner ID' }
  }

  if (partner.status !== 'active') {
    return { valid: false, error: `Partner account is ${partner.status}` }
  }

  // Constant-time comparison to prevent timing attacks
  const expectedKey = partner.partnerKey
  if (!expectedKey || partnerKey.length !== expectedKey.length) {
    return { valid: false, error: 'Invalid partner key' }
  }
  const a = Buffer.from(partnerKey)
  const b = Buffer.from(expectedKey)
  if (!crypto.timingSafeEqual(a, b)) {
    return { valid: false, error: 'Invalid partner key' }
  }

  return { valid: true, partner }
}

// ============ Audit Helpers ============

/**
 * Create an audit log entry in the audit collection.
 * Supports optional field-level change tracking via `changes` property.
 */
async function createAuditLog (client, logEntry) {
  const auditCol = await client.collection(COLLECTIONS.AUDIT)
  const fullEntry = {
    timestamp: getTimezoneDate(),
    ...logEntry
  }
  await auditCol.insertOne(fullEntry)

  // Invalidate cached metrics/dashboard so next read triggers fresh computation
  await invalidateMetricsCache()

  return fullEntry
}

/**
 * Get an aio-lib-state client for cache operations.
 * State is a fast key-value store with native TTL expiry.
 */
async function getStateClient () {
  return stateLib.init()
}

/**
 * Invalidate all cached metrics (admin console + dashboard).
 * Overwrites state keys with a short 5-second TTL so:
 *   1. Users still get instant (stale) data if they load within 5s
 *   2. After 5s, cache auto-expires and next request or cron recomputes
 * Best-effort — never throws.
 */
async function invalidateMetricsCache () {
  try {
    const state = await getStateClient()

    // Read existing cached data before invalidating
    const [metricsEntry, dashboardEntry] = await Promise.all([
      state.get('metrics-cache').catch(() => null),
      state.get('dashboard-cache').catch(() => null)
    ])

    // Re-write with very short TTL (5s) + stale flag — serves as a bridge
    // until the next cron cycle or user-triggered forceRefresh recomputes
    const staleOpts = { ttl: 5 }
    if (metricsEntry && metricsEntry.value) {
      const data = JSON.parse(metricsEntry.value)
      data._stale = true
      await state.put('metrics-cache', JSON.stringify(data), staleOpts)
    } else {
      await state.delete('metrics-cache')
    }

    if (dashboardEntry && dashboardEntry.value) {
      const data = JSON.parse(dashboardEntry.value)
      data._stale = true
      await state.put('dashboard-cache', JSON.stringify(data), staleOpts)
    } else {
      await state.delete('dashboard-cache')
    }
  } catch (e) { /* best-effort */ }
}

/**
 * Get app-settings with a state-backed read cache.
 * Reads from aio-lib-state first (fast KV lookup), falls back to DocDB on miss.
 * Cached for 5 minutes — settings change rarely but are read on nearly every request.
 *
 * @param {object} client - DB client (used as fallback on cache miss)
 * @returns {object} Settings document (without _id/settingsId) or empty object
 */
const SETTINGS_CACHE_KEY = 'app-settings-cache'
const SETTINGS_CACHE_TTL = 300 // 5 minutes

async function getCachedSettings (client) {
  // Try state cache first
  try {
    const state = await getStateClient()
    const entry = await state.get(SETTINGS_CACHE_KEY)
    if (entry && entry.value) {
      return JSON.parse(entry.value)
    }
  } catch (e) { /* cache miss — fall through to DB */ }

  // Cache miss — read from DocDB
  const settingsCol = await client.collection(COLLECTIONS.SETTINGS)
  const doc = await safeFindOne(settingsCol, { settingsId: SETTINGS_DOC_ID })
  const settings = doc || {}

  // Store in state cache for next reads
  try {
    const state = await getStateClient()
    await state.put(SETTINGS_CACHE_KEY, JSON.stringify(settings), { ttl: SETTINGS_CACHE_TTL })
  } catch (e) { /* best-effort cache write */ }

  return settings
}

/**
 * Invalidate the settings read cache.
 * Called after settings are updated so the next read fetches fresh data from DB.
 */
async function invalidateSettingsCache () {
  try {
    const state = await getStateClient()
    await state.delete(SETTINGS_CACHE_KEY)
  } catch (e) { /* best-effort */ }
}

/**
 * Compute field-level changes between old and new data objects.
 * Returns array of { field, oldValue, newValue } for changed fields.
 */
function computeFieldChanges (oldData, newData) {
  if (!oldData || !newData) return []
  const changes = []
  const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)])
  for (const key of allKeys) {
    if (key.startsWith('_')) continue // skip internal fields
    const oldVal = oldData[key]
    const newVal = newData[key]
    if (String(oldVal || '') !== String(newVal || '')) {
      changes.push({ field: key, oldValue: oldVal || null, newValue: newVal || null })
    }
  }
  return changes
}

// ============ Version Helpers ============

/**
 * Create a new version document for an entity.
 * Automatically prunes old versions exceeding maxVersionsPerEntity from settings.
 */
async function createVersion (client, entity, operation, user, changeSummary, recordCount) {
  const metaCol = await client.collection(COLLECTIONS.METADATA)
  const versionCol = await client.collection(COLLECTIONS.VERSIONS)

  const metadata = await safeFindOne(metaCol, { masterName: entity })
  const currentVersion = metadata ? (parseInt((metadata.activeVersionId || 'v0').replace('v', '')) + 1) : 1
  const versionId = `v${currentVersion}`

  const versionDoc = {
    versionId,
    masterName: entity,
    operation,
    createdBy: user,
    createdAt: getTimezoneDate(),
    recordCount,
    changeSummary: changeSummary || {},
    status: 'active'
  }

  await versionCol.insertOne(versionDoc)

  // Auto-prune old versions based on settings
  try {
    const settingsDoc = await getCachedSettings(client)
    const maxVersions = settingsDoc?.versioning?.maxVersionsPerEntity || 50

    const totalVersions = await versionCol.countDocuments({ masterName: entity })
    if (totalVersions > maxVersions) {
      const toRemove = totalVersions - maxVersions
      const oldVersions = await versionCol.find({ masterName: entity })
        .sort({ createdAt: 1 })
        .limit(toRemove)
        .toArray()
      for (const old of oldVersions) {
        await versionCol.deleteOne({ versionId: old.versionId, masterName: entity })
      }
    }
  } catch (e) {
    // Version pruning is best-effort — don't fail the main operation
  }

  return versionDoc
}

// ============ Event Publishing ============

/**
 * Publish a data mutation event to the events collection for async processing.
 * Events are stored in the audit collection with type 'event' for later
 * consumption by the publish-events action or external webhooks.
 *
 * @param {object} client - DB client
 * @param {string} eventType - e.g. 'record.created', 'record.updated', 'entity.updated'
 * @param {object} payload - event payload (entity, recordId, changes, etc.)
 */
async function publishMutationEvent (client, eventType, payload) {
  try {
    const settings = await getCachedSettings(client)

    // Only publish if events are enabled in settings
    if (!settings?.notifications?.enableEventPublishing) return

    const auditCol = await client.collection(COLLECTIONS.AUDIT)
    await auditCol.insertOne({
      type: 'event',
      eventType,
      timestamp: getTimezoneDate(),
      payload,
      delivered: false
    })
  } catch (e) {
    // Event publishing is best-effort — don't fail the main operation
  }
}

// ============ Response Helpers ============

function createResponse (body, statusCode = 200) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-gw-ims-org-id, x-ow-extra-logging',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    },
    body
  }
}

function createErrorResponse (message, statusCode = 400) {
  return createResponse({ error: message }, statusCode)
}

// ============ Utility Helpers ============

function sortObject (obj) {
  return Object.keys(obj).sort().reduce((sorted, key) => {
    sorted[key] = obj[key]
    return sorted
  }, {})
}

function generateId () {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex (str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Validate master name format.
 * Must start with a letter, contain only lowercase alphanumeric + underscores.
 * No hyphens — the master name maps directly to collection name: mdm_<masterName>.
 */
function validateMasterName (name) {
  return /^[a-z][a-z0-9_]*$/.test(name) && name.length <= 60 && !SYSTEM_COLLECTION_NAMES.includes(name) && !name.startsWith('mdm_')
}

// ============ Storage Guardrails ============

const SETTINGS_DOC_ID = 'app-settings'

/**
 * Default infrastructure tier limits for Adobe App Builder DocDB.
 * Now reads from app settings (configurable by admin) with sensible fallback defaults.
 */
function getDefaultInfraLimits (params) {
  const env = params ? getEnvConfig(params) : {}
  return {
    maxStorageMB: env.mdmMaxStorageMB || 10240,
    maxDocuments: 500000,
    maxDocumentSizeKB: 512
  }
}

const AVG_DOC_SIZE_BYTES = 1024

/**
 * Check storage guardrails before a mutation that adds documents.
 * All limits are sourced from the unified guardrails settings.
 * Enforces:
 *   1. Upload file size limit (from guardrails.maxFileSizeMB)
 *   2. Per-entity record limit (from guardrails.maxRecordsPerMaster)
 *   3. Global document count limit
 *   4. Global storage (MB) limit
 *
 * @param {object} client - DB client
 * @param {object} opts
 * @param {number} opts.newDocumentCount - Number of documents to be added
 * @param {string} [opts.entity] - Entity name (for per-entity checks)
 * @param {number} [opts.currentEntityRecords] - Current record count of the entity
 * @param {number} [opts.fileSizeMB] - Size of the uploaded file in MB
 * @param {object} [opts.params] - Action params for env config
 * @returns {object} { allowed: true } or { allowed: false, reason: string, guardrail: string }
 */
async function checkStorageGuardrails (client, opts = {}) {
  try {
    const settingsDoc = await getCachedSettings(client)
    const settings = settingsDoc || {}
    const infraLimits = getDefaultInfraLimits(opts.params)
    const guardrailSettings = settings.guardrails || {}
    const maxStorageMB = infraLimits.maxStorageMB
    const maxFileSizeMB = guardrailSettings.maxFileSizeMB || 10

    // 1. Upload file size check
    if (opts.fileSizeMB && opts.fileSizeMB > maxFileSizeMB) {
      return {
        allowed: false,
        reason: `File size ${opts.fileSizeMB.toFixed(2)} MB exceeds the configured limit of ${maxFileSizeMB} MB. Reduce file size or adjust Max File Size in Settings.`,
        guardrail: 'max-file-size'
      }
    }

    // 2. Global document count check
    if (opts.newDocumentCount) {
      let totalDocs = 0
      for (const colName of Object.values(COLLECTIONS)) {
        try {
          const col = await client.collection(colName)
          totalDocs += await col.estimatedDocumentCount()
        } catch (e) { /* collection may not exist yet */ }
      }
      const projectedDocs = totalDocs + opts.newDocumentCount
      if (projectedDocs > infraLimits.maxDocuments) {
        return {
          allowed: false,
          reason: `Adding ${opts.newDocumentCount} documents would bring total to ${projectedDocs}, exceeding the limit of ${infraLimits.maxDocuments}. Archive or delete old data first.`,
          guardrail: 'max-documents'
        }
      }

      // 3. Global storage check (estimated)
      const currentBytes = totalDocs * AVG_DOC_SIZE_BYTES
      const projectedBytes = (totalDocs + opts.newDocumentCount) * AVG_DOC_SIZE_BYTES
      const projectedMB = projectedBytes / (1024 * 1024)
      if (projectedMB > maxStorageMB) {
        return {
          allowed: false,
          reason: `Projected storage ${projectedMB.toFixed(1)} MB exceeds the MDM storage limit of ${maxStorageMB} MB. Archive old data or increase MDM_MAX_STORAGE_MB in .env.`,
          guardrail: 'max-storage'
        }
      }
    }

    return { allowed: true }
  } catch (e) {
    // Guardrail checks are best-effort — don't block if check itself fails
    return { allowed: true }
  }
}

/**
 * Estimate the size of a CSV content string in MB
 */
function estimateFileSizeMB (content) {
  if (!content) return 0
  return Buffer.byteLength(content, 'utf8') / (1024 * 1024)
}

/**
 * Read environment configuration from action params (injected via app.config.yaml inputs).
 * Returns typed values with sensible fallback defaults.
 * @param {object} params - Action params (includes env vars from app.config.yaml)
 * @returns {object} Typed config values
 */
function getEnvConfig (params) {
  return {
    dbRegion: params.DB_REGION || 'apac',
    appTimezone: params.APP_TIMEZONE || 'Asia/Kolkata',
    mdmMaxStorageMB: Number(params.MDM_MAX_STORAGE_MB) || 10240,
    metricsCacheTTLMinutes: Number(params.METRICS_CACHE_TTL_MINUTES) || 30,
    defaultPageSize: Number(params.DEFAULT_PAGE_SIZE) || 25,
    maxPageSize: Number(params.MAX_PAGE_SIZE) || 100,
    rateLimitPerMinute: Number(params.RATE_LIMIT_PER_MINUTE) || 1000,
    apiMeshCacheTTL: Number(params.API_MESH_CACHE_TTL) || 3600,
    maxSchemaFields: Number(params.MAX_SCHEMA_FIELDS) || 100,
    maxVersionsPerEntity: Number(params.MAX_VERSIONS_PER_ENTITY) || 50,
    bulkBatchSize: Number(params.BULK_BATCH_SIZE) || 1000,
    queryTimeout: Number(params.QUERY_TIMEOUT) || 30000,
    auditRetentionDays: Number(params.AUDIT_RETENTION_DAYS) || 90
  }
}

/**
 * Get the current timestamp formatted for the configured app timezone.
 * Returns an ISO string localized to the app timezone.
 * @param {object} params - Action params (for APP_TIMEZONE env var)
 * @returns {string} ISO-formatted timestamp in app timezone
 */
function getTimezoneDate (params) {
  const tz = (params && params.APP_TIMEZONE) || _appTimezone || 'Asia/Kolkata'
  if (params && params.APP_TIMEZONE) _appTimezone = params.APP_TIMEZONE
  try {
    return new Date().toLocaleString('en-CA', { timeZone: tz, hour12: false }).replace(', ', 'T') + getTimezoneOffset(tz)
  } catch (e) {
    return new Date().toISOString()
  }
}

function getTimezoneOffset (tz) {
  try {
    const now = new Date()
    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: tz }))
    const diff = (tzDate - utcDate) / 60000
    const hours = Math.floor(Math.abs(diff) / 60)
    const mins = Math.abs(diff) % 60
    const sign = diff >= 0 ? '+' : '-'
    return `${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
  } catch (e) {
    return '+00:00'
  }
}

/**
 * Inject record-level audit system fields into a record's data based on master audit config.
 * Only adds fields that were enabled when the master was created.
 *
 * @param {object} data - Record data object (mutated in place)
 * @param {object} auditConfig - Master's recordAudit config: { createdAt, updatedAt, createdBy, updatedBy }
 * @param {string} actor - User or partner name performing the action
 * @param {object} params - Action params for timezone
 * @param {boolean} isCreate - Whether this is a create (vs update)
 * @returns {object} data with audit fields injected
 */
function injectRecordAuditFields (data, auditConfig, actor, params, isCreate) {
  if (!auditConfig || !auditConfig.enabled) return data
  const now = getTimezoneDate(params)

  if (isCreate) {
    if (auditConfig.createdAt) data._createdAt = now
    if (auditConfig.updatedAt) data._updatedAt = now
    if (auditConfig.createdBy) data._createdBy = actor
    if (auditConfig.updatedBy) data._updatedBy = actor
  } else {
    if (auditConfig.updatedAt) data._updatedAt = now
    if (auditConfig.updatedBy) data._updatedBy = actor
  }
  return data
}

module.exports = {
  getDbClient,
  safeFindOne,
  COLLECTIONS,
  SYSTEM_COLLECTION_NAMES,
  getMasterCollectionName,
  getMasterCollection,
  ROLE_PERMISSIONS,
  checkPermission,
  checkRateLimit,
  parseCSV,
  parseCSVLine,
  validateCSV,
  validateRecord,
  validateIMSToken,
  getUserFromParams,
  createAuditLog,
  computeFieldChanges,
  createVersion,
  publishMutationEvent,
  createResponse,
  createErrorResponse,
  sortObject,
  generateId,
  escapeRegex,
  validateMasterName,
  checkStorageGuardrails,
  estimateFileSizeMB,
  getEnvConfig,
  getStateClient,
  getCachedSettings,
  invalidateSettingsCache,
  validatePartner,
  getTimezoneDate,
  injectRecordAuditFields,
  registerUserSession,
  deregisterUserSession,
  extractUserId
}
