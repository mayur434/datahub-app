/**
 * MDM Audit Cleanup Action
 * Triggered by the alarm package (scheduled job).
 * Reads app settings to determine retention period, then purges old audit logs.
 *
 * This action is NON-web (triggered by scheduler), so it uses
 * include-ims-credentials to self-authenticate.
 */

const { getDbClient, safeFindOne, COLLECTIONS } = require('../mdm-utils')

async function main (params) {
  console.log('Audit cleanup triggered at:', new Date().toISOString())

  let client
  try {
    client = await getDbClient(params)
    const settingsCol = await client.collection(COLLECTIONS.SETTINGS)
    const auditCol = await client.collection(COLLECTIONS.AUDIT)

    // Read app settings
    const settings = await safeFindOne(settingsCol, { settingsId: 'app-settings' })
    const auditRetention = settings?.auditRetention || { enabled: true, retentionDays: 90, cleanupEnabled: false }

    // Check if cleanup is enabled
    if (!auditRetention.cleanupEnabled) {
      console.log('Audit cleanup is DISABLED in app settings. Skipping.')
      return {
        statusCode: 200,
        body: { status: 'skipped', reason: 'Cleanup disabled in settings' }
      }
    }

    if (!auditRetention.enabled) {
      console.log('Audit retention is DISABLED. Skipping.')
      return {
        statusCode: 200,
        body: { status: 'skipped', reason: 'Audit retention disabled' }
      }
    }

    const retentionDays = auditRetention.retentionDays || 90
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
    const cutoffISO = cutoffDate.toISOString()

    console.log(`Purging audit logs older than ${retentionDays} days (before ${cutoffISO})`)

    // Count logs to be deleted
    const countBefore = await auditCol.countDocuments({ timestamp: { $lt: cutoffISO } })

    if (countBefore === 0) {
      console.log('No expired audit logs found. Nothing to clean up.')
      return {
        statusCode: 200,
        body: { status: 'success', deleted: 0, message: 'No expired logs found' }
      }
    }

    // Delete expired audit logs
    const result = await auditCol.deleteMany({ timestamp: { $lt: cutoffISO } })
    const deletedCount = result.deletedCount || countBefore

    console.log(`Deleted ${deletedCount} audit log(s) older than ${retentionDays} days`)

    // Log the cleanup itself (meta audit)
    await auditCol.insertOne({
      timestamp: new Date().toISOString(),
      entityName: '_system',
      operation: 'audit-cleanup',
      actor: 'scheduler',
      status: 'success',
      details: {
        retentionDays,
        cutoffDate: cutoffISO,
        deletedCount
      }
    })

    return {
      statusCode: 200,
      body: {
        status: 'success',
        deleted: deletedCount,
        retentionDays,
        cutoffDate: cutoffISO,
        message: `Cleaned up ${deletedCount} audit log(s) older than ${retentionDays} days`
      }
    }
  } catch (error) {
    console.error('Audit cleanup error:', error)
    return {
      statusCode: 500,
      body: { status: 'error', message: error.message }
    }
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
