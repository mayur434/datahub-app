/**
 * MDM Utility Functions
 * Shared utilities for all MDM runtime actions
 *
 * Storage Architecture:
 *   - Primary DB: @adobe/aio-lib-db (MongoDB-like document database)
 *     Collections: metadata, records, versions, audit
 *   - Caching: Handled by API Mesh CDN layer (no application-level L2 cache)
 */

const { Core } = require('@adobe/aio-sdk')
const libDb = require('@adobe/aio-lib-db')
const crypto = require('crypto')

// ============ Database Connection ============

/**
 * Initialize aio-lib-db and return a connected client.
 * Caller MUST call client.close() in finally block.
 */
async function getDbClient (params) {
  const { generateAccessToken } = Core.AuthClient
  const token = await generateAccessToken(params)
  const region = process.env.AIO_DB_REGION || 'apac'
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
  RECORDS: 'records',
  VERSIONS: 'versions',
  AUDIT: 'audit',
  SETTINGS: 'settings',
  ARCHIVES: 'archives'
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

// ============ Auth Helpers ============

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
 * Extract user info from IMS context
 */
function getUserFromParams (params) {
  if (params.__ims_oauth_s2s) {
    return params.__ims_oauth_s2s.client_id || 'system'
  }
  return params.__ow_headers?.['x-ims-user'] || 'admin@aem'
}

// ============ Audit Helpers ============

/**
 * Create an audit log entry in the audit collection
 */
async function createAuditLog (client, logEntry) {
  const auditCol = await client.collection(COLLECTIONS.AUDIT)
  const fullEntry = {
    timestamp: new Date().toISOString(),
    ...logEntry
  }
  await auditCol.insertOne(fullEntry)
  return fullEntry
}

// ============ Version Helpers ============

/**
 * Create a new version document for an entity
 */
async function createVersion (client, entity, operation, user, changeSummary, recordCount) {
  const metaCol = await client.collection(COLLECTIONS.METADATA)
  const versionCol = await client.collection(COLLECTIONS.VERSIONS)

  const metadata = await safeFindOne(metaCol, { entityName: entity })
  const currentVersion = metadata ? (parseInt((metadata.activeVersionId || 'v0').replace('v', '')) + 1) : 1
  const versionId = `v${currentVersion}`

  const versionDoc = {
    versionId,
    entityName: entity,
    operation,
    createdBy: user,
    createdAt: new Date().toISOString(),
    recordCount,
    changeSummary: changeSummary || {},
    status: 'active'
  }

  await versionCol.insertOne(versionDoc)
  return versionDoc
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

module.exports = {
  getDbClient,
  safeFindOne,
  COLLECTIONS,
  parseCSV,
  parseCSVLine,
  validateCSV,
  validateIMSToken,
  getUserFromParams,
  createAuditLog,
  createVersion,
  createResponse,
  createErrorResponse,
  sortObject,
  generateId
}
