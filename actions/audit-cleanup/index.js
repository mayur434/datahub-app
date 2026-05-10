/**
 * MDM Audit Cleanup Action
 * Triggered by the alarm package (scheduled daily) or manually from admin UI.
 *
 * Flow:
 *   1. Read retention settings from app-settings
 *   2. Find audit logs older than retentionDays
 *   3. Archive them as a compressed CSV (.zip) to aio-lib-files
 *   4. Store archive metadata in 'audit_archives' collection (with public URL)
 *   5. Delete archived logs from the 'audit' collection
 *   6. Purge expired audit archive records (based on archiveRetentionDays)
 *
 * This action is NON-web when triggered by scheduler, so it uses
 * include-ims-credentials to self-authenticate.
 */

const crypto = require('crypto')
const zlib = require('zlib')
const { getDbClient, COLLECTIONS, getEnvConfig, getCachedSettings, getTimezoneDate, getFilesClient } = require('../mdm-utils')

async function main (params) {
  // Manual (web) invocations pass an explicit phase; scheduled triggers run both phases
  const isManual = params.__ow_method && params.__ow_headers
  const phase = isManual ? (params.phase || 'archive').toLowerCase() : 'all'
  console.log(`Audit cleanup triggered at: ${getTimezoneDate(params)} — phase: ${phase}, source: ${isManual ? 'manual' : 'schedule'}`)

  let client
  try {
    client = await getDbClient(params)
    const auditCol = await client.collection(COLLECTIONS.AUDIT)
    const auditArchivesCol = await client.collection(COLLECTIONS.AUDIT_ARCHIVES)

    // Read app settings
    const env = getEnvConfig(params)
    const settings = await getCachedSettings(client)
    const auditSettings = settings?.audit || {}

    // Single flag — if auditing is disabled, nothing to archive or purge
    if (auditSettings.enabled === false) {
      console.log('Auditing is DISABLED in app settings. Skipping.')
      return { statusCode: 200, body: { status: 'skipped', reason: 'Auditing disabled in settings' } }
    }

    const retentionDays = env.auditRetentionDays
    const archiveRetentionDays = env.archiveRetentionDays

    // Initialize aio-lib-files (handles both local dev and deployed Runtime)
    const files = await getFilesClient()

    if (phase === 'archive' || phase === 'all') {
      const archiveResult = await runArchivePhase(auditCol, auditArchivesCol, files, retentionDays, archiveRetentionDays, params)

      if (phase === 'archive') {
        return {
          statusCode: 200,
          body: {
            status: 'success',
            phase: 'archive',
            archived: archiveResult,
            message: archiveResult
              ? `Archived ${archiveResult.recordCount} log(s) to ${archiveResult.fileName}`
              : 'No expired logs to archive'
          }
        }
      }

      // phase === 'all' → fall through to purge
      const purgedCount = await runPurgePhase(auditArchivesCol, files, params)
      return {
        statusCode: 200,
        body: {
          status: 'success',
          phase: 'all',
          archived: archiveResult,
          purgedArchives: purgedCount,
          message: archiveResult
            ? `Archived ${archiveResult.recordCount} log(s), purged ${purgedCount} expired archive(s)`
            : `No logs to archive, purged ${purgedCount} expired archive(s)`
        }
      }
    }

    if (phase === 'purge') {
      const purgedCount = await runPurgePhase(auditArchivesCol, files, params)
      return {
        statusCode: 200,
        body: {
          status: 'success',
          phase: 'purge',
          purgedArchives: purgedCount,
          message: purgedCount > 0
            ? `Purged ${purgedCount} expired archive(s)`
            : 'No expired archives to purge'
        }
      }
    }

    return { statusCode: 400, body: { status: 'error', message: `Invalid phase: ${phase}. Use "archive", "purge", or "all".` } }
  } catch (error) {
    console.error('Audit cleanup error:', error)
    return { statusCode: 500, body: { status: 'error', message: error.message } }
  } finally {
    if (client) await client.close()
  }
}

