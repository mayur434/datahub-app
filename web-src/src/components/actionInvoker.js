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
 * Dashboard stats
 */
export async function fetchDashboard (ims) {
  return invokeAction('dashboard', {}, ims, 'GET')
}

/**
 * File operations
 */
export async function fetchFileList (ims) {
  return invokeAction('file-list', {}, ims, 'GET')
}

export async function fetchFileDetail (entity, ims) {
  return invokeAction('file-detail', { entity }, ims, 'GET')
}

export async function uploadFile (params, ims) {
  return invokeAction('file-upload', params, ims, 'POST')
}

export async function deleteFile (entity, ims) {
  return invokeAction('file-delete', { entity }, ims, 'POST')
}

export async function updateMetadata (entity, params, ims) {
  return invokeAction('metadata-update', { entity, ...params }, ims, 'POST')
}

/**
 * Data operations
 */
export async function queryData (entity, queryParams, ims) {
  return invokeAction('query-data', { entity, ...queryParams }, ims, 'GET')
}

export async function createRecord (entity, data, ims) {
  return invokeAction('record-crud', { entity, operation: 'create', data }, ims, 'POST')
}

export async function updateRecord (entity, id, data, ims) {
  return invokeAction('record-crud', { entity, id, operation: 'update', data }, ims, 'POST')
}

export async function patchRecord (entity, id, data, ims) {
  return invokeAction('record-crud', { entity, id, operation: 'patch', data }, ims, 'POST')
}

export async function deleteRecord (entity, id, ims) {
  return invokeAction('record-crud', { entity, id, operation: 'delete' }, ims, 'POST')
}

/**
 * Bulk operations
 */
export async function fullUpdate (entity, csvContent, ims) {
  return invokeAction('full-update', { entity, csvContent }, ims, 'POST')
}

export async function deltaUpdate (entity, csvContent, mode, ims) {
  return invokeAction('delta-update', { entity, csvContent, mode }, ims, 'POST')
}

export async function bulkUpdate (entity, records, operationType, dryRun, ims) {
  return invokeAction('bulk-update', { entity, records, operationType, dryRun }, ims, 'POST')
}

/**
 * Schema operations
 */
export async function updateSchema (entity, operation, field, ims) {
  return invokeAction('schema-update', { entity, operation, field }, ims, 'POST')
}

/**
 * Version operations
 */
export async function fetchVersions (entity, ims) {
  return invokeAction('version-list', { entity }, ims, 'GET')
}

export async function rollbackVersion (entity, versionId, ims) {
  return invokeAction('version-rollback', { entity, versionId }, ims, 'POST')
}

/**
 * Visibility operations
 */
export async function updateVisibility (entity, visibility, ims) {
  return invokeAction('visibility-update', { entity, visibility }, ims, 'POST')
}

/**
 * Facets / Aggregation operations
 */
export async function fetchFacets (entity, params, ims) {
  return invokeAction('mdm-facets', { entity, ...params }, ims, 'GET')
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
export async function fetchArchives (entity, params, ims) {
  return invokeAction('archive-list', { entity, ...params }, ims, 'GET')
}

export async function fetchArchiveConfig (entity, ims) {
  return invokeAction('archive-config', { entity }, ims, 'GET')
}

export async function updateArchiveConfig (entity, archival, ims) {
  return invokeAction('archive-config', { entity, archival }, ims, 'POST')
}

export async function triggerArchiveRun (entity, ims) {
  return invokeAction('archive-run', { entity }, ims, 'POST')
}
