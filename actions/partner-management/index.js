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
const { getDbClient, safeFindOne, COLLECTIONS, createAuditLog, createResponse, createErrorResponse, validateIMSToken, getUserFromParams, getTimezoneDate, enforceAppPermission, rotatePartnerKey, registerWebhook } = require('../mdm-utils')

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

  // Parse body for POST (all mutations use POST; body may arrive in __ow_body or already merged)
  if (method === 'post' && params.__ow_body) {
    try {
      const raw = params.__ow_body
      const bodyParams = typeof raw === 'object' ? raw
        : (() => { try { return JSON.parse(raw) } catch (e) { return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8')) } })()
      Object.assign(params, bodyParams)
    } catch (e) { /* ignore parse errors */ }
  }

  // Determine operation: GET → list, POST → op param (create/update/delete)
  const op = (params.op || '').toLowerCase()

  let client
  try {
    client = await getDbClient(params)

    // App-level RBAC
    const appPerm = await enforceAppPermission(client, params, 'partner-management')
    if (!appPerm.allowed) return appPerm.response

    const user = await getUserFromParams(params, client)
    const partnersCol = await client.collection(COLLECTIONS.PARTNERS)

    if (method === 'get') return await handleList(partnersCol, params)

    if (method === 'post') {
      switch (op) {
        case 'create':
          return await handleCreate(client, partnersCol, params, user)
        case 'update':
          return await handleUpdate(client, partnersCol, params, user)
        case 'delete':
          return await handleDelete(client, partnersCol, params, user)
        case 'rotate-key':
          return await handleRotateKey(client, partnersCol, params, user)
        case 'register-webhook':
          return await handleRegisterWebhook(client, partnersCol, params, user)
        case 'list-webhooks':
          return await handleListWebhooks(client, params)
        case 'delete-webhook':
          return await handleDeleteWebhook(client, params, user)
        default:
          // If partnerId is present but no op, treat as update (likely body parse issue)
          if (params.partnerId) {
            return await handleUpdate(client, partnersCol, params, user)
          }
          // Backwards compat: POST without op → create
          return await handleCreate(client, partnersCol, params, user)
      }
    }

    return createErrorResponse(`Unsupported method: ${method}`, 405)
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
    keyExpiresAt: computeKeyExpiry(params.keyExpiryDays || 365),
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

// ============ POST op=rotate-key — Rotate API key with expiry ============

function computeKeyExpiry (days) {
  const dt = new Date()
  dt.setDate(dt.getDate() + Number(days || 365))
  return dt.toISOString()
}

async function handleRotateKey (client, partnersCol, params, user) {
  const { partnerId, expiryDays } = params
  if (!partnerId) return createErrorResponse('Missing required parameter: partnerId', 400)

  const partner = await safeFindOne(partnersCol, { partnerId, deleted: { $ne: true } })
  if (!partner) return createErrorResponse('Partner not found', 404)

  const result = await rotatePartnerKey(partnersCol, partnerId, expiryDays || 365)

  await createAuditLog(client, {
    action: 'partner-key-rotate',
    masterName: '_partners',
    user,
    detail: `API key rotated for partner: ${partner.name} (${partnerId}), expires: ${result.expiresAt}`
  })

  return createResponse({
    status: 'rotated',
    partnerId,
    partnerKey: result.partnerKey,
    expiresAt: result.expiresAt,
    message: 'New API key generated. Save it — it will not be shown again.'
  })
}

// ============ POST op=register-webhook — Register webhook subscription ============

async function handleRegisterWebhook (client, partnersCol, params, user) {
  const { partnerId, url, events, masters, secret } = params
  if (!partnerId) return createErrorResponse('Missing required parameter: partnerId', 400)

  const partner = await safeFindOne(partnersCol, { partnerId, deleted: { $ne: true } })
  if (!partner) return createErrorResponse('Partner not found', 404)

  try {
    const result = await registerWebhook(client, { partnerId, url, events, masters, secret }, user, params)
    await createAuditLog(client, {
      action: 'webhook-register',
      masterName: '_webhooks',
      user,
      detail: `Webhook registered for partner ${partner.name}: ${url} → [${events.join(', ')}]`
    })
    return createResponse({ status: 'created', webhook: result }, 201)
  } catch (error) {
    return createErrorResponse(error.message, 400)
  }
}

// ============ POST op=list-webhooks — List webhook subscriptions ============

async function handleListWebhooks (client, params) {
  const { partnerId } = params
  const webhooksCol = await client.collection(COLLECTIONS.WEBHOOKS)

  const filter = {}
  if (partnerId) filter.partnerId = partnerId

  const webhooks = await webhooksCol.find(filter).sort({ createdAt: -1 }).toArray()
  // Strip secrets from listing
  const safe = webhooks.map(w => {
    const { secret, ...rest } = w
    return { ...rest, hasSecret: !!secret }
  })

  return createResponse({ webhooks: safe, count: safe.length })
}

// ============ POST op=delete-webhook — Remove webhook subscription ============

async function handleDeleteWebhook (client, params, user) {
  const { webhookId } = params
  if (!webhookId) return createErrorResponse('Missing required parameter: webhookId', 400)

  const webhooksCol = await client.collection(COLLECTIONS.WEBHOOKS)
  const webhook = await safeFindOne(webhooksCol, { webhookId })
  if (!webhook) return createErrorResponse('Webhook not found', 404)

  await webhooksCol.deleteOne({ webhookId })

  await createAuditLog(client, {
    action: 'webhook-delete',
    masterName: '_webhooks',
    user,
    detail: `Webhook deleted: ${webhook.url} (${webhookId})`
  })

  return createResponse({ status: 'deleted', webhookId })
}

exports.main = main
