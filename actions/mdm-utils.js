/**
 * MDM Utility Functions
 * Shared utilities for all MDM runtime actions
 *
 * Storage Architecture:
 *   - Primary DB: @adobe/aio-lib-db (MongoDB-like document database)
 *     Collections: metadata, records, audit
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
 * Module-level DB connection cache for warm container reuse.
 * On cold start: checks aio-lib-state for cached IMS token first (~0.2s),
 *   falls back to full generateAccessToken (~1-2s) if not found.
 * On warm start: reuses cached connection (~0ms).
 * Token is refreshed 60s before expiry to avoid mid-request failures.
 * Dedup: concurrent callers share a single in-flight connection promise.
 */
let _cachedDbClient = null
let _cachedTokenExpiresAt = 0
let _pendingDbConnect = null
const DB_TOKEN_CACHE_KEY = 'db-access-token'

async function getDbClient (params) {
  const _t0 = Date.now()
  const env = getEnvConfig(params)
  const TOKEN_REFRESH_MARGIN_MS = env.dbTokenRefreshMarginSeconds * 1000
  const now = Date.now()
  // Reuse cached client if token is still valid (with safety margin)
  if (_cachedDbClient && now < _cachedTokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
    console.log(`⏱ [getDbClient] WARM cache hit: ${Date.now() - _t0}ms`)
    return _cachedDbClient
  }

  // Dedup: if another call is already establishing a connection, piggyback on it
  if (_pendingDbConnect) {
    console.log(`⏱ [getDbClient] piggyback on pending: ${Date.now() - _t0}ms`)
    return _pendingDbConnect
  }

  _pendingDbConnect = _connectDb(params, env)
  try {
    const result = await _pendingDbConnect
    console.log(`⏱ [getDbClient] COLD connect: ${Date.now() - _t0}ms`)
    return result
  } finally {
    _pendingDbConnect = null
  }
}

/**
 * Internal: establish a fresh DB connection (token from state or IMS).
 * Only one instance runs at a time — callers dedup via _pendingDbConnect.
 */
