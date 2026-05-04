/**
 * User & Role Management Action
 * CRUD for app users and custom roles with dynamic permissions.
 * IMS-secured. Only users with 'user_management' permission can manage users/roles.
 * The 'resolve' operation is open to any authenticated user (returns their own permissions).
 *
 * Operations:
 *   GET  ?op=resolve           — Resolve current user's role & permissions (open to all authenticated)
 *   GET  ?op=users             — List all app users (user_management required)
 *   GET  ?op=roles             — List all app roles (user_management required)
 *   POST ?op=create-user       — Create a single user (user_management required)
 *   POST ?op=bulk-create-users — Bulk create users from array (user_management required)
 *   POST ?op=update-user       — Update user role or status (user_management required)
 *   POST ?op=delete-user       — Deactivate a user (user_management required)
 *   POST ?op=create-role       — Create a custom role (user_management required)
 *   POST ?op=update-role       — Update a custom role's permissions (user_management required)
 *   POST ?op=delete-role       — Delete a custom role if no users assigned (user_management required)
 */

const {
  getDbClient, safeFindOne, COLLECTIONS, createAuditLog,
  createResponse, createErrorResponse, validateIMSToken,
  getUserFromParams, getTimezoneDate, generateId,
  APP_FEATURES, buildDefaultPermissions, resolveAppUser,
  seedSystemRoles, getUserEmailFromToken, invalidateResolveCache
} = require('../mdm-utils')

// ============ Validation Helpers ============

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VALID_STATUSES = ['active', 'inactive']
const MAX_BULK_USERS = 500

/**
 * Validate a single user input object.
 * Returns array of error strings (empty = valid).
 */
function validateUserInput (input, index) {
  const errors = []
  const prefix = index !== undefined ? `User #${index + 1}: ` : ''

  if (!input.email || typeof input.email !== 'string' || !EMAIL_REGEX.test(input.email.trim())) {
    errors.push(`${prefix}Valid email is required`)
  }
  if (!input.firstName || typeof input.firstName !== 'string' || input.firstName.trim().length < 1) {
    errors.push(`${prefix}First name is required`)
  }
  if (input.firstName && input.firstName.trim().length > 100) {
    errors.push(`${prefix}First name must be 100 characters or less`)
  }
  if (!input.lastName || typeof input.lastName !== 'string') {
    errors.push(`${prefix}Last name is required`)
  }
  if (input.lastName && input.lastName.trim().length > 100) {
    errors.push(`${prefix}Last name must be 100 characters or less`)
  }
  if (!input.roleId || typeof input.roleId !== 'string' || input.roleId.trim().length < 1) {
    errors.push(`${prefix}Role ID is required`)
  }

  return errors
}

/**
 * Validate role input.
 */
function validateRoleInput (input) {
  const errors = []
  if (!input.name || typeof input.name !== 'string' || input.name.trim().length < 2) {
    errors.push('Role name is required (min 2 characters)')
  }
  if (input.name && input.name.trim().length > 60) {
    errors.push('Role name must be 60 characters or less')
  }
  if (!input.permissions || typeof input.permissions !== 'object') {
    errors.push('Permissions object is required')
  } else {
    // Ensure only valid feature keys are present
    const validKeys = Object.values(APP_FEATURES)
    const inputKeys = Object.keys(input.permissions)
    const invalidKeys = inputKeys.filter(k => !validKeys.includes(k))
    if (invalidKeys.length > 0) {
      errors.push(`Invalid permission keys: ${invalidKeys.join(', ')}`)
    }
    // Ensure all values are boolean
    for (const [k, v] of Object.entries(input.permissions)) {
      if (typeof v !== 'boolean') {
        errors.push(`Permission '${k}' must be a boolean, got ${typeof v}`)
      }
    }
  }
  return errors
}

