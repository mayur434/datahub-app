/**
 * MDM Archive Run Action — Scheduled Job (Alarm Trigger)
 *
 * Runs on schedule (default: daily at 3 AM) to:
 * 1. Check all entities with archival enabled
 * 2. If record count exceeds threshold, archive oldest records to aio-lib-files
 * 3. Delete archived records from DB to free space
 * 4. Track archive metadata in 'archives' collection
 * 5. Send email notification with public download link
 * 6. Cleanup expired archives based on retention period
 *
 * Also supports manual trigger via web action (POST).
 */

const { Core } = require('@adobe/aio-sdk')
const libDb = require('@adobe/aio-lib-db')
const filesLib = require('@adobe/aio-lib-files')
const crypto = require('crypto')

// ============ DB Connection ============

async function getDbClient (params) {
  const { generateAccessToken } = Core.AuthClient
  const token = await generateAccessToken(params)
  const region = process.env.AIO_DB_REGION || 'apac'
  const db = await libDb.init({ token: token.access_token, region })
  return await db.connect()
}

async function safeFindOne (collection, filter) {
  try {
    return await collection.findOne(filter)
  } catch (e) {
    if (e.message && e.message.includes('Document not found')) return null
    throw e
  }
}

// ============ Main Action ============

async function main (params) {
  const logger = Core.Logger('archive-run', { level: params.LOG_LEVEL || 'info' })
  logger.info('Archive run triggered')

  let client
  try {
    client = await getDbClient(params)
    const metaCol = await client.collection('metadata')
    const recordsCol = await client.collection('records')
    const archivesCol = await client.collection('archives')
    const settingsCol = await client.collection('settings')

    // Load global archival settings
    let globalSettings = null
    try {
      globalSettings = await safeFindOne(settingsCol, { settingsId: 'app-settings' })
    } catch (e) { /* use defaults */ }
    const globalArchival = (globalSettings && globalSettings.archival) || {
      enabled: true,
      defaultThreshold: 50000,
      defaultRetentionDays: 90,
      defaultKeepLatest: 10000,
      archiveFormat: 'csv',
      notifyEmail: '',
      maxArchiveSizeMB: 50,
      autoCleanupExpired: true
    }

    if (!globalArchival.enabled) {
      logger.info('Global archival is disabled. Skipping.')
      return createResponse({ status: 'skipped', reason: 'Global archival disabled' })
    }

    // Initialize aio-lib-files
    const { generateAccessToken } = Core.AuthClient
    const token = await generateAccessToken(params)
    const files = await filesLib.init({ ow: { auth: token.access_token } })

    // Get all active entities
    const allEntities = await metaCol.find({ status: 'active' }).toArray()

    const results = {
      processed: 0,
      archived: 0,
      recordsArchived: 0,
      expiredCleaned: 0,
      errors: [],
      details: []
    }

    // --- Phase 1: Archive entities over threshold ---
    for (const entity of allEntities) {
      try {
        const archivalConfig = entity.archival || {}

        // Skip if archival not enabled for this entity
        if (!archivalConfig.enabled) continue

        results.processed++

        // Resolve effective config (entity override > global default)
        const threshold = archivalConfig.threshold || globalArchival.defaultThreshold
        const keepLatest = archivalConfig.keepLatest || globalArchival.defaultKeepLatest
        const retentionDays = archivalConfig.retentionDays || globalArchival.defaultRetentionDays
        const archiveFormat = archivalConfig.archiveFormat || globalArchival.archiveFormat
        const notifyEmail = archivalConfig.notifyEmail || globalArchival.notifyEmail

        // Get current record count
        const currentCount = await recordsCol.countDocuments({
          entityName: entity.entityName,
          deleted: false,
          status: 'active'
        })

        if (currentCount <= threshold) {
          logger.info(`Entity '${entity.entityName}': ${currentCount}/${threshold} - below threshold, skipping`)
          continue
        }

        // Calculate how many records to archive
        const recordsToArchive = currentCount - keepLatest
        if (recordsToArchive <= 0) continue

        logger.info(`Entity '${entity.entityName}': ${currentCount} records, threshold ${threshold}, archiving ${recordsToArchive}`)

        // Fetch oldest records to archive (sort by createdAt ascending = oldest first)
        const oldRecords = await recordsCol.find({
          entityName: entity.entityName,
          deleted: false,
          status: 'active'
        })
          .sort({ createdAt: 1 })
          .limit(recordsToArchive)
          .toArray()

        if (oldRecords.length === 0) continue

        // Generate archive file content
        const archiveContent = generateArchiveContent(oldRecords, entity.schema, archiveFormat)

        // Generate archive file path and ID
        const archiveId = `arc-${crypto.randomUUID().split('-')[0]}`
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const extension = archiveFormat === 'json' ? 'json' : 'csv'
        const fileName = `${entity.entityName}-archive-${timestamp}.${extension}`
        const filePath = `archives/${entity.entityName}/${fileName}`

        // Upload to aio-lib-files with public access
        const contentBuffer = Buffer.from(archiveContent, 'utf-8')
        await files.write(filePath, contentBuffer)

        // Generate pre-signed public URL (valid for retention period)
        const expiryMs = retentionDays * 24 * 60 * 60 * 1000
        const publicUrl = await files.generatePresignURL(filePath, { expiryInSeconds: Math.min(expiryMs / 1000, 86400 * 365) })

        // Calculate expiry date
        const now = new Date()
        const expiresAt = new Date(now.getTime() + expiryMs).toISOString()

        // Record archive metadata
        const archiveRecord = {
          archiveId,
          entityName: entity.entityName,
          fileName,
          filePath,
          publicUrl,
          recordCount: oldRecords.length,
          sizeBytes: contentBuffer.length,
          format: archiveFormat,
          archivedAt: now.toISOString(),
          expiresAt,
          retentionDays,
          status: 'active',
          triggeredBy: params.__ow_method ? 'manual' : 'schedule',
          oldestRecord: oldRecords[0].createdAt || null,
          newestRecord: oldRecords[oldRecords.length - 1].createdAt || null,
          primaryKeyRange: {
            first: oldRecords[0].primaryKey,
            last: oldRecords[oldRecords.length - 1].primaryKey
          }
        }

        await archivesCol.insertOne(archiveRecord)

        // Delete archived records from DB
        const primaryKeys = oldRecords.map(r => r.primaryKey)

        // Delete in batches of 1000 to avoid timeouts
        const batchSize = 1000
        for (let i = 0; i < primaryKeys.length; i += batchSize) {
          const batch = primaryKeys.slice(i, i + batchSize)
          await recordsCol.deleteMany({
            entityName: entity.entityName,
            primaryKey: { $in: batch }
          })
        }

        // Update entity metadata
        const newCount = await recordsCol.countDocuments({
          entityName: entity.entityName,
          deleted: false,
          status: 'active'
        })
        const totalArchived = (archivalConfig.totalArchived || 0) + oldRecords.length

        await metaCol.updateOne(
          { entityName: entity.entityName },
          {
            $set: {
              recordCount: newCount,
              'archival.lastArchiveAt': now.toISOString(),
              'archival.totalArchived': totalArchived,
              updatedAt: now.toISOString()
            }
          }
        )

        // Audit log
        const auditCol = await client.collection('audit')
        await auditCol.insertOne({
          entityName: entity.entityName,
          operation: 'archive',
          actor: 'system:scheduler',
          status: 'success',
          timestamp: now.toISOString(),
          details: {
            archiveId,
            recordsArchived: oldRecords.length,
            fileName,
            sizeBytes: contentBuffer.length,
            retentionDays,
            expiresAt
          }
        })

        // Send email notification if configured
        if (notifyEmail) {
          await sendNotification(logger, notifyEmail, {
            entity: entity.entityName,
            displayName: entity.displayName,
            recordsArchived: oldRecords.length,
            fileName,
            publicUrl,
            expiresAt,
            threshold,
            currentCount: newCount
          })
        }

        results.archived++
        results.recordsArchived += oldRecords.length
        results.details.push({
          entity: entity.entityName,
          archiveId,
          recordsArchived: oldRecords.length,
          fileName,
          publicUrl,
          expiresAt
        })

        logger.info(`Archived ${oldRecords.length} records from '${entity.entityName}' → ${fileName}`)
      } catch (entityError) {
        logger.error(`Error archiving '${entity.entityName}':`, entityError)
        results.errors.push({
          entity: entity.entityName,
          error: entityError.message
        })
      }
    }

    // --- Phase 2: Cleanup expired archives ---
    if (globalArchival.autoCleanupExpired) {
      try {
        const now = new Date().toISOString()
        const expiredArchives = await archivesCol.find({
          status: 'active',
          expiresAt: { $lt: now }
        }).toArray()

        for (const archive of expiredArchives) {
          try {
            // Delete file from storage
            await files.delete(archive.filePath)

            // Mark as expired
            await archivesCol.updateOne(
              { archiveId: archive.archiveId },
              { $set: { status: 'expired', cleanedAt: now } }
            )

            results.expiredCleaned++
            logger.info(`Cleaned expired archive: ${archive.fileName}`)
          } catch (cleanError) {
            logger.error(`Error cleaning archive ${archive.archiveId}:`, cleanError)
          }
        }
      } catch (cleanupError) {
        logger.error('Error during cleanup phase:', cleanupError)
      }
    }

    logger.info(`Archive run complete: ${results.archived} entities archived, ${results.recordsArchived} records, ${results.expiredCleaned} expired cleaned`)

    return createResponse({
      status: 'success',
      ...results
    })
  } catch (error) {
    logger.error('Archive run failed:', error)
    return createErrorResponse(`Archive run failed: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

// ============ Archive Content Generators ============

function generateArchiveContent (records, schema, format) {
  if (format === 'json') {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      recordCount: records.length,
      records: records.map(r => r.data)
    }, null, 2)
  }

  // Default: CSV
  const fields = schema ? schema.map(s => s.name) : Object.keys(records[0].data || {})

  // Header row
  const lines = [fields.map(f => escapeCsvField(f)).join(',')]

  // Data rows
  for (const record of records) {
    const row = fields.map(f => {
      const val = record.data ? record.data[f] : ''
      return escapeCsvField(val != null ? String(val) : '')
    })
    lines.push(row.join(','))
  }

  return lines.join('\n')
}

function escapeCsvField (field) {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}

// ============ Email Notification ============

async function sendNotification (logger, email, data) {
  // For App Builder, we log the notification intent.
  // In production, integrate with Adobe Campaign, SendGrid, or I/O Events webhook.
  logger.info(`[NOTIFICATION] Archive notification for ${email}:`, JSON.stringify({
    subject: `MDM Archive: ${data.displayName || data.entity} - ${data.recordsArchived} records archived`,
    to: email,
    body: `
Entity: ${data.displayName} (${data.entity})
Records Archived: ${data.recordsArchived.toLocaleString()}
Archive File: ${data.fileName}
Download URL: ${data.publicUrl}
Expires: ${data.expiresAt}
Current Records (after archive): ${data.currentCount.toLocaleString()}
Threshold: ${data.threshold.toLocaleString()}

This archive was created automatically because the entity exceeded its configured threshold.
The download link will expire on ${new Date(data.expiresAt).toLocaleDateString()}.
    `.trim()
  }))

  // TODO: Integrate actual email provider here
  // Example with I/O Events:
  // await Core.Events.publishEvent({ ...emailPayload })
}

// ============ Helpers ============

function createResponse (body, statusCode = 200) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    },
    body
  }
}

function createErrorResponse (message, statusCode = 400) {
  return createResponse({ error: message }, statusCode)
}

exports.main = main