// ─── Phase 1: Archive expired audit logs ────────────────────────────

async function runArchivePhase (auditCol, auditArchivesCol, files, retentionDays, archiveRetentionDays, params) {
  // Cutoff must be in the SAME format as stored audit timestamps (IST via getTimezoneDate).
  // Using UTC toISOString() would cause string comparison mismatch (IST hours > UTC hours).
  const tz = params.APP_TIMEZONE || 'Asia/Kolkata'
  const cutoffMs = Date.now() - (retentionDays * 86400000)
  const cutoffDate = new Date(cutoffMs)
  const cutoffISO = formatInTimezone(cutoffDate, tz)

  console.log(`Archiving audit logs older than ${retentionDays} days (before ${cutoffISO})`)

  const expiredLogs = await auditCol.find({ timestamp: { $lt: cutoffISO } })
    .sort({ timestamp: 1 })
    .toArray()

  if (expiredLogs.length === 0) {
    console.log('No expired audit logs found. Skipping archive phase.')
    return null
  }

  // Build CSV content from expired logs
  const oldestTimestamp = expiredLogs[0].timestamp || cutoffISO
  const newestTimestamp = expiredLogs[expiredLogs.length - 1].timestamp || cutoffISO

  // Determine CSV columns from all logs (union of all keys, excluding _id)
  const columnSet = new Set()
  for (const log of expiredLogs) {
    for (const key of Object.keys(log)) {
      if (key !== '_id') columnSet.add(key)
    }
  }
  // Pin common columns first, then alphabetical remainder
  const pinnedCols = ['timestamp', 'masterName', 'operation', 'action', 'actor', 'user', 'status']
  const remainingCols = [...columnSet].filter(c => !pinnedCols.includes(c)).sort()
  const columns = [...pinnedCols.filter(c => columnSet.has(c)), ...remainingCols]

  const csvLines = [columns.map(escapeCsvField).join(',')]
  for (const log of expiredLogs) {
    const row = columns.map(col => {
      let val = log[col]
      if (val === undefined || val === null) return ''
      if (typeof val === 'object') val = JSON.stringify(val)
      return escapeCsvField(String(val))
    })
    csvLines.push(row.join(','))
  }
  const csvContent = csvLines.join('\n')

  // Compress CSV into gzip archive (native Node.js, no extra deps)
  const csvBuffer = Buffer.from(csvContent, 'utf-8')
  const compressedBuffer = zlib.gzipSync(csvBuffer, { level: 9 })

  // Generate file path and ID
  const archiveId = `aud-${crypto.randomUUID().split('-')[0]}`
  const dateSlug = getTimezoneDate(params).replace(/[:.]/g, '-').slice(0, 19)
  const fileName = `audit-archive-${dateSlug}.csv.gz`
  const filePath = `audit-archives/${fileName}`

  // Upload compressed archive to aio-lib-files (cloud storage)
  console.log(`[archive] Uploading ${filePath} (${compressedBuffer.length} bytes) to aio-lib-files...`)
  await files.write(filePath, compressedBuffer)
  console.log(`[archive] Upload complete: ${filePath}`)

  // Generate pre-signed public URL — aio-lib-files max TTL is 86400s (24h)
  const expirySeconds = Math.min(archiveRetentionDays * 86400, 86400)
  console.log(`[archive] Generating presign URL (TTL: ${expirySeconds}s)...`)
  const publicUrl = await files.generatePresignURL(filePath, { expiryInSeconds: expirySeconds })
  console.log(`[archive] Presign URL generated: ${publicUrl.substring(0, 80)}...`)

  const compressionRatio = csvBuffer.length > 0 ? ((1 - compressedBuffer.length / csvBuffer.length) * 100).toFixed(1) : 0
  console.log(`[archive] CSV: ${csvBuffer.length} bytes → compressed: ${compressedBuffer.length} bytes (${compressionRatio}% saved)`)

  // Calculate archive expiry date
  const now = new Date()
  const expiresAt = new Date(now.getTime() + archiveRetentionDays * 86400000).toISOString()

  // Store archive metadata
  const archiveRecord = {
    archiveId,
    fileName,
    filePath,
    publicUrl,
    recordCount: expiredLogs.length,
    sizeBytes: compressedBuffer.length,
    uncompressedSizeBytes: csvBuffer.length,
    format: 'csv.gz',
    dateRange: { from: oldestTimestamp, to: newestTimestamp },
    archivedAt: getTimezoneDate(params),
    expiresAt,
    archiveRetentionDays,
    status: 'active',
    triggeredBy: (params.__ow_method && params.__ow_headers) ? 'manual' : 'schedule'
  }

  await auditArchivesCol.insertOne(archiveRecord)
  console.log(`Archived ${expiredLogs.length} audit log(s) → ${fileName} (${compressedBuffer.length} bytes)`)

  // Delete archived logs from audit collection
  await auditCol.deleteMany({ timestamp: { $lt: cutoffISO } })

  // Log the cleanup itself (meta audit entry)
  await auditCol.insertOne({
    timestamp: getTimezoneDate(params),
    masterName: '_system',
    operation: 'audit-archive',
    actor: (params.__ow_method && params.__ow_headers) ? 'admin' : 'scheduler',
    status: 'success',
    details: {
      archiveId,
      recordCount: expiredLogs.length,
      fileName,
      sizeBytes: compressedBuffer.length,
      uncompressedSizeBytes: csvBuffer.length,
      retentionDays,
      archiveRetentionDays,
      cutoffDate: cutoffISO,
      expiresAt
    }
  })

  return {
    archiveId,
    fileName,
    publicUrl,
    recordCount: expiredLogs.length,
    sizeBytes: compressedBuffer.length,
    expiresAt
  }
}

