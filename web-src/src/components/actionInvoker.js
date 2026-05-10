/**
 * Action invocation utility for MDM admin console
 */

import actionWebInvoke from '../utils'

const actions = {}

try {
  const config = require('../config.json')
  Object.assign(actions, config)
} catch (e) {
  // config may not exist yet
}

/**
 * Get the base action URL
 */
function getActionUrl (actionName) {
  // Config keys use 'pimapp/actionName' format
  const fullKey = `pimapp/${actionName}`
  if (actions[fullKey]) {
    return actions[fullKey]
  }
  if (actions[actionName]) {
    return actions[actionName]
  }
  // Fallback: construct URL from convention
  return `/api/v1/web/pimapp/${actionName}`
}

/**
 * Get the current IMS token - checks multiple sources
 * Priority: 1) Passed ims object, 2) localStorage fallback
 */
function getImsCredentials (ims) {
  const token = (ims && ims.token) || localStorage.getItem('mdm_ims_token') || ''
  const org = (ims && ims.org) || localStorage.getItem('mdm_ims_org') || ''
  return { token, org }
}

/**
 * In-flight request deduplication map.
 * Prevents duplicate simultaneous GET calls to the same endpoint.
 */
const inflightRequests = new Map()

/**
 * Invoke an MDM action with IMS auth
 */
export async function invokeAction (actionName, params = {}, ims = {}, method = 'POST') {
  const { token, org } = getImsCredentials(ims)
  const headers = {}
  if (token) {
    headers.authorization = `Bearer ${token}`
    headers['x-gw-ims-org-id'] = org
  }

  const actionUrl = getActionUrl(actionName)

  // Deduplicate concurrent GET requests with identical params
  if (method === 'GET') {
    const dedupeKey = `${actionName}:${JSON.stringify(params)}`
    const inflight = inflightRequests.get(dedupeKey)
    if (inflight) return inflight

    const promise = actionWebInvoke(actionUrl, headers, params, { method })
      .finally(() => inflightRequests.delete(dedupeKey))
    inflightRequests.set(dedupeKey, promise)
    return promise
  }

  return await actionWebInvoke(actionUrl, headers, params, { method })
}

/**
 * Register user session — call on login to cache user identity server-side
 */
export async function registerSession (ims) {
  return invokeAction('app-settings', { sessionOperation: 'register' }, ims, 'POST')
}

/**
 * Deregister user session — call on logout to clean up cached identity
 */
export async function deregisterSession (ims) {
  return invokeAction('app-settings', { sessionOperation: 'deregister' }, ims, 'POST')
}

/**
 * Dashboard stats
 */
export async function fetchDashboard (ims, opts = {}) {
  const params = {}
  if (opts.forceRefresh) params.forceRefresh = true
  return invokeAction('dashboard', params, ims, 'GET')
}

/**
 * File operations
 */
export async function fetchFileList (ims) {
  return invokeAction('file-list', {}, ims, 'GET')
}

export async function fetchFileDetail (master, ims) {
  return invokeAction('file-detail', { master: master }, ims, 'GET')
}

export async function uploadFile (params, ims) {
  const compressed = await compressCsvContent(params)
  return invokeAction('file-upload', compressed, ims, 'POST')
}

export async function deleteFile (master, ims) {
  return invokeAction('file-delete', { master: master }, ims, 'POST')
}

export async function updateMetadata (master, params, ims) {
  return invokeAction('metadata-update', { master: master, ...params }, ims, 'POST')
}

/**
 * Data operations
 */
export async function queryData (master, queryParams, ims) {
  return invokeAction('query-data', { master: master, ...queryParams }, ims, 'GET')
}

export async function createRecord (master, data, ims) {
  return invokeAction('record-crud', { master: master, operation: 'create', data }, ims, 'POST')
}

export async function updateRecord (master, id, data, ims) {
  return invokeAction('record-crud', { master: master, id, operation: 'update', data }, ims, 'POST')
}

