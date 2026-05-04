/**
 * Post-deploy hook — creates alarm triggers and rules in Adobe I/O Runtime,
 * and ensures database indexes for system collections.
 *
 * Why this hook exists:
 *   `aio app deploy` only processes the `packages` section of runtimeManifest.
 *   Triggers and rules are namespace-level resources that must be created via
 *   the `aio runtime` CLI.  This hook runs automatically after every deploy
 *   to keep them in sync.
 *
 * Scheduled jobs (maintenance only):
 *   - audit-cleanup-daily  → 2 AM daily  → purge expired audit logs
 *   - archive-run-daily    → 3 AM daily  → archive old records
 *
 * Database Indexes:
 *   - Creates indexes on system collections (metadata, audit, archives, etc.)
 *   - Creates indexes on all existing per-master (mdm_*) collections
 *   - Ensures query performance for filter, sort, and aggregation patterns
 *
 * Dashboard & metrics caching uses on-demand state TTL expiry —
 * no alarm triggers needed. See dashboard/index.js and infra-metrics/index.js.
 */

const { execSync } = require('child_process')

// ─── Configuration ──────────────────────────────────────────────────────────

const TRIGGERS = [
  { name: 'audit-cleanup-daily', cron: '0 2 * * *' },
  { name: 'archive-run-daily', cron: '0 3 * * *' }
]

const RULES = [
  { name: 'audit-cleanup-rule', trigger: 'audit-cleanup-daily', action: 'pimapp/__secured_audit-cleanup' },
  { name: 'archive-run-rule', trigger: 'archive-run-daily', action: 'pimapp/__secured_archive-run' }
]

// ─── Helpers ────────────────────────────────────────────────────────────────

function aio (cmd) {
  try {
    return execSync(`aio ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return null
  }
}

function aioStrict (cmd) {
  try {
    return execSync(`aio ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : e.message
    throw new Error(`aio ${cmd} failed: ${stderr}`)
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

module.exports = async () => {
  console.log('\n⏰  Setting up alarm triggers and rules …')

  // 1. Delete existing rules (ignore errors — they may not exist yet)
  for (const rule of RULES) {
    aio(`runtime rule delete ${rule.name}`)
  }

  // 2. Delete existing triggers (also deregisters the alarm feed)
  for (const trigger of TRIGGERS) {
    aio(`runtime trigger delete ${trigger.name}`)
  }

  // 3. Create alarm triggers
  for (const trigger of TRIGGERS) {
    console.log(`   ✓ trigger  ${trigger.name}  (${trigger.cron})`)
    aioStrict(`runtime trigger create ${trigger.name} --feed /whisk.system/alarms/alarm -p cron "${trigger.cron}"`)
  }

  // 4. Create rules (trigger → __secured_* action)
  for (const rule of RULES) {
    console.log(`   ✓ rule     ${rule.name}  →  ${rule.action}`)
    aioStrict(`runtime rule create ${rule.name} ${rule.trigger} ${rule.action}`)
  }

  console.log('   ✅ Alarm triggers and rules deployed successfully!\n')

  // 5. Ensure database indexes for system collections and master collections
  console.log('📇  Ensuring database indexes …')
  try {
    const libDb = require('@adobe/aio-lib-db')
    const { Core } = require('@adobe/aio-sdk')
    const { generateAccessToken } = Core.AuthClient

    // Read DB_REGION from environment (set in app.config.yaml)
    const region = process.env.DB_REGION || process.env.AIO_DB_REGION || 'apac'
    const token = await generateAccessToken()
    const db = await libDb.init({ token: token.access_token, region })
    const client = await db.connect()

    const safeCreateIndex = async (col, spec, options) => {
      try {
        await col.createIndex(spec, options || {})
      } catch (e) {
        // Index may already exist or collection may not exist yet — skip
      }
    }

    // --- System collection indexes ---

    // metadata collection
    const metaCol = await client.collection('metadata')
    await safeCreateIndex(metaCol, { masterName: 1 }, { unique: true })
    await safeCreateIndex(metaCol, { status: 1 })

    // audit collection
    const auditCol = await client.collection('audit')
    await safeCreateIndex(auditCol, { timestamp: -1 })
    await safeCreateIndex(auditCol, { masterName: 1, timestamp: -1 })
    await safeCreateIndex(auditCol, { status: 1 })
    await safeCreateIndex(auditCol, { type: 1, timestamp: -1 })

    // archives collection
    const archivesCol = await client.collection('archives')
    await safeCreateIndex(archivesCol, { archiveId: 1 }, { unique: true })
    await safeCreateIndex(archivesCol, { masterName: 1, archivedAt: -1 })
    await safeCreateIndex(archivesCol, { status: 1, expiresAt: 1 })

    // app_users collection
    const usersCol = await client.collection('app_users')
    await safeCreateIndex(usersCol, { email: 1 }, { unique: true })
    await safeCreateIndex(usersCol, { status: 1 })

    // app_roles collection
    const rolesCol = await client.collection('app_roles')
    await safeCreateIndex(rolesCol, { roleId: 1 }, { unique: true })

    // partners collection
    const partnersCol = await client.collection('partners')
    await safeCreateIndex(partnersCol, { partnerId: 1 }, { unique: true })
    await safeCreateIndex(partnersCol, { apiKey: 1 })

    // user_sessions collection
    const sessionsCol = await client.collection('user_sessions')
    await safeCreateIndex(sessionsCol, { userId: 1 }, { unique: true })

    // settings collection
    const settingsCol = await client.collection('settings')
    await safeCreateIndex(settingsCol, { settingsId: 1 }, { unique: true })

    console.log('   ✓ System collection indexes ensured')

    // --- Per-master collection indexes ---
    // Find all active masters and ensure their collections have proper indexes
    try {
      const allMeta = await metaCol.find({ status: { $ne: 'deleted' } }).toArray()
      for (const meta of allMeta) {
        try {
          const masterCol = await client.collection(`mdm_${meta.masterName}`)

          // Core indexes
          await safeCreateIndex(masterCol, { primaryKey: 1 }, { unique: true })
          await safeCreateIndex(masterCol, { deleted: 1, primaryKey: 1 })
          await safeCreateIndex(masterCol, { deleted: 1, status: 1, createdAt: 1 })

          // Index for primary key data field (used in sort)
          if (meta.primaryKey) {
            await safeCreateIndex(masterCol, { [`data.${meta.primaryKey}`]: 1 })
          }

          // Queryable field indexes
          const queryableFields = (meta.schema || []).filter(f => f.queryable).map(f => f.name)
          for (const field of queryableFields) {
            await safeCreateIndex(masterCol, { [`data.${field}`]: 1 })
          }

          // Facetable field indexes
          const facetableFields = (meta.schema || []).filter(f => f.facetable).map(f => f.name)
          for (const field of facetableFields) {
            if (!queryableFields.includes(field)) {
              await safeCreateIndex(masterCol, { [`data.${field}`]: 1 })
            }
          }

          console.log(`   ✓ Indexes ensured for mdm_${meta.masterName}`)
        } catch (e) {
          console.warn(`   ⚠ Failed to index mdm_${meta.masterName}: ${e.message}`)
        }
      }
    } catch (e) {
      console.warn('   ⚠ Could not enumerate masters for indexing:', e.message)
    }

    await client.close()
    console.log('   ✅ Database indexes ensured!\n')
  } catch (e) {
    // Index creation is best-effort — don't fail the deploy
    console.warn(`   ⚠ Database index setup skipped: ${e.message}\n`)
  }
}