// ─── Phase 2: Purge expired audit archives ──────────────────────────

async function runPurgePhase (auditArchivesCol, files, params) {
  let purgedCount = 0
  const now = new Date().toISOString()
  const expiredArchives = await auditArchivesCol.find({
    status: 'active',
    expiresAt: { $lt: now }
  }).toArray()

  if (expiredArchives.length === 0) {
    console.log('No expired archives to purge.')
    return 0
  }

  for (const archive of expiredArchives) {
    try {
      await files.delete(archive.filePath)
      await auditArchivesCol.updateOne(
        { archiveId: archive.archiveId },
        { $set: { status: 'expired', purgedAt: getTimezoneDate(params) } }
      )
      purgedCount++
      console.log(`Purged expired audit archive: ${archive.fileName}`)
    } catch (purgeErr) {
      // Mark as purge-failed so it can be retried — don't mark expired if file still exists
      console.error(`Failed to purge archive ${archive.archiveId}:`, purgeErr.message)
      await auditArchivesCol.updateOne(
        { archiveId: archive.archiveId },
        { $set: { status: 'purge-failed', purgeError: purgeErr.message, lastPurgeAttempt: getTimezoneDate(params) } }
      ).catch(() => {})
    }
  }

  return purgedCount
}

function escapeCsvField (field) {
  const str = String(field)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Format a Date in the same style as getTimezoneDate() from mdm-utils.
 * Produces: 2026-05-02T14:52:49+05:30
 * This MUST match the format used when storing audit log timestamps,
 * otherwise $lt string comparisons will silently fail.
 */
function formatInTimezone (date, tz) {
  const localStr = date.toLocaleString('en-CA', { timeZone: tz, hour12: false }).replace(', ', 'T')
  // Compute offset
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }))
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: tz }))
  const diff = (tzDate - utcDate) / 60000
  const hours = Math.floor(Math.abs(diff) / 60)
  const mins = Math.abs(diff) % 60
  const sign = diff >= 0 ? '+' : '-'
  return `${localStr}${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

exports.main = main