async function _connectDb (params, env) {
  const _t0 = Date.now()
  const _ts = (label) => console.log(`⏱ [_connectDb] ${label}: ${Date.now() - _t0}ms`)
  const TOKEN_EXPIRY_DEFAULT_MS = env.dbTokenExpiryHours * 3600000
  const TOKEN_REFRESH_MARGIN_MS = env.dbTokenRefreshMarginSeconds * 1000
  const now = Date.now()

  // Close stale connection if exists
  if (_cachedDbClient) {
    try { await _cachedDbClient._realClose() } catch (e) { /* ignore */ }
    _cachedDbClient = null
  }

  // Try to get cached token from aio-lib-state (persists across cold starts)
  let token = null
  try {
    const state = await getStateClient()
    _ts('getStateClient')
    const cached = await state.get(DB_TOKEN_CACHE_KEY)
    _ts('state.get db-token')
    if (cached && cached.value) {
      const parsed = JSON.parse(cached.value)
      // Validate token hasn't expired (with configurable safety margin)
      if (parsed.access_token && parsed.expiresAt > now + TOKEN_REFRESH_MARGIN_MS) {
        token = parsed
        _ts('state token HIT')
      }
    }
  } catch (e) { /* state miss — fall through to generate */ }

  // Generate fresh token if state cache missed
  if (!token) {
    _ts('state token MISS — generating fresh')
    const { generateAccessToken } = Core.AuthClient
    const freshToken = await generateAccessToken(params)
    _ts('generateAccessToken')
    const expiresAt = now + (parseInt(freshToken.expires_in) || TOKEN_EXPIRY_DEFAULT_MS)
    token = { access_token: freshToken.access_token, expiresAt }

    // Store in state for cross-container reuse (TTL = token lifetime minus safety margin)
    try {
      const state = await getStateClient()
      const ttlSeconds = Math.floor((expiresAt - now - TOKEN_REFRESH_MARGIN_MS) / 1000)
      if (ttlSeconds > 0) {
        await state.put(DB_TOKEN_CACHE_KEY, JSON.stringify(token), { ttl: ttlSeconds })
      }
      _ts('state.put db-token')
    } catch (e) { /* best-effort cache write */ }
  }

  const region = env.dbRegion
  const db = await libDb.init({ token: token.access_token, region })
  _ts('libDb.init')
  const client = await db.connect()
  _ts('db.connect')

  // Wrap client so close() is a no-op (connection stays alive for warm reuse)
  const realClose = client.close.bind(client)
  client._realClose = realClose
  client.close = async () => { /* no-op — connection reused across warm invocations */ }

  // Cache at module level for warm container reuse
  _cachedTokenExpiresAt = token.expiresAt
  _cachedDbClient = client

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
  AUDIT: 'audit',
  AUDIT_ARCHIVES: 'audit_archives',
  SETTINGS: 'settings',
  ARCHIVES: 'archives',
  ROLES: 'roles',
  PARTNERS: 'partners',
  USER_SESSIONS: 'user_sessions',
  APP_USERS: 'app_users',
  APP_ROLES: 'app_roles',
  COUNTERS: 'counters',
  RECORD_VERSIONS: 'record_versions',
  WEBHOOKS: 'webhooks'
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
 * Legacy role definitions for data-level permissions (partner CRUD).
 */
const ROLE_PERMISSIONS = {
  admin: ['*'],
  editor: ['read', 'create', 'update', 'patch', 'delete', 'bulk-update', 'delta-update', 'full-update', 'upload', 'export'],
  viewer: ['read', 'export'],
  'api-consumer': ['read']
}

// ============ App-Level RBAC (Dynamic Roles & Permissions) ============

/**
 * All granular feature permission keys used across the app.
 * Each maps to a UI feature and one or more backend actions.
 */
const APP_FEATURES = {
  DASHBOARD: 'dashboard',
  MASTERS: 'masters',
  IMPORT_DATA: 'import_data',
  QUERY_CONSOLE: 'query_console',
  ACTIVITY_LOG: 'activity_log',
  PARTNERS: 'partners',
  ADMIN_CONSOLE: 'admin_console',
  SETTINGS: 'settings',
  RECORD_MANAGEMENT: 'record_management',
  SCHEMA_MANAGEMENT: 'schema_management',
  ARCHIVE_MANAGEMENT: 'archive_management',
  USER_MANAGEMENT: 'user_management'
}

/**
 * Permissions that imply read-access to masters list and detail.
 * Any user with at least one of these can browse masters and view records.
 */
const DATA_PERMISSIONS = [
  APP_FEATURES.MASTERS,
  APP_FEATURES.IMPORT_DATA,
  APP_FEATURES.RECORD_MANAGEMENT,
  APP_FEATURES.SCHEMA_MANAGEMENT,
  APP_FEATURES.ARCHIVE_MANAGEMENT
]

/**
 * Map backend action names → array of permitted feature keys (OR logic).
 * User needs ANY ONE of the listed permissions to access the action.
 * `null` means unrestricted (any authenticated user).
 * Actions not in this map are also unrestricted.
 */
const ACTION_FEATURE_MAP = {
  // Dashboard — standalone
  dashboard: ['dashboard'],

  // Masters — read operations shared by many workflows
  'file-list': DATA_PERMISSIONS,
  'file-detail': DATA_PERMISSIONS,

  // Masters — write operations require explicit 'masters' permission
  'file-delete': ['masters'],
  'metadata-update': ['masters'],

  // Data import
  'file-upload': ['import_data'],
  'full-update': ['import_data', 'record_management'],
  'delta-update': ['import_data', 'record_management'],
  'bulk-update': ['import_data', 'record_management'],

  // Data read (query) — accessible from masters, query console, or record management
  'query-data': ['masters', 'query_console', 'record_management'],

  // Record CRUD — specific permission
  'record-crud': ['record_management'],

  // Activity log
  'audit-list': ['activity_log'],
  'audit-cleanup': ['activity_log'],

  // Partners
  'partner-management': ['partners'],

  // Admin console
  'infra-metrics': ['admin_console'],

  // Settings — read is open to all (many pages need config); write checked inside action
  'app-settings': null,

  // Schema
  'schema-update': ['schema_management'],
  'visibility-update': ['schema_management'],

  // Archives — viewing list allowed with masters; config/run require archive_management
  'archive-list': ['archive_management', 'masters'],
  'archive-config': ['archive_management'],
  'archive-run': ['archive_management'],

  // User management
  'user-management': ['user_management'],

  // Data export (quality, duplicates, versions, rollback)
  'data-export': ['masters', 'query_console', 'record_management']
}

/**
 * Build a default permissions object with all features set to a given value.
 */
function buildDefaultPermissions (value) {
  const perms = {}
  for (const key of Object.values(APP_FEATURES)) {
    perms[key] = value
  }
  return perms
}

/**
 * System-seeded role definitions. Created on first resolve call.
 */
const SYSTEM_ROLES = [
  {
    roleId: 'role_super_admin',
    name: 'Super Admin',
    description: 'Full access to all features. Cannot be modified or deleted.',
    permissions: buildDefaultPermissions(true),
    isSystem: true
  },
  {
    roleId: 'role_viewer',
    name: 'Viewer',
    description: 'Read-only access to dashboards, masters, and query console.',
    permissions: {
      ...buildDefaultPermissions(false),
      [APP_FEATURES.DASHBOARD]: true,
      [APP_FEATURES.MASTERS]: true,
      [APP_FEATURES.QUERY_CONSOLE]: true
    },
    isSystem: true
  }
]

/**
 * Seed system roles into app_roles collection if they don't exist.
 * Uses aio-lib-state flag to avoid re-running on every request.
 * Also cleans up any duplicate roles caused by earlier race conditions.
 */
async function seedSystemRoles (client, params) {
  // Fast path: skip if already seeded recently (1-hour TTL)
  try {
    const state = await getStateClient()
    const seeded = await state.get('system-roles-seeded')
    if (seeded && seeded.value === 'true') return
  } catch (e) { /* fall through and check DB */ }

  const rolesCol = await client.collection(COLLECTIONS.APP_ROLES)

  // Fetch ALL existing roles in one call to avoid per-role race conditions
  let existingRoles = []
  try {
    existingRoles = await rolesCol.find({}).toArray()
  } catch (e) { /* collection may not exist yet */ }

  // Clean up duplicates: keep the first occurrence of each roleId, delete the rest
  const seen = new Set()
  for (const role of existingRoles) {
    if (seen.has(role.roleId)) {
      try { await rolesCol.deleteOne({ _id: role._id }) } catch (e) { /* best-effort */ }
    } else {
      seen.add(role.roleId)
    }
  }

  // Insert any missing system roles
  for (const role of SYSTEM_ROLES) {
    if (!seen.has(role.roleId)) {
      const now = getTimezoneDate(params)
      await rolesCol.insertOne({ ...role, createdAt: now, updatedAt: now, createdBy: 'system' })
    }
  }

  // Set flag so subsequent calls skip DB check for 1 hour
  try {
    const state = await getStateClient()
    await state.put('system-roles-seeded', 'true', { ttl: _envConfigCache.rolesSeedCacheTTLSeconds })
  } catch (e) { /* best-effort */ }
}

/**
 * Resolve the current user's app-level role and permissions.
 * Called on every app load and before each action via enforceAppPermission.
 *
 * Uses aio-lib-state cache (2-minute TTL) to avoid 5+ DB calls on every request.
 * Cache is keyed by IMS user_id. Invalidated on user/role mutations.
 *
 * Flow:
 * 1. Check state cache for resolved user (fast path)
 * 2. Extract email from IMS token (via user_sessions cache)
 * 3. Look up app_users by email
 * 4. If app_users is empty AND email matches INITIAL_ADMIN_EMAIL → bootstrap first admin
 * 5. If user not found → return { authorized: false }
 * 6. If user found → fetch their role from app_roles → return permissions
 *
 * @returns {{ authorized, email, user, role, permissions }}
 */
async function resolveAppUser (client, params) {
  const _t0 = Date.now()
  const _ts = (label) => console.log(`⏱ [resolveAppUser] ${label}: ${Date.now() - _t0}ms`)
  const userId = extractUserId(params)

  // 1. Fast path: check state cache
  if (userId && userId !== 'system' && userId !== 'admin@aem') {
    try {
      const state = await getStateClient()
      const cached = await state.get(`resolve_${userId}`)
      _ts('state cache check')
      if (cached && cached.value) {
        _ts('CACHE HIT — returning cached resolve')
        return JSON.parse(cached.value)
      }
    } catch (e) { /* cache miss — fall through */ }
  }
  _ts('cache miss — full resolve')

  // 2. Get user email + seed system roles in parallel (independent operations)
  const [email] = await Promise.all([
    getUserEmailFromToken(params, client),
    seedSystemRoles(client, params)
  ])
  _ts('getUserEmailFromToken+seedSystemRoles')
  if (!email) {
    return { authorized: false, reason: 'Could not resolve user email from token' }
  }

  // 3. Get collection handles in parallel
  const [usersCol, rolesCol] = await Promise.all([
    client.collection(COLLECTIONS.APP_USERS),
    client.collection(COLLECTIONS.APP_ROLES)
  ])
  _ts('collection handles')

  // 4. Try direct user lookup first (common path — skips expensive countDocuments)
  const appUser = await safeFindOne(usersCol, { email: email.toLowerCase() })
  _ts('findOne user')

  if (appUser) {
    // User found — fast path
    if (appUser.status !== 'active') {
      return { authorized: false, reason: 'Your account has been deactivated. Contact an administrator.' }
    }

    const appRole = await safeFindOne(rolesCol, { roleId: appUser.roleId })
    if (!appRole) {
      return { authorized: false, reason: `Role '${appUser.roleId}' not found. Contact an administrator.` }
    }

    const result = {
      authorized: true,
      email: appUser.email,
      user: appUser,
      role: appRole,
      permissions: appRole.permissions || {}
    }

    // Cache for subsequent calls (fire-and-forget)
    cacheResolveResult(userId, result).catch(() => {})
    return result
  }

  // 5. User not found — check if this is a bootstrap scenario (no users at all)
  let totalUsers = 0
  try {
    totalUsers = await usersCol.countDocuments({ status: 'active' })
  } catch (e) { /* collection may not exist */ }

  if (totalUsers === 0) {
    const initialAdminEmail = (params.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase()
    if (!initialAdminEmail) {
      return { authorized: false, reason: 'No users configured. Set INITIAL_ADMIN_EMAIL in .env and redeploy.' }
    }
    if (email.toLowerCase() === initialAdminEmail) {
      // Auto-create first admin
      const now = getTimezoneDate(params)
      await usersCol.insertOne({
        email: initialAdminEmail,
        firstName: 'Admin',
        lastName: '',
        roleId: 'role_super_admin',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        createdBy: 'system-bootstrap'
      })
      await createAuditLog(client, {
        action: 'user-bootstrap',
        masterName: '_app_users',
        user: 'system',
        detail: `Initial admin bootstrapped: ${initialAdminEmail}`
      })
      const result = {
        authorized: true,
        email: initialAdminEmail,
        user: { email: initialAdminEmail, firstName: 'Admin', lastName: '', roleId: 'role_super_admin', status: 'active' },
        role: SYSTEM_ROLES[0],
        permissions: SYSTEM_ROLES[0].permissions
      }
      await cacheResolveResult(userId, result)
      return result
    } else {
      return { authorized: false, reason: 'No users configured and your email does not match the initial admin.' }
    }
  }

  // User not found but other users exist
  return { authorized: false, reason: 'You are not registered in this application. Contact an administrator.' }
}

/**
 * Cache a resolved user result in aio-lib-state.
 * Best-effort — never throws.
 */
async function cacheResolveResult (userId, result) {
  if (!userId || userId === 'system' || userId === 'admin@aem') return
  try {
    const state = await getStateClient()
    await state.put(`resolve_${userId}`, JSON.stringify(result), { ttl: _envConfigCache.resolveCacheTTLSeconds })
  } catch (e) { /* best-effort */ }
}

/**
 * Invalidate the resolve cache for all users.
 * Called after user/role mutations so permission changes take effect immediately.
 * Since we can't enumerate state keys, we use a generation counter:
 * the cache key includes a generation number, and bumping it invalidates all old entries.
 *
 * Simpler approach: invalidate by specific userId if known, or use short TTL.
 * For now, we rely on the 2-minute TTL — mutations invalidate specific users below.
 */
async function invalidateResolveCache (userId) {
  if (!userId) return
  try {
    const state = await getStateClient()
    await state.delete(`resolve_${userId}`)
  } catch (e) { /* best-effort */ }
}

/**
 * Extract user email from IMS token.
 * Resolution order:
 *   1. user_sessions cache (fast — populated by registerUserSession on login)
 *   2. JWT `email` claim (some token types include it)
 *   3. IMS Profile API fallback (slow but reliable — caches result for future calls)
 */
async function getUserEmailFromToken (params, client) {
  const _t0 = Date.now()
  const _ts = (label) => console.log(`⏱ [getUserEmailFromToken] ${label}: ${Date.now() - _t0}ms`)
  const userId = extractUserId(params)
  if (userId === 'system' || userId === 'admin@aem') return null

  const authHeader = (params.__ow_headers || {}).authorization || ''

  // 1. Try JWT email claim first (zero I/O — instant)
  if (authHeader) {
    const decoded = decodeJwtPayload(authHeader)
    if (decoded && decoded.email) {
      _ts('JWT email claim HIT')
      return decoded.email.toLowerCase()
    }
  }
  _ts('JWT email claim MISS')

  // 2. Try session cache (DB lookup)
  try {
    const sessionCol = await client.collection(COLLECTIONS.USER_SESSIONS)
    const session = await safeFindOne(sessionCol, { userId })
    _ts('session DB lookup')
    if (session && session.email) return session.email.toLowerCase()
  } catch (e) { /* fall through */ }

  // 3. Fallback: fetch from IMS Profile API and cache for future calls
  _ts('falling back to IMS Profile API')
  if (authHeader) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const profileRes = await fetch('https://ims-na1.adobelogin.com/ims/profile/v1', {
        headers: { Authorization: authHeader },
        signal: controller.signal
      })
      clearTimeout(timeout)
      if (profileRes.ok) {
        const profile = await profileRes.json()
        if (profile.email) {
          // Cache in user_sessions so subsequent calls hit the fast path
          try {
            const sessionCol = await client.collection(COLLECTIONS.USER_SESSIONS)
            const sessionData = {
              userId,
              email: profile.email,
              displayName: profile.displayName || profile.name || '',
              registeredAt: getTimezoneDate(params),
              lastActiveAt: getTimezoneDate(params)
            }
            const existing = await safeFindOne(sessionCol, { userId })
            if (existing) {
              await sessionCol.updateOne({ userId }, { $set: sessionData })
            } else {
              await sessionCol.insertOne(sessionData)
            }
          } catch (cacheErr) { /* best-effort session cache */ }
          return profile.email.toLowerCase()
        }
      }
    } catch (e) {
      console.warn('IMS profile fallback failed:', e.message)
    }
  }

  return null
}

