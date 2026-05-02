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
  return invokeAction('file-upload', params, ims, 'POST')
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
  return invokeAction('full-update', { master: master, csvContent }, ims, 'POST')
}

export async function deltaUpdate (master, csvContent, mode, ims) {
  return invokeAction('delta-update', { master: master, csvContent, mode }, ims, 'POST')
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
 * Version operations
 */
export async function fetchVersions (master, ims) {
  return invokeAction('version-list', { master: master }, ims, 'GET')
}

export async function rollbackVersion (master, versionId, ims) {
  return invokeAction('version-rollback', { master: master, versionId }, ims, 'POST')
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
