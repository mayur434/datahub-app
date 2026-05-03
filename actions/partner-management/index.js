/**
 * Partner Management Action
 * CRUD for integration partners — onboarding, credential management, status control.
 * IMS-secured (admin only). Partners are stored in the 'partners' collection.
 *
 * Operations:
 *   GET    — List all partners (or single by partnerId)
 *   POST   — Create a new partner
 *   PUT    — Update partner details (name, status, allowedMasters)
 *   DELETE — Remove a partner (soft delete)
 */

const crypto = require('crypto')
const { getDbClient, safeFindOne, COLLECTIONS, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams, getTimezoneDate, enforceAppPermission } = require('../mdm-utils')

/**
 * Generate a secure random partner key (48 chars, prefixed).
 */
function generatePartnerKey () {
  return 'pk_' + crypto.randomBytes(32).toString('base64url').substring(0, 45)
}

/**
 * Generate a short unique partner ID (12 chars).
 */
function generatePartnerId () {
  return 'ptr_' + crypto.randomBytes(6).toString('hex')
}

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  const method = (params.__ow_method || 'get').toLowerCase()

  // For PUT/DELETE, body params arrive in __ow_body (base64-encoded JSON), not merged into params
  if ((method === 'put' || method === 'delete') && params.__ow_body) {
    try {
      const bodyStr = Buffer.from(params.__ow_body, 'base64').toString('utf-8')
      const bodyParams = JSON.parse(bodyStr)
      Object.assign(params, bodyParams)
    } catch (e) { /* ignore parse errors */ }
  }

  let client
  try {
    client = await getDbClient(params)

    // App-level RBAC
    const appPerm = await enforceAppPermission(client, params, 'partner-management')
    if (!appPerm.allowed) return appPerm.response

    const user = await getUserFromParams(params, client)
    const partnersCol = await client.collection(COLLECTIONS.PARTNERS)

    switch (method) {
      case 'get':
        return await handleList(partnersCol, params)
      case 'post':
        return await handleCreate(client, partnersCol, params, user)
      case 'put':
        return await handleUpdate(client, partnersCol, params, user)
      case 'delete':
        return await handleDelete(client, partnersCol, params, user)
      default:
        return createErrorResponse(`Unsupported method: ${method}`, 405)
    }
  } catch (error) {
    console.error('Partner management error:', error)
    return createErrorResponse(`Operation failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

// ============ GET — List partners ============

async function handleList (partnersCol, params) {
  const { partnerId } = params

  if (partnerId) {
    const partner = await safeFindOne(partnersCol, { partnerId, deleted: { $ne: true } })
    if (!partner) return createErrorResponse('Partner not found', 404)
    // Never expose the key in list responses — only on create
    const { partnerKey, ...safe } = partner
    return createResponse({ partner: { ...safe, keyConfigured: !!partnerKey } })
  }

  const all = await partnersCol.find({ deleted: { $ne: true } }).sort({ createdAt: -1 }).toArray()
  // Strip keys from listing
  const partners = all.map(p => {
    const { partnerKey, ...safe } = p
    return { ...safe, keyConfigured: !!partnerKey }
  })

  return createResponse({ partners, count: partners.length })
}

// ============ POST — Create partner ============

async function handleCreate (client, partnersCol, params, user) {
  const { name, description, contactEmail } = params
  const allowedMasters = params.allowedMasters || params.allowedEntities

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return createErrorResponse('Partner name is required (min 2 characters)', 400)
  }

  if (!Array.isArray(allowedMasters) || allowedMasters.length === 0) {
    return createErrorResponse('At least one allowed master is required', 400)
  }

  // Check for duplicate name
  const existing = await safeFindOne(partnersCol, { name: name.trim(), deleted: { $ne: true } })
  if (existing) {
    return createErrorResponse(`A partner named "${name}" already exists`, 409)
  }

  const partnerId = generatePartnerId()
  const partnerKey = generatePartnerKey()
  const now = getTimezoneDate(params)

  const partner = {
    partnerId,
    partnerKey,
    name: name.trim(),
    description: (description || '').trim(),
    contactEmail: (contactEmail || '').trim(),
    allowedMasters: Array.isArray(allowedMasters) ? allowedMasters : [],
    status: 'active',
    deleted: false,
    createdAt: now,
    updatedAt: now,
    createdBy: user
  }

  await partnersCol.insertOne(partner)

  await createAuditLog(client, {
    action: 'partner-create',
    masterName: '_partners',
    user,
    detail: `Partner created: ${name} (${partnerId})`
  })

  // Return the key ONLY on create — this is the only time it's visible
  return createResponse({
    status: 'created',
    partner: {
      partnerId,
      partnerKey,
      name: partner.name,
      description: partner.description,
      contactEmail: partner.contactEmail,
      allowedMasters: partner.allowedMasters,
      status: partner.status,
      createdAt: now
    },
    message: 'Partner created. Save the partner key — it will not be shown again.'
  }, 201)
}

// ============ PUT — Update partner ============

async function handleUpdate (client, partnersCol, params, user) {
  const { partnerId, name, description, contactEmail, status, regenerateKey } = params
  const allowedMasters = params.allowedMasters || params.allowedEntities

  if (!partnerId) return createErrorResponse('Missing required parameter: partnerId', 400)

  const partner = await safeFindOne(partnersCol, { partnerId, deleted: { $ne: true } })
  if (!partner) return createErrorResponse('Partner not found', 404)

  const updateFields = { updatedAt: getTimezoneDate(params) }
  if (name !== undefined) updateFields.name = name.trim()
  if (description !== undefined) updateFields.description = description.trim()
  if (contactEmail !== undefined) updateFields.contactEmail = contactEmail.trim()
  if (allowedMasters !== undefined) {
    if (!Array.isArray(allowedMasters) || allowedMasters.length === 0) {
      return createErrorResponse('At least one allowed master is required', 400)
    }
    updateFields.allowedMasters = allowedMasters
  }
  if (status !== undefined && ['active', 'suspended', 'revoked'].includes(status)) {
    updateFields.status = status
  }

  let newKey = null
  if (regenerateKey) {
    newKey = generatePartnerKey()
    updateFields.partnerKey = newKey
    updateFields.keyRegeneratedAt = getTimezoneDate(params)
  }

  await partnersCol.updateOne({ partnerId }, { $set: updateFields })

  await createAuditLog(client, {
    action: 'partner-update',
    masterName: '_partners',
    user,
    detail: `Partner updated: ${partner.name} (${partnerId})${regenerateKey ? ' [key regenerated]' : ''}${status ? ` [status → ${status}]` : ''}`
  })

  const response = {
    status: 'updated',
    partnerId,
    message: 'Partner updated successfully'
  }

  // Return new key only when regenerated
  if (newKey) {
    response.partnerKey = newKey
    response.message = 'Partner updated. New key generated — save it, it will not be shown again.'
  }

  return createResponse(response)
}

// ============ DELETE — Remove partner ============

async function handleDelete (client, partnersCol, params, user) {
  const { partnerId } = params
  if (!partnerId) return createErrorResponse('Missing required parameter: partnerId', 400)

  const partner = await safeFindOne(partnersCol, { partnerId, deleted: { $ne: true } })
  if (!partner) return createErrorResponse('Partner not found', 404)

  const now = getTimezoneDate(params)
  await partnersCol.updateOne(
    { partnerId },
    { $set: { deleted: true, deletedAt: now, deletedBy: user, status: 'revoked' } }
  )

  await createAuditLog(client, {
    action: 'partner-delete',
    masterName: '_partners',
    user,
    detail: `Partner deleted: ${partner.name} (${partnerId})`
  })

  return createResponse({
    status: 'deleted',
    partnerId,
    message: 'Partner removed successfully'
  })
}

exports.main = main