export async function patchRecord (master, id, data, ims) {
  return invokeAction('record-crud', { master: master, id, operation: 'patch', data }, ims, 'POST')
}

export async function deleteRecord (master, id, ims) {
  return invokeAction('record-crud', { master: master, id, operation: 'delete' }, ims, 'POST')
}

/**
 * Bulk operations
 */
export async function fullUpdate (master, csvContent, ims) {
  const params = await compressCsvContent({ master, csvContent })
  return invokeAction('full-update', params, ims, 'POST')
}

export async function deltaUpdate (master, csvContent, mode, ims) {
  const params = await compressCsvContent({ master, csvContent, mode })
  return invokeAction('delta-update', params, ims, 'POST')
}

/**
 * Compress csvContent field with gzip to stay under the 1 MB Runtime gateway limit.
 * Uses native CompressionStream API (no external dependency).
 * The server-side decompressCsvContent() reverses this.
 */
async function compressCsvContent (params) {
  if (!params.csvContent) return params
  const encoder = new TextEncoder()
  const stream = new Blob([encoder.encode(params.csvContent)])
    .stream()
    .pipeThrough(new CompressionStream('gzip'))
  const compressedBlob = await new Response(stream).blob()
  const buffer = await compressedBlob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  const base64 = btoa(binary)
  return { ...params, csvContent: base64, csvCompressed: true }
}

export async function bulkUpdate (master, records, operationType, dryRun, ims) {
  return invokeAction('bulk-update', { master: master, records, operationType, dryRun }, ims, 'POST')
}

/**
 * Schema operations
 */
export async function updateSchema (master, operation, field, ims) {
  return invokeAction('schema-update', { master: master, operation, field }, ims, 'POST')
}

/**
 * Visibility operations
 */
export async function updateVisibility (master, visibility, ims) {
  return invokeAction('visibility-update', { master: master, visibility }, ims, 'POST')
}

/**
 * Facets / Aggregation operations
 */
export async function fetchFacets (master, params, ims) {
  return invokeAction('mdm-facets', { master: master, ...params }, ims, 'GET')
}

/**
 * Audit operations
 */
export async function fetchAuditLogs (params, ims) {
  return invokeAction('audit-list', params, ims, 'GET')
}

export async function fetchAuditArchives (params, ims) {
  return invokeAction('audit-list', { ...params, type: 'archives' }, ims, 'GET')
}

export async function triggerAuditCleanup (ims) {
  return invokeAction('audit-cleanup', { phase: 'archive' }, ims, 'POST')
}

export async function triggerArchivePurge (ims) {
  return invokeAction('audit-cleanup', { phase: 'purge' }, ims, 'POST')
}

/**
 * Archive operations
 */
export async function fetchArchives (master, params, ims) {
  return invokeAction('archive-list', { master: master, ...params }, ims, 'GET')
}

export async function fetchArchiveConfig (master, ims) {
  return invokeAction('archive-config', { master: master }, ims, 'GET')
}

export async function updateArchiveConfig (master, archival, ims) {
  return invokeAction('archive-config', { master: master, archival }, ims, 'POST')
}

export async function triggerArchiveRun (master, ims) {
  return invokeAction('archive-run', { master: master }, ims, 'POST')
}

/**
 * Infra Metrics operations
 */
export async function fetchInfraMetrics (report, params, ims) {
  return invokeAction('infra-metrics', { report, ...params }, ims, 'GET')
}

// ============ User & Role Management ============

/**
 * Resolve the current logged-in user's role and permissions.
 * Called on every app mount to gate features.
 */
export async function resolveCurrentUser (ims) {
  return invokeAction('user-management', { op: 'resolve' }, ims, 'GET')
}

/**
 * List all app users (user_management permission required).
 */
export async function fetchAppUsers (ims) {
  return invokeAction('user-management', { op: 'users' }, ims, 'GET')
}

/**
 * List all app roles (user_management permission required).
 */
export async function fetchAppRoles (ims) {
  return invokeAction('user-management', { op: 'roles' }, ims, 'GET')
}