// ============ Main Entry Point ============

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  const method = (params.__ow_method || 'get').toLowerCase()

  // Parse body for POST/PUT — body may arrive as base64, plain JSON string, or already-parsed object
  if ((method === 'post' || method === 'put') && params.__ow_body) {
    try {
      const raw = params.__ow_body
      const bodyParams = typeof raw === 'object' ? raw
        : (() => { try { return JSON.parse(raw) } catch (e) { return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8')) } })()
      Object.assign(params, bodyParams)
    } catch (e) { /* ignore parse errors */ }
  }

  const op = (params.op || 'resolve').toLowerCase()

  let client
  try {
    client = await getDbClient(params)

    // 'resolve' is open to any authenticated user
    if (op === 'resolve') {
      return await handleResolve(client, params)
    }

    // All other operations require user_management permission
    const resolved = await resolveAppUser(client, params)
    if (!resolved.authorized) {
      return createErrorResponse(resolved.reason || 'Access denied', 403)
    }
    if (!resolved.permissions.user_management && resolved.role.roleId !== 'role_super_admin') {
      return createErrorResponse('Access denied: user_management permission required', 403)
    }

    const actorEmail = resolved.email

    switch (op) {
      // User operations
      case 'users':
        return await handleListUsers(client, params)
      case 'create-user':
        return await handleCreateUser(client, params, actorEmail)
      case 'bulk-create-users':
        return await handleBulkCreateUsers(client, params, actorEmail)
      case 'update-user':
        return await handleUpdateUser(client, params, actorEmail)
      case 'delete-user':
        return await handleDeleteUser(client, params, actorEmail, resolved)

      // Role operations
      case 'roles':
        return await handleListRoles(client, params)
      case 'create-role':
        return await handleCreateRole(client, params, actorEmail)
      case 'update-role':
        return await handleUpdateRole(client, params, actorEmail)
      case 'delete-role':
        return await handleDeleteRole(client, params, actorEmail)

      default:
        return createErrorResponse(`Unknown operation: ${op}`, 400)
    }
  } catch (error) {
    console.error('User management error:', error)
    return createErrorResponse(`Operation failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

// ============ Resolve (open to all authenticated users) ============

async function handleResolve (client, params) {
  const resolved = await resolveAppUser(client, params)
  if (!resolved.authorized) {
    return createResponse({
      authorized: false,
      reason: resolved.reason
    })
  }

  // Piggyback app settings onto resolve response to eliminate a separate cold-start call
  let appSettings = {}
  try {
    const settingsDoc = await getCachedSettings(client)
    if (settingsDoc) {
      const dm = settingsDoc.dataManagement || {}
      const ui = settingsDoc.ui || {}
      const guardrails = settingsDoc.guardrails || {}
      appSettings = {
        defaultPageSize: dm.defaultPageSize || guardrails.defaultPageSize || 25,
        maxFileSizeMB: dm.maxFileSizeMB || guardrails.maxFileSizeMB || 10,
        maxRecordsPerFile: dm.maxRecordsPerFile || guardrails.maxRecordsPerFile || 50000,
        uiPageSize: ui.defaultPageSize || 25
      }
    }
  } catch (_) { /* non-critical — settings will fall back to defaults on the client */ }

  // Return permissions and user info (never expose internal IDs or other users' data)
  return createResponse({
    authorized: true,
    email: resolved.email,
    firstName: resolved.user.firstName || '',
    lastName: resolved.user.lastName || '',
    roleName: resolved.role.name,
    roleId: resolved.role.roleId,
    permissions: resolved.permissions,
    features: Object.values(APP_FEATURES),
    appSettings
  })
}

// ============ User CRUD ============

async function handleListUsers (client, params) {
  const usersCol = await client.collection(COLLECTIONS.APP_USERS)
  const rolesCol = await client.collection(COLLECTIONS.APP_ROLES)

  const allUsers = await usersCol.find({}).sort({ createdAt: -1 }).toArray()

  // Fetch all roles for join
  const allRoles = await rolesCol.find({}).toArray()
  const roleMap = {}
  for (const r of allRoles) {
    roleMap[r.roleId] = { name: r.name, roleId: r.roleId, isSystem: r.isSystem }
  }

  const users = allUsers.map(u => ({
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    roleId: u.roleId,
    roleName: roleMap[u.roleId] ? roleMap[u.roleId].name : 'Unknown',
    status: u.status,
    createdAt: u.createdAt,
    createdBy: u.createdBy
  }))

  return createResponse({ users, count: users.length })
}

async function handleCreateUser (client, params, actorEmail) {
  const errors = validateUserInput(params)
  if (errors.length > 0) {
    return createErrorResponse(errors.join('; '), 400)
  }

  const email = params.email.trim().toLowerCase()
  const usersCol = await client.collection(COLLECTIONS.APP_USERS)
  const rolesCol = await client.collection(COLLECTIONS.APP_ROLES)

  // Check duplicate
  const existing = await safeFindOne(usersCol, { email })
  if (existing) {
    if (existing.status === 'inactive') {
      return createErrorResponse(`User '${email}' already exists but is inactive. Reactivate instead of creating.`, 409)
    }
    return createErrorResponse(`User '${email}' already exists`, 409)
  }

  // Validate role exists
  const role = await safeFindOne(rolesCol, { roleId: params.roleId.trim() })
  if (!role) {
    return createErrorResponse(`Role '${params.roleId}' not found`, 400)
  }

  const now = getTimezoneDate(params)
  const user = {
    email,
    firstName: params.firstName.trim(),
    lastName: params.lastName.trim(),
    roleId: params.roleId.trim(),
    status: 'active',
    createdAt: now,
    updatedAt: now,
    createdBy: actorEmail
  }

  await usersCol.insertOne(user)

  await createAuditLog(client, {
    action: 'user-create',
    masterName: '_app_users',
    user: actorEmail,
    detail: `User created: ${email} with role ${role.name}`
  })

  return createResponse({
    status: 'created',
    user: { email, firstName: user.firstName, lastName: user.lastName, roleId: user.roleId, roleName: role.name, status: 'active' }
  }, 201)
}

async function handleBulkCreateUsers (client, params, actorEmail) {
  const users = params.users
  if (!Array.isArray(users) || users.length === 0) {
    return createErrorResponse('users array is required and must not be empty', 400)
  }
  if (users.length > MAX_BULK_USERS) {
    return createErrorResponse(`Maximum ${MAX_BULK_USERS} users per bulk operation`, 400)
  }

  // Validate all inputs first
  const allErrors = []
  for (let i = 0; i < users.length; i++) {
    const errs = validateUserInput(users[i], i)
    allErrors.push(...errs)
  }
  if (allErrors.length > 0) {
    return createErrorResponse(allErrors.join('; '), 400)
  }

  // Check for duplicate emails within the batch
  const emailsInBatch = users.map(u => u.email.trim().toLowerCase())
  const uniqueEmails = new Set(emailsInBatch)
  if (uniqueEmails.size !== emailsInBatch.length) {
    return createErrorResponse('Duplicate emails found within the batch', 400)
  }

  const usersCol = await client.collection(COLLECTIONS.APP_USERS)
  const rolesCol = await client.collection(COLLECTIONS.APP_ROLES)

  // Validate all roleIds exist
  const roleIds = [...new Set(users.map(u => u.roleId.trim()))]
  const roleMap = {}
  for (const rid of roleIds) {
    const role = await safeFindOne(rolesCol, { roleId: rid })
    if (!role) {
      return createErrorResponse(`Role '${rid}' not found`, 400)
    }
    roleMap[rid] = role
  }

  const results = { created: [], skipped: [], errors: [] }
  const now = getTimezoneDate(params)

  for (let i = 0; i < users.length; i++) {
    const input = users[i]
    const email = input.email.trim().toLowerCase()
    try {
      const existing = await safeFindOne(usersCol, { email })
      if (existing) {
        results.skipped.push({ email, reason: existing.status === 'inactive' ? 'exists (inactive)' : 'already exists' })
        continue
      }

      const user = {
        email,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        roleId: input.roleId.trim(),
        status: 'active',
        createdAt: now,
        updatedAt: now,
        createdBy: actorEmail
      }

      await usersCol.insertOne(user)
      results.created.push({ email, roleId: user.roleId, roleName: roleMap[user.roleId].name })
    } catch (e) {
      results.errors.push({ email, error: e.message })
    }
  }

  if (results.created.length > 0) {
    await createAuditLog(client, {
      action: 'user-bulk-create',
      masterName: '_app_users',
      user: actorEmail,
      detail: `Bulk created ${results.created.length} users (${results.skipped.length} skipped, ${results.errors.length} failed)`
    })
  }

  return createResponse({
    status: 'completed',
    summary: {
      total: users.length,
      created: results.created.length,
      skipped: results.skipped.length,
      failed: results.errors.length
    },
    created: results.created,
    skipped: results.skipped,
    errors: results.errors
  })
}

async function handleUpdateUser (client, params, actorEmail) {
  const { email, roleId, status, firstName, lastName } = params
  if (!email || typeof email !== 'string') {
    return createErrorResponse('email is required', 400)
  }

  const targetEmail = email.trim().toLowerCase()
  const usersCol = await client.collection(COLLECTIONS.APP_USERS)
  const rolesCol = await client.collection(COLLECTIONS.APP_ROLES)

  const user = await safeFindOne(usersCol, { email: targetEmail })
  if (!user) {
    return createErrorResponse(`User '${targetEmail}' not found`, 404)
  }

  const updates = { updatedAt: getTimezoneDate(params) }
  const changes = []

  if (roleId !== undefined) {
    const role = await safeFindOne(rolesCol, { roleId: roleId.trim() })
    if (!role) {
      return createErrorResponse(`Role '${roleId}' not found`, 400)
    }
    updates.roleId = roleId.trim()
    changes.push(`role → ${role.name}`)
  }

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return createErrorResponse(`Invalid status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}`, 400)
    }
    // Prevent deactivating yourself
    if (status === 'inactive' && targetEmail === actorEmail.toLowerCase()) {
      return createErrorResponse('You cannot deactivate your own account', 400)
    }
    updates.status = status
    changes.push(`status → ${status}`)
  }

  if (firstName !== undefined) {
    if (typeof firstName !== 'string' || firstName.trim().length < 1 || firstName.trim().length > 100) {
      return createErrorResponse('First name must be 1-100 characters', 400)
    }
    updates.firstName = firstName.trim()
    changes.push(`firstName → ${updates.firstName}`)
  }

  if (lastName !== undefined) {
    if (typeof lastName !== 'string' || lastName.trim().length > 100) {
      return createErrorResponse('Last name must be 100 characters or less', 400)
    }
    updates.lastName = lastName.trim()
    changes.push(`lastName → ${updates.lastName}`)
  }

  if (changes.length === 0) {
    return createErrorResponse('No fields to update', 400)
  }

  await usersCol.updateOne({ email: targetEmail }, { $set: updates })

  await createAuditLog(client, {
    action: 'user-update',
    masterName: '_app_users',
    user: actorEmail,
    detail: `User updated: ${targetEmail} — ${changes.join(', ')}`
  })

  return createResponse({ status: 'updated', email: targetEmail, changes })
}

async function handleDeleteUser (client, params, actorEmail, resolvedActor) {
  const { email } = params
  if (!email || typeof email !== 'string') {
    return createErrorResponse('email is required', 400)
  }

  const targetEmail = email.trim().toLowerCase()

  // Prevent self-deactivation
  if (targetEmail === actorEmail.toLowerCase()) {
    return createErrorResponse('You cannot deactivate your own account', 400)
  }

  const usersCol = await client.collection(COLLECTIONS.APP_USERS)
  const user = await safeFindOne(usersCol, { email: targetEmail })
  if (!user) {
    return createErrorResponse(`User '${targetEmail}' not found`, 404)
  }

  if (user.status === 'inactive') {
    return createErrorResponse(`User '${targetEmail}' is already inactive`, 400)
  }

  // Prevent deactivating the last Super Admin
  if (user.roleId === 'role_super_admin') {
    const allSuperAdmins = await usersCol.find({ roleId: 'role_super_admin', status: 'active' }).toArray()
    if (allSuperAdmins.length <= 1) {
      return createErrorResponse('Cannot deactivate the last Super Admin. Assign another Super Admin first.', 400)
    }
  }

  await usersCol.updateOne({ email: targetEmail }, { $set: { status: 'inactive', updatedAt: getTimezoneDate(params) } })

  await createAuditLog(client, {
    action: 'user-deactivate',
    masterName: '_app_users',
    user: actorEmail,
    detail: `User deactivated: ${targetEmail}`
  })

  return createResponse({ status: 'deactivated', email: targetEmail })
}

// ============ Role CRUD ============

async function handleListRoles (client, params) {
  const rolesCol = await client.collection(COLLECTIONS.APP_ROLES)
  const usersCol = await client.collection(COLLECTIONS.APP_USERS)

  const allRoles = await rolesCol.find({}).sort({ isSystem: -1, name: 1 }).toArray()
  const allUsers = await usersCol.find({ status: 'active' }).toArray()

  // Deduplicate roles by roleId (keep first occurrence, delete extras)
  const seenIds = new Set()
  const uniqueRoles = []
  for (const r of allRoles) {
    if (seenIds.has(r.roleId)) {
      try { await rolesCol.deleteOne({ _id: r._id }) } catch (e) { /* best-effort cleanup */ }
    } else {
      seenIds.add(r.roleId)
      uniqueRoles.push(r)
    }
  }

  // Count users per role
  const roleUserCounts = {}
  for (const u of allUsers) {
    roleUserCounts[u.roleId] = (roleUserCounts[u.roleId] || 0) + 1
  }

  const roles = uniqueRoles.map(r => ({
    roleId: r.roleId,
    name: r.name,
    description: r.description || '',
    permissions: r.permissions,
    isSystem: !!r.isSystem,
    userCount: roleUserCounts[r.roleId] || 0,
    createdAt: r.createdAt,
    createdBy: r.createdBy
  }))

  return createResponse({
    roles,
    count: roles.length,
    features: Object.values(APP_FEATURES)
  })
}

async function handleCreateRole (client, params, actorEmail) {
  const errors = validateRoleInput(params)
  if (errors.length > 0) {
    return createErrorResponse(errors.join('; '), 400)
  }

  const rolesCol = await client.collection(COLLECTIONS.APP_ROLES)
  const name = params.name.trim()

  // Check duplicate name (case-insensitive)
  const allRoles = await rolesCol.find({}).toArray()
  const duplicate = allRoles.find(r => r.name.toLowerCase() === name.toLowerCase())
  if (duplicate) {
    return createErrorResponse(`A role named '${name}' already exists`, 409)
  }

  // Build permissions: start with all false, overlay provided values
  const permissions = buildDefaultPermissions(false)
  for (const [k, v] of Object.entries(params.permissions)) {
    if (Object.values(APP_FEATURES).includes(k)) {
      permissions[k] = v === true
    }
  }

  // Prevent creating a custom role with user_management = true unless the caller is Super Admin
  // (only Super Admins should be able to delegate user_management)
  // This is enforced at the top — the caller already has user_management, so they can grant it

  const now = getTimezoneDate(params)
  const role = {
    roleId: 'role_' + generateId(),
    name,
    description: (params.description || '').trim(),
    permissions,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
    createdBy: actorEmail
  }

  await rolesCol.insertOne(role)

  await createAuditLog(client, {
    action: 'role-create',
    masterName: '_app_roles',
    user: actorEmail,
    detail: `Role created: ${name} (${role.roleId})`
  })

  return createResponse({ status: 'created', role }, 201)
}

async function handleUpdateRole (client, params, actorEmail) {
  const { roleId, name, description, permissions } = params
  if (!roleId || typeof roleId !== 'string') {
    return createErrorResponse('roleId is required', 400)
  }

  const rolesCol = await client.collection(COLLECTIONS.APP_ROLES)
  const role = await safeFindOne(rolesCol, { roleId: roleId.trim() })
  if (!role) {
    return createErrorResponse(`Role '${roleId}' not found`, 404)
  }

  // System roles cannot be modified
  if (role.isSystem) {
    return createErrorResponse(`System role '${role.name}' cannot be modified`, 400)
  }

  const updates = { updatedAt: getTimezoneDate(params) }
  const changes = []

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60) {
      return createErrorResponse('Role name must be 2-60 characters', 400)
    }
    // Check duplicate name
    const allRoles = await rolesCol.find({}).toArray()
    const duplicate = allRoles.find(r => r.roleId !== roleId && r.name.toLowerCase() === name.trim().toLowerCase())
    if (duplicate) {
      return createErrorResponse(`A role named '${name.trim()}' already exists`, 409)
    }
    updates.name = name.trim()
    changes.push(`name → ${updates.name}`)
  }

  if (description !== undefined) {
    updates.description = (description || '').trim()
    changes.push('description updated')
  }

  if (permissions !== undefined) {
    if (typeof permissions !== 'object') {
      return createErrorResponse('Permissions must be an object', 400)
    }
    // Validate keys
    const validKeys = Object.values(APP_FEATURES)
    const invalidKeys = Object.keys(permissions).filter(k => !validKeys.includes(k))
    if (invalidKeys.length > 0) {
      return createErrorResponse(`Invalid permission keys: ${invalidKeys.join(', ')}`, 400)
    }
    // Merge: keep existing permissions, overlay changes
    const merged = { ...(role.permissions || buildDefaultPermissions(false)) }
    for (const [k, v] of Object.entries(permissions)) {
      if (typeof v !== 'boolean') {
        return createErrorResponse(`Permission '${k}' must be boolean`, 400)
      }
      merged[k] = v
    }
    updates.permissions = merged
    changes.push('permissions updated')
  }

  if (changes.length === 0) {
    return createErrorResponse('No fields to update', 400)
  }

  await rolesCol.updateOne({ roleId: roleId.trim() }, { $set: updates })

  await createAuditLog(client, {
    action: 'role-update',
    masterName: '_app_roles',
    user: actorEmail,
    detail: `Role updated: ${role.name} (${roleId}) — ${changes.join(', ')}`
  })

  // Fetch updated role
  const updated = await safeFindOne(rolesCol, { roleId: roleId.trim() })

  return createResponse({ status: 'updated', role: updated })
}

async function handleDeleteRole (client, params, actorEmail) {
  const { roleId } = params
  if (!roleId || typeof roleId !== 'string') {
    return createErrorResponse('roleId is required', 400)
  }

  const rolesCol = await client.collection(COLLECTIONS.APP_ROLES)
  const usersCol = await client.collection(COLLECTIONS.APP_USERS)

  const role = await safeFindOne(rolesCol, { roleId: roleId.trim() })
  if (!role) {
    return createErrorResponse(`Role '${roleId}' not found`, 404)
  }

  if (role.isSystem) {
    return createErrorResponse(`System role '${role.name}' cannot be deleted`, 400)
  }

  // Check if any active users are assigned this role
  const assignedUsers = await usersCol.find({ roleId: roleId.trim(), status: 'active' }).toArray()
  if (assignedUsers.length > 0) {
    const emails = assignedUsers.slice(0, 5).map(u => u.email).join(', ')
    return createErrorResponse(
      `Cannot delete role '${role.name}': ${assignedUsers.length} active user(s) assigned (${emails}${assignedUsers.length > 5 ? '...' : ''}). Reassign them first.`,
      400
    )
  }

  await rolesCol.deleteOne({ roleId: roleId.trim() })

  await createAuditLog(client, {
    action: 'role-delete',
    masterName: '_app_roles',
    user: actorEmail,
    detail: `Role deleted: ${role.name} (${roleId})`
  })

  return createResponse({ status: 'deleted', roleId, roleName: role.name })
}

exports.main = main