/**
 * Enforce app-level permission for an action.
 * Call at the top of every action handler.
 * @param {object} client - DB client
 * @param {object} params - Action params
 * @param {string} actionName - The action name (e.g. 'dashboard', 'record-crud')
 * @returns {{ allowed: true, appUser: object } | { allowed: false, response: object }}
 */
async function enforceAppPermission (client, params, actionName) {
  const requiredFeatures = ACTION_FEATURE_MAP[actionName]
  // null or undefined → unrestricted (any authenticated user)
  if (!requiredFeatures) return { allowed: true, appUser: null }

  const resolved = await resolveAppUser(client, params)
  if (!resolved.authorized) {
    return { allowed: false, response: createErrorResponse(resolved.reason || 'Access denied', 403) }
  }

  // Super Admin bypasses all checks
  if (resolved.role && resolved.role.roleId === 'role_super_admin') {
    return { allowed: true, appUser: resolved }
  }

  // Check if user has ANY of the required features (OR logic)
  const hasAny = requiredFeatures.some(f => resolved.permissions[f])
  if (!hasAny) {
    return {
      allowed: false,
      response: createErrorResponse(`Access denied: you need one of [${requiredFeatures.join(', ')}] permissions.`, 403)
    }
  }

  return { allowed: true, appUser: resolved }
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
function validateRecord (data, schema, opts = {}) {
  const errors = []
  const schemaFieldNames = new Set(schema.map(f => f.name))
  const primaryKey = opts.primaryKey || null

  // Strip unknown fields — only allow schema-defined fields and system audit fields
  const SYSTEM_AUDIT_FIELDS = ['_createdAt', '_updatedAt', '_createdBy', '_updatedBy']
  const unknownFields = Object.keys(data).filter(k => !schemaFieldNames.has(k) && !SYSTEM_AUDIT_FIELDS.includes(k))
  for (const uf of unknownFields) {
    delete data[uf]
  }

  // After stripping, check that at least one non-PK schema field has a value
  const hasAnyDataField = schema.some(f => {
    if (f.name === primaryKey) return false
    const v = data[f.name]
    return v !== undefined && v !== null && v !== ''
  })
  if (!hasAnyDataField) {
    const expectedFields = schema.filter(f => f.name !== primaryKey).map(f => f.name)
    errors.push('No valid schema fields provided. Expected fields: ' + expectedFields.join(', '))
    return errors
  }

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

    // Write the updated count with sliding-window TTL (auto-expires)
    await state.put(stateKey, String(count), { ttl: _envConfigCache.rateLimitWindowSeconds })

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

  // Check key expiry
  if (isPartnerKeyExpired(partner)) {
    return { valid: false, error: 'Partner API key has expired. Contact an administrator to rotate the key.' }
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
  // Check if auditing is enabled — skip silently to save DB space and overhead
  try {
    const settings = await getCachedSettings(client)
    if (settings?.audit?.enabled === false) return null
  } catch (e) { /* if settings read fails, still log — fail-safe */ }

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
// Module-level state client cache — avoids re-initialising stateLib on every call
let _stateClientPromise = null

async function getStateClient () {
  if (!_stateClientPromise) {
    _stateClientPromise = stateLib.init().catch(err => {
      _stateClientPromise = null // reset on failure so next call retries
      throw err
    })
  }
  return _stateClientPromise
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
    // so users still see data for 5s; then cache expires and next request
    // triggers a fresh on-demand recomputation
    const staleOpts = { ttl: _envConfigCache.metricsStaleTTLSeconds }
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
    await state.put(SETTINGS_CACHE_KEY, JSON.stringify(settings), { ttl: _envConfigCache.settingsCacheTTLSeconds })
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

// Allowed CORS origins for security hardening
const ALLOWED_ORIGINS = [
  'https://experience.adobe.com',
  'https://localhost:9080'
]

function getCorsOrigin (requestOrigin) {
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin
  }
  return ALLOWED_ORIGINS[0] // Default to experience.adobe.com
}

function createResponse (body, statusCode = 200, requestOrigin) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': getCorsOrigin(requestOrigin),
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-gw-ims-org-id, x-ow-extra-logging, x-partner-id, x-partner-key',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Vary': 'Origin'
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
    maxStorageMB: env.mdmMaxStorageMB,
    maxDocuments: env.mdmMaxDocuments,
    maxDocumentSizeKB: env.mdmMaxDocumentSizeKB
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
let _envConfigCache = null

function getEnvConfig (params) {
  // Return cached config if already parsed (env vars don't change within an invocation)
  if (_envConfigCache) return _envConfigCache

  // All values MUST come from .env → app.config.yaml → action params.
  // No fallback defaults — missing env vars surface as errors immediately.
  const required = {
    DB_REGION: params.DB_REGION,
    APP_TIMEZONE: params.APP_TIMEZONE,
    MDM_MAX_STORAGE_MB: params.MDM_MAX_STORAGE_MB,
    MDM_MAX_DOCUMENTS: params.MDM_MAX_DOCUMENTS,
    MDM_MAX_DOCUMENT_SIZE_KB: params.MDM_MAX_DOCUMENT_SIZE_KB,
    METRICS_CACHE_TTL_MINUTES: params.METRICS_CACHE_TTL_MINUTES,
    INFRA_METRICS_CACHE_TTL_MINUTES: params.INFRA_METRICS_CACHE_TTL_MINUTES,
    DEFAULT_PAGE_SIZE: params.DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE: params.MAX_PAGE_SIZE,
    RATE_LIMIT_PER_MINUTE: params.RATE_LIMIT_PER_MINUTE,
    RATE_LIMIT_WINDOW_SECONDS: params.RATE_LIMIT_WINDOW_SECONDS,
    API_MESH_CACHE_TTL: params.API_MESH_CACHE_TTL,
    MAX_SCHEMA_FIELDS: params.MAX_SCHEMA_FIELDS,
    BULK_BATCH_SIZE: params.BULK_BATCH_SIZE,
    QUERY_TIMEOUT: params.QUERY_TIMEOUT,
    DB_TOKEN_EXPIRY_HOURS: params.DB_TOKEN_EXPIRY_HOURS,
    DB_TOKEN_REFRESH_MARGIN_SECONDS: params.DB_TOKEN_REFRESH_MARGIN_SECONDS,
    RESOLVE_CACHE_TTL_SECONDS: params.RESOLVE_CACHE_TTL_SECONDS,
    SETTINGS_CACHE_TTL_SECONDS: params.SETTINGS_CACHE_TTL_SECONDS,
    ROLES_SEED_CACHE_TTL_SECONDS: params.ROLES_SEED_CACHE_TTL_SECONDS,
    METRICS_STALE_TTL_SECONDS: params.METRICS_STALE_TTL_SECONDS,
    MAX_VERSIONS_PER_RECORD: params.MAX_VERSIONS_PER_RECORD,
    AUDIT_MASTERS_CACHE_TTL_SECONDS: params.AUDIT_MASTERS_CACHE_TTL_SECONDS,
    PARTNER_KEY_EXPIRY_DAYS: params.PARTNER_KEY_EXPIRY_DAYS,
    AUDIT_RETENTION_DAYS: params.AUDIT_RETENTION_DAYS,
    ARCHIVE_RETENTION_DAYS: params.ARCHIVE_RETENTION_DAYS
  }

  const missing = Object.entries(required).filter(([, v]) => v === undefined || v === '').map(([k]) => k)
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}. Configure them in .env and redeploy.`)
  }

  _envConfigCache = {
    dbRegion: String(params.DB_REGION),
    appTimezone: String(params.APP_TIMEZONE),
    mdmMaxStorageMB: Number(params.MDM_MAX_STORAGE_MB),
    mdmMaxDocuments: Number(params.MDM_MAX_DOCUMENTS),
    mdmMaxDocumentSizeKB: Number(params.MDM_MAX_DOCUMENT_SIZE_KB),
    metricsCacheTTLMinutes: Number(params.METRICS_CACHE_TTL_MINUTES),
    infraMetricsCacheTTLMinutes: Number(params.INFRA_METRICS_CACHE_TTL_MINUTES),
    defaultPageSize: Number(params.DEFAULT_PAGE_SIZE),
    maxPageSize: Number(params.MAX_PAGE_SIZE),
    rateLimitPerMinute: Number(params.RATE_LIMIT_PER_MINUTE),
    rateLimitWindowSeconds: Number(params.RATE_LIMIT_WINDOW_SECONDS),
    apiMeshCacheTTL: Number(params.API_MESH_CACHE_TTL),
    maxSchemaFields: Number(params.MAX_SCHEMA_FIELDS),
    bulkBatchSize: Number(params.BULK_BATCH_SIZE),
    queryTimeout: Number(params.QUERY_TIMEOUT),
    dbTokenExpiryHours: Number(params.DB_TOKEN_EXPIRY_HOURS),
    dbTokenRefreshMarginSeconds: Number(params.DB_TOKEN_REFRESH_MARGIN_SECONDS),
    resolveCacheTTLSeconds: Number(params.RESOLVE_CACHE_TTL_SECONDS),
    settingsCacheTTLSeconds: Number(params.SETTINGS_CACHE_TTL_SECONDS),
    rolesSeedCacheTTLSeconds: Number(params.ROLES_SEED_CACHE_TTL_SECONDS),
    metricsStaleTTLSeconds: Number(params.METRICS_STALE_TTL_SECONDS),
    maxVersionsPerRecord: Number(params.MAX_VERSIONS_PER_RECORD),
    auditMastersCacheTTLSeconds: Number(params.AUDIT_MASTERS_CACHE_TTL_SECONDS),
    partnerKeyExpiryDays: Number(params.PARTNER_KEY_EXPIRY_DAYS),
    auditRetentionDays: Number(params.AUDIT_RETENTION_DAYS),
    archiveRetentionDays: Number(params.ARCHIVE_RETENTION_DAYS)
  }
  return _envConfigCache
}

/**
 * Get the current timestamp formatted for the configured app timezone.
 * Returns an ISO string localized to the app timezone.
 * @param {object} params - Action params (for APP_TIMEZONE env var)
 * @returns {string} ISO-formatted timestamp in app timezone
 */
function getTimezoneDate (params) {
  const tz = (params && params.APP_TIMEZONE) || _appTimezone || (_envConfigCache && _envConfigCache.appTimezone)
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

/**
 * Initialize aio-lib-files with proper credentials.
 * On deployed Runtime: __OW_API_KEY & __OW_NAMESPACE are env vars → init() with no args works.
 * On local dev (aio app dev): OW creds are injected as action params, not env vars →
 *   pass them explicitly so TVM can authenticate.
 */
async function getFilesClient () {
  const filesLib = require('@adobe/aio-lib-files')
  // Deployed Runtime: __OW_API_KEY & __OW_NAMESPACE as env vars
  // Local dev (aio app dev): AIO_runtime_auth & AIO_runtime_namespace from .env
  const owAuth = process.env.__OW_API_KEY || process.env.AIO_runtime_auth
  const owNamespace = process.env.__OW_NAMESPACE || process.env.AIO_runtime_namespace
  const source = process.env.__OW_API_KEY ? '__OW_API_KEY' : process.env.AIO_runtime_auth ? 'AIO_runtime_auth' : 'none'
  console.log(`[getFilesClient] namespace=${owNamespace || 'NONE'}, authSource=${source}`)
  if (owAuth && owNamespace) {
    return filesLib.init({ ow: { namespace: owNamespace, auth: owAuth } })
  }
  return filesLib.init()
}

/**
 * Atomic auto-increment counter using findOneAndUpdate with $inc.
 * Uses a dedicated 'counters' collection with one document per master.
 * Returns the next integer ID for the given master's primary key.
 */
async function getNextSequenceId (client, masterName, batchSize = 1) {
  const countersCol = await client.collection(COLLECTIONS.COUNTERS)
  const result = await countersCol.findOneAndUpdate(
    { _id: masterName },
    { $inc: { seq: batchSize } },
    { upsert: true, returnDocument: 'after' }
  )
  // result.value for older drivers, result for newer ones
  const doc = result.value || result
  return doc.seq
}

/**
 * Decompress gzip-compressed csvContent sent by the browser.
 * If csvCompressed flag is not set, returns csvContent as-is.
 */
function decompressCsvContent (params) {
  if (!params.csvCompressed || !params.csvContent) return params.csvContent
  const zlib = require('zlib')
  const compressed = Buffer.from(params.csvContent, 'base64')
  const decompressed = zlib.gunzipSync(compressed)
  return decompressed.toString('utf-8')
}

// ============ Record Versioning ============

/**
 * Create a versioned snapshot of a record before mutation.
 * Stores the previous state in the record_versions collection
 * with the version number, actor, timestamp, and change summary.
 *
 * @param {object} client - DB client
 * @param {string} masterName - Entity name
 * @param {string} primaryKey - Record PK
 * @param {object} previousData - Record data BEFORE the change
 * @param {string} operation - 'update' | 'patch' | 'delete' | 'status-change'
 * @param {string} actor - User who made the change
 * @param {object} params - Action params for timezone
 * @param {object} [changeSummary] - Optional { changes, newData } for diff
 * @returns {number} The version number stored
 */
async function createRecordVersion (client, masterName, primaryKey, previousData, operation, actor, params, changeSummary = {}) {
  try {
    const settings = await getCachedSettings(client)
    if (settings?.versioning?.enabled === false) return 0

    const versionsCol = await client.collection(COLLECTIONS.RECORD_VERSIONS)
    const maxVersions = settings?.versioning?.maxVersionsPerRecord || (_envConfigCache && _envConfigCache.maxVersionsPerRecord)

    // Get current version count for this record
    let existingVersions = []
    try {
      existingVersions = await versionsCol.find({
        masterName,
        primaryKey: String(primaryKey)
      }).sort({ version: -1 }).toArray()
    } catch (e) { /* collection may not exist */ }

    const nextVersion = existingVersions.length > 0 ? existingVersions[0].version + 1 : 1

    // Store version snapshot
    await versionsCol.insertOne({
      masterName,
      primaryKey: String(primaryKey),
      version: nextVersion,
      data: previousData,
      operation,
      actor,
      timestamp: getTimezoneDate(params),
      changes: changeSummary.changes || [],
      ttl: getTimezoneDate(params) // for potential future cleanup
    })

    // Prune old versions beyond maxVersionsPerRecord (FIFO)
    if (existingVersions.length >= maxVersions) {
      const toDelete = existingVersions.slice(maxVersions - 1)
      for (const old of toDelete) {
        try { await versionsCol.deleteOne({ _id: old._id }) } catch (e) { /* best-effort */ }
      }
    }

    return nextVersion
  } catch (e) {
    console.warn('Version creation failed (non-blocking):', e.message)
    return 0
  }
}

/**
 * Get version history for a record.
 * Returns versions sorted newest-first with pagination.
 */
async function getRecordVersions (client, masterName, primaryKey, opts = {}) {
  const versionsCol = await client.collection(COLLECTIONS.RECORD_VERSIONS)
  const page = opts.page || 1
  const pageSize = opts.pageSize || 20
  const skip = (page - 1) * pageSize

  const filter = { masterName, primaryKey: String(primaryKey) }
  const versions = await versionsCol.find(filter)
    .sort({ version: -1 })
    .skip(skip)
    .limit(pageSize)
    .toArray()

  let total = 0
  try { total = await versionsCol.countDocuments(filter) } catch (e) { /* best-effort */ }

  return { versions, total, page, pageSize }
}

/**
 * Rollback a record to a specific version.
 * Restores the record data from the version snapshot.
 */
async function rollbackRecord (client, masterName, primaryKey, targetVersion, actor, params) {
  const versionsCol = await client.collection(COLLECTIONS.RECORD_VERSIONS)
  const masterCol = await getMasterCollection(client, masterName)

  // Find the target version
  const versionDoc = await safeFindOne(versionsCol, {
    masterName,
    primaryKey: String(primaryKey),
    version: targetVersion
  })
  if (!versionDoc) {
    throw new Error(`Version ${targetVersion} not found for record '${primaryKey}' in '${masterName}'`)
  }

  // Get current record state (to version it before rollback)
  const current = await safeFindOne(masterCol, { primaryKey: String(primaryKey) })
  if (!current) {
    throw new Error(`Record '${primaryKey}' not found in '${masterName}'`)
  }

  // Version the current state before overwriting
  await createRecordVersion(client, masterName, primaryKey, current.data, 'rollback', actor, params, {
    changes: [{ field: '_rollback', oldValue: 'current', newValue: `v${targetVersion}` }]
  })

  // Restore the versioned data
  await masterCol.updateOne(
    { primaryKey: String(primaryKey) },
    { $set: { data: versionDoc.data, updatedBy: actor, deleted: false, status: 'active' }, $currentDate: { updatedAt: true } }
  )

  await createAuditLog(client, {
    masterName,
    operation: 'rollback-record',
    actor,
    status: 'success',
    recordId: primaryKey,
    detail: `Rolled back to version ${targetVersion}`
  })

  return { status: 'success', restoredVersion: targetVersion, data: versionDoc.data }
}

// ============ Data Quality Scoring ============

/**
 * Compute data quality score for a single record.
 * Returns a 0-100 completeness percentage and field-level breakdown.
 *
 * Scoring weights:
 *   - Required field filled: 3 points
 *   - Optional field filled: 1 point
 *   - Format valid (passes validation rules): +1 bonus point
 *
 * @param {object} data - Record data
 * @param {Array} schema - Entity schema definition
 * @returns {{ score: number, totalPoints: number, earnedPoints: number, fields: Array }}
 */
function computeRecordQuality (data, schema) {
  if (!data || !schema || schema.length === 0) return { score: 100, totalPoints: 0, earnedPoints: 0, fields: [] }

  let totalPoints = 0
  let earnedPoints = 0
  const fields = []

  for (const field of schema) {
    const weight = field.required ? 3 : 1
    const bonusWeight = (field.validation && Object.keys(field.validation).length > 0) ? 1 : 0
    const fieldTotal = weight + bonusWeight
    totalPoints += fieldTotal

    const value = data[field.name]
    const hasValue = value !== undefined && value !== null && value !== ''
    let fieldEarned = 0
    let status = 'missing'

    if (hasValue) {
      fieldEarned += weight
      status = 'filled'

      // Check validation rules for bonus points
      if (bonusWeight > 0) {
        const errors = validateRecord({ [field.name]: value }, [field])
        if (errors.length === 0) {
          fieldEarned += bonusWeight
          status = 'valid'
        } else {
          status = 'invalid-format'
        }
      }
    }

    earnedPoints += fieldEarned
    fields.push({
      name: field.name,
      required: !!field.required,
      status,
      points: fieldEarned,
      maxPoints: fieldTotal
    })
  }

  const score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 100

  return { score, totalPoints, earnedPoints, fields }
}

/**
 * Compute aggregate data quality metrics for an entity.
 * Samples records to calculate average quality score, common missing fields, etc.
 *
 * @param {object} client - DB client
 * @param {string} masterName - Entity name
 * @param {object} metadata - Entity metadata with schema
 * @param {number} [sampleSize=500] - Max records to sample
 * @returns {{ avgScore, distribution, fieldCompleteness, totalRecords, sampledRecords }}
 */
async function computeEntityQuality (client, masterName, metadata, sampleSize = 500) {
  const masterCol = await getMasterCollection(client, masterName)
  const records = await masterCol.find({ deleted: false })
    .limit(sampleSize)
    .toArray()

  if (records.length === 0) {
    return { avgScore: 0, distribution: {}, fieldCompleteness: {}, totalRecords: 0, sampledRecords: 0 }
  }

  let totalScore = 0
  const distribution = { excellent: 0, good: 0, fair: 0, poor: 0 } // 90+, 70-89, 50-69, <50
  const fieldFilled = {}
  const fieldTotal = {}

  for (const record of records) {
    const quality = computeRecordQuality(record.data, metadata.schema)
    totalScore += quality.score

    if (quality.score >= 90) distribution.excellent++
    else if (quality.score >= 70) distribution.good++
    else if (quality.score >= 50) distribution.fair++
    else distribution.poor++

    for (const f of quality.fields) {
      fieldFilled[f.name] = (fieldFilled[f.name] || 0) + (f.status !== 'missing' ? 1 : 0)
      fieldTotal[f.name] = (fieldTotal[f.name] || 0) + 1
    }
  }

  const fieldCompleteness = {}
  for (const [name, filled] of Object.entries(fieldFilled)) {
    fieldCompleteness[name] = Math.round((filled / fieldTotal[name]) * 100)
  }

  return {
    avgScore: Math.round(totalScore / records.length),
    distribution,
    fieldCompleteness,
    totalRecords: metadata.recordCount || records.length,
    sampledRecords: records.length
  }
}

// ============ Duplicate Detection ============

/**
 * Compute similarity between two strings using trigram overlap (Dice coefficient).
 * Returns a value between 0.0 (no match) and 1.0 (exact match).
 * Faster than Levenshtein for longer strings and more suitable for fuzzy matching.
 */
function computeSimilarity (str1, str2) {
  if (!str1 || !str2) return 0
  const a = String(str1).toLowerCase().trim()
  const b = String(str2).toLowerCase().trim()
  if (a === b) return 1.0
  if (a.length < 2 || b.length < 2) return 0

  const trigramsA = new Set()
  const trigramsB = new Set()
  for (let i = 0; i <= a.length - 2; i++) trigramsA.add(a.substring(i, i + 2))
  for (let i = 0; i <= b.length - 2; i++) trigramsB.add(b.substring(i, i + 2))

  let intersection = 0
  for (const t of trigramsA) {
    if (trigramsB.has(t)) intersection++
  }

  return (2 * intersection) / (trigramsA.size + trigramsB.size)
}

/**
 * Find potential duplicate records in a master.
 * Compares specified fields using trigram similarity.
 *
 * @param {object} client - DB client
 * @param {string} masterName - Entity name
 * @param {object} metadata - Entity metadata
 * @param {object} opts - { matchFields: string[], threshold: number (0-1), limit: number }
 * @returns {{ duplicates: Array<{ records: [obj, obj], similarity: number, matchedFields: string[] }> }}
 */
async function findDuplicates (client, masterName, metadata, opts = {}) {
  const masterCol = await getMasterCollection(client, masterName)
  const threshold = opts.threshold || 0.8
  const limit = opts.limit || 100
  const matchFields = opts.matchFields || metadata.schema.filter(f => f.queryable || f.required).map(f => f.name).slice(0, 3)

  if (matchFields.length === 0) return { duplicates: [], message: 'No matchable fields configured' }

  // Fetch records (limit sample size for performance within serverless constraints)
  const maxSample = Math.min(opts.sampleSize || 1000, 2000)
  const records = await masterCol.find({ deleted: false })
    .limit(maxSample)
    .toArray()

  if (records.length < 2) return { duplicates: [], sampledRecords: records.length }

  const duplicates = []
  const pk = metadata.primaryKey

  // Pairwise comparison — O(n²) but capped by sample size
  for (let i = 0; i < records.length && duplicates.length < limit; i++) {
    for (let j = i + 1; j < records.length && duplicates.length < limit; j++) {
      const a = records[i].data
      const b = records[j].data
      let totalSim = 0
      let fieldCount = 0
      const matched = []

      for (const field of matchFields) {
        const sim = computeSimilarity(a[field], b[field])
        if (sim >= threshold) {
          matched.push({ field, similarity: Math.round(sim * 100) })
        }
        totalSim += sim
        fieldCount++
      }

      const avgSim = fieldCount > 0 ? totalSim / fieldCount : 0
      if (matched.length > 0 && avgSim >= threshold) {
        duplicates.push({
          recordA: { [pk]: a[pk], ...a },
          recordB: { [pk]: b[pk], ...b },
          avgSimilarity: Math.round(avgSim * 100),
          matchedFields: matched
        })
      }
    }
  }

  return { duplicates, sampledRecords: records.length, threshold: Math.round(threshold * 100) }
}

// ============ Approval Workflow ============

/**
 * Record lifecycle statuses for approval workflow.
 * Records start as 'draft' and progress through review states.
 * Only 'approved' or 'published' records are visible via the public API.
 */
const RECORD_STATUSES = {
  DRAFT: 'draft',
  PENDING_REVIEW: 'pending_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PUBLISHED: 'published',
  ARCHIVED: 'archived'
}

/**
 * Valid status transitions. Key = current status, value = allowed next statuses.
 */
const STATUS_TRANSITIONS = {
  draft: ['pending_review', 'archived'],
  pending_review: ['approved', 'rejected', 'draft'],
  approved: ['published', 'draft', 'archived'],
  rejected: ['draft', 'archived'],
  published: ['draft', 'archived'],
  archived: ['draft']
}

/**
 * Check if a status transition is valid.
 */
function isValidStatusTransition (from, to) {
  if (!from || !to) return false
  const allowed = STATUS_TRANSITIONS[from]
  return allowed && allowed.includes(to)
}

/**
 * Transition a record's workflow status.
 * Validates the transition, creates a version snapshot, and updates the record.
 *
 * @param {object} client - DB client
 * @param {string} masterName - Entity name
 * @param {string} primaryKey - Record PK
 * @param {string} newStatus - Target status
 * @param {string} actor - User performing the transition
 * @param {object} params - Action params
 * @param {string} [comment] - Optional review comment
 * @returns {{ status, previousStatus, record }}
 */
async function transitionRecordStatus (client, masterName, primaryKey, newStatus, actor, params, comment) {
  const masterCol = await getMasterCollection(client, masterName)
  const record = await safeFindOne(masterCol, { primaryKey: String(primaryKey) })
  if (!record) throw new Error(`Record '${primaryKey}' not found`)

  const currentStatus = record.workflowStatus || RECORD_STATUSES.PUBLISHED // backwards compat

  if (!isValidStatusTransition(currentStatus, newStatus)) {
    throw new Error(`Invalid transition: ${currentStatus} → ${newStatus}. Allowed: ${(STATUS_TRANSITIONS[currentStatus] || []).join(', ')}`)
  }

  // Version the current state before status change
  await createRecordVersion(client, masterName, primaryKey, record.data, 'status-change', actor, params, {
    changes: [{ field: '_workflowStatus', oldValue: currentStatus, newValue: newStatus }]
  })

  const updateFields = {
    workflowStatus: newStatus,
    updatedBy: actor,
    [`workflow_${newStatus}_at`]: getTimezoneDate(params),
    [`workflow_${newStatus}_by`]: actor
  }
  if (comment) updateFields.workflowComment = comment

  await masterCol.updateOne(
    { primaryKey: String(primaryKey) },
    { $set: updateFields, $currentDate: { updatedAt: true } }
  )

  await createAuditLog(client, {
    masterName,
    operation: 'status-transition',
    actor,
    status: 'success',
    recordId: primaryKey,
    detail: `${currentStatus} → ${newStatus}${comment ? ': ' + comment : ''}`
  })

  return { status: newStatus, previousStatus: currentStatus }
}

// ============ Webhook Subscriptions ============

/**
 * Register a webhook subscription for a partner.
 * Partners can subscribe to specific event types for specific masters.
 *
 * @param {object} client - DB client
 * @param {object} webhookData - { partnerId, url, events: string[], masters: string[], secret }
 * @param {string} actor - User registering the webhook
 * @param {object} params - Action params
 * @returns {object} Created webhook subscription
 */
async function registerWebhook (client, webhookData, actor, params) {
  const { partnerId, url, events, masters, secret } = webhookData

  if (!partnerId || !url || !events || events.length === 0) {
    throw new Error('partnerId, url, and events[] are required for webhook registration')
  }

  // Validate URL format
  try { new URL(url) } catch (e) { throw new Error('Invalid webhook URL') }

  // Only allow HTTPS endpoints (security requirement)
  if (!url.startsWith('https://')) {
    throw new Error('Webhook URL must use HTTPS')
  }

  const webhooksCol = await client.collection(COLLECTIONS.WEBHOOKS)
  const webhookId = 'wh_' + crypto.randomBytes(8).toString('hex')
  const webhookSecret = secret || crypto.randomBytes(32).toString('hex')

  const subscription = {
    webhookId,
    partnerId,
    url,
    events, // e.g. ['record.created', 'record.updated', 'record.deleted']
    masters: masters || ['*'], // '*' = all masters
    secret: webhookSecret,
    status: 'active',
    failureCount: 0,
    lastDeliveredAt: null,
    createdAt: getTimezoneDate(params),
    createdBy: actor
  }

  await webhooksCol.insertOne(subscription)

  return { webhookId, url, events, masters: subscription.masters, status: 'active' }
}

/**
 * Dispatch webhook notifications for a data mutation event.
 * Finds all active subscriptions matching the event type and master,
 * then fires HTTP POST to each endpoint with HMAC signature.
 *
 * Delivery is best-effort within the serverless execution window.
 * Failed deliveries increment failureCount; auto-disable after 10 consecutive failures.
 *
 * @param {object} client - DB client
 * @param {string} eventType - e.g. 'record.created'
 * @param {object} payload - Event payload { master, recordId, data, actor }
 */
async function dispatchWebhooks (client, eventType, payload) {
  try {
    const settings = await getCachedSettings(client)
    if (!settings?.webhooks?.enabled) return

    const webhooksCol = await client.collection(COLLECTIONS.WEBHOOKS)
    const masterName = payload.master || payload.masterName || '*'

    // Find matching subscriptions
    const subscriptions = await webhooksCol.find({
      status: 'active',
      events: eventType
    }).toArray()

    // Filter by master match
    const matching = subscriptions.filter(s =>
      s.masters.includes('*') || s.masters.includes(masterName)
    )

    if (matching.length === 0) return

    const eventId = generateId()
    const timestamp = new Date().toISOString()

    // Fire webhooks in parallel (best-effort, 5s timeout each)
    const deliveryPromises = matching.map(async (sub) => {
      const body = JSON.stringify({
        id: eventId,
        type: eventType,
        timestamp,
        data: payload
      })

      // HMAC-SHA256 signature for payload verification
      const signature = crypto.createHmac('sha256', sub.secret).update(body).digest('hex')

      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)

        const res = await fetch(sub.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Id': sub.webhookId,
            'X-Webhook-Event': eventType,
            'X-Webhook-Signature': `sha256=${signature}`,
            'X-Webhook-Timestamp': timestamp
          },
          body,
          signal: controller.signal
        })
        clearTimeout(timeout)

        if (res.ok) {
          // Reset failure count on success
          await webhooksCol.updateOne(
            { webhookId: sub.webhookId },
            { $set: { failureCount: 0, lastDeliveredAt: timestamp, lastStatus: res.status } }
          )
        } else {
          await incrementWebhookFailure(webhooksCol, sub)
        }
      } catch (e) {
        await incrementWebhookFailure(webhooksCol, sub)
      }
    })

    await Promise.allSettled(deliveryPromises)
  } catch (e) {
    // Webhook dispatch is best-effort — never fails the main operation
    console.warn('Webhook dispatch error:', e.message)
  }
}

/**
 * Increment webhook failure count; auto-disable after threshold.
 */
async function incrementWebhookFailure (webhooksCol, sub) {
  const newCount = (sub.failureCount || 0) + 1
  const update = { failureCount: newCount, lastFailedAt: new Date().toISOString() }
  if (newCount >= 10) {
    update.status = 'disabled'
    update.disabledReason = 'Too many consecutive delivery failures'
  }
  try {
    await webhooksCol.updateOne({ webhookId: sub.webhookId }, { $set: update })
  } catch (e) { /* best-effort */ }
}

// ============ API Key Rotation & Expiry ============

/**
 * Check if a partner's API key has expired.
 * Partners can have an optional expiresAt date on their credentials.
 */
function isPartnerKeyExpired (partner) {
  if (!partner.keyExpiresAt) return false
  return new Date(partner.keyExpiresAt) < new Date()
}

/**
 * Generate a new partner key and set expiry.
 * Returns the new key (shown once) and updates the partner record.
 *
 * @param {object} partnersCol - Partners collection handle
 * @param {string} partnerId - Partner ID
 * @param {number} [expiryDays=365] - Days until the new key expires
 * @returns {{ partnerKey, expiresAt }}
 */
async function rotatePartnerKey (partnersCol, partnerId, expiryDays) {
  if (!expiryDays) expiryDays = _envConfigCache.partnerKeyExpiryDays
  const newKey = 'pk_' + crypto.randomBytes(32).toString('base64url').substring(0, 45)
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + expiryDays)

  await partnersCol.updateOne(
    { partnerId },
    { $set: { partnerKey: newKey, keyExpiresAt: expiresAt.toISOString(), keyRotatedAt: new Date().toISOString() } }
  )

  return { partnerKey: newKey, expiresAt: expiresAt.toISOString() }
}

// ============ Cross-Entity Lookups ============

/**
 * Resolve a foreign key reference to another master.
 * Used for cross-entity relationships (e.g. product.categoryId → categories).
 *
 * Schema fields can define a `reference` property:
 *   { name: 'categoryId', type: 'string', reference: { master: 'categories', field: 'categoryName' } }
 *
 * @param {object} client - DB client
 * @param {string} targetMaster - The master to look up
 * @param {string} targetPK - The primary key value in the target master
 * @param {string[]} [fields] - Specific fields to return (null = all)
 * @returns {object|null} The referenced record's data or null
 */
async function resolveReference (client, targetMaster, targetPK, fields) {
  const masterCol = await getMasterCollection(client, targetMaster)
  const record = await safeFindOne(masterCol, { primaryKey: String(targetPK), deleted: false })
  if (!record) return null

  if (fields && fields.length > 0) {
    const subset = {}
    for (const f of fields) {
      if (record.data[f] !== undefined) subset[f] = record.data[f]
    }
    return subset
  }
  return record.data
}

/**
 * Resolve all foreign key references in a record's data.
 * Iterates schema fields with `reference` definitions and hydrates them.
 *
 * @param {object} client - DB client
 * @param {object} data - Record data
 * @param {Array} schema - Entity schema
 * @returns {object} Data with _resolved map for referenced fields
 */
async function resolveRecordReferences (client, data, schema) {
  const referencedFields = schema.filter(f => f.reference && f.reference.master)
  if (referencedFields.length === 0) return data

  const resolved = {}
  const promises = referencedFields.map(async (field) => {
    const fkValue = data[field.name]
    if (!fkValue) return
    const ref = await resolveReference(
      client,
      field.reference.master,
      fkValue,
      field.reference.fields || null
    )
    if (ref) resolved[field.name] = ref
  })

  await Promise.all(promises)

  if (Object.keys(resolved).length > 0) {
    return { ...data, _resolved: resolved }
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
  publishMutationEvent,
  createResponse,
  createErrorResponse,
  sortObject,
  generateId,
  escapeRegex,
  validateMasterName,
  APP_FEATURES,
  ACTION_FEATURE_MAP,
  DATA_PERMISSIONS,
  buildDefaultPermissions,
  resolveAppUser,
  enforceAppPermission,
  invalidateResolveCache,
  seedSystemRoles,
  getUserEmailFromToken,
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
  extractUserId,
  getFilesClient,
  decompressCsvContent,
  getNextSequenceId,
  // Record Versioning
  createRecordVersion,
  getRecordVersions,
  rollbackRecord,
  // Data Quality
  computeRecordQuality,
  computeEntityQuality,
  // Duplicate Detection
  computeSimilarity,
  findDuplicates,
  // Approval Workflow
  RECORD_STATUSES,
  STATUS_TRANSITIONS,
  isValidStatusTransition,
  transitionRecordStatus,
  // Webhook Subscriptions
  registerWebhook,
  dispatchWebhooks,
  // API Key Rotation
  isPartnerKeyExpired,
  rotatePartnerKey,
  // Cross-Entity References
  resolveReference,
  resolveRecordReferences
}