/**
 * Create a single app user.
 */
export async function createAppUser (userData, ims) {
  return invokeAction('user-management', { op: 'create-user', ...userData }, ims, 'POST')
}

/**
 * Bulk create app users.
 * @param {Array} users - Array of { email, firstName, lastName, roleId }
 */
export async function bulkCreateAppUsers (users, ims) {
  return invokeAction('user-management', { op: 'bulk-create-users', users }, ims, 'POST')
}

/**
 * Update an app user (role, status, name).
 */
export async function updateAppUser (userData, ims) {
  return invokeAction('user-management', { op: 'update-user', ...userData }, ims, 'POST')
}

/**
 * Deactivate an app user.
 */
export async function deleteAppUser (email, ims) {
  return invokeAction('user-management', { op: 'delete-user', email }, ims, 'POST')
}

/**
 * Create a custom role.
 */
export async function createAppRole (roleData, ims) {
  return invokeAction('user-management', { op: 'create-role', ...roleData }, ims, 'POST')
}

/**
 * Update a custom role.
 */
export async function updateAppRole (roleData, ims) {
  return invokeAction('user-management', { op: 'update-role', ...roleData }, ims, 'POST')
}

/**
 * Delete a custom role (must have 0 assigned users).
 */
export async function deleteAppRole (roleId, ims) {
  return invokeAction('user-management', { op: 'delete-role', roleId }, ims, 'POST')
}

// ============ Data Export & Enterprise Features ============

/**
 * Export master data as CSV/JSON with filters.
 */
export async function exportData (master, opts, ims) {
  return invokeAction('data-export', { op: 'export', master, ...opts }, ims, 'POST')
}

/**
 * Preview export — returns first N matching records.
 */
export async function previewExport (master, opts, ims) {
  return invokeAction('data-export', { op: 'preview', master, ...opts }, ims, 'GET')
}

/**
 * Data quality report for a master entity.
 */
export async function fetchDataQuality (master, opts, ims) {
  return invokeAction('data-export', { op: 'quality', master, ...opts }, ims, 'GET')
}

/**
 * Find potential duplicate records.
 */
export async function findDuplicates (master, opts, ims) {
  return invokeAction('data-export', { op: 'duplicates', master, ...opts }, ims, 'POST')
}

/**
 * Get version history for a specific record.
 */
export async function fetchRecordVersions (master, recordId, opts, ims) {
  return invokeAction('data-export', { op: 'versions', master, recordId, ...opts }, ims, 'GET')
}

/**
 * Rollback a record to a previous version.
 */
export async function rollbackRecord (master, recordId, targetVersion, ims) {
  return invokeAction('data-export', { op: 'rollback', master, recordId, targetVersion }, ims, 'POST')
}

/**
 * Transition a record's workflow status (approval workflow).
 */
export async function transitionRecordStatus (master, id, newStatus, comment, ims) {
  return invokeAction('record-crud', { master, id, operation: 'transition', newStatus, comment }, ims, 'POST')
}

// ============ Partner Webhook Management ============

/**
 * Rotate a partner's API key.
 */
export async function rotatePartnerKey (partnerId, expiryDays, ims) {
  return invokeAction('partner-management', { op: 'rotate-key', partnerId, expiryDays }, ims, 'POST')
}

/**
 * Register a webhook subscription for a partner.
 */
export async function registerWebhook (partnerId, url, events, masters, ims) {
  return invokeAction('partner-management', { op: 'register-webhook', partnerId, url, events, masters }, ims, 'POST')
}

/**
 * List webhook subscriptions.
 */
export async function fetchWebhooks (partnerId, ims) {
  return invokeAction('partner-management', { op: 'list-webhooks', partnerId }, ims, 'POST')
}

/**
 * Delete a webhook subscription.
 */
export async function deleteWebhook (webhookId, ims) {
  return invokeAction('partner-management', { op: 'delete-webhook', webhookId }, ims, 'POST')
}
