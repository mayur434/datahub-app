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
 * Infra Metrics Cache (aio-lib-state):
 *   - Pre-computes ALL infra-metrics sections (overview, storage, guardrails,
 *     failures, analytics, usage, configuration)
 *   - Stores in aio-lib-state with configurable TTL (INFRA_METRICS_CACHE_TTL_MINUTES)
 *   - The infra-metrics action serves from state only — zero DB impact
 *   - Refreshed on every deploy; manual refresh via forceRefresh=true
 *
 * Dashboard & metrics caching uses on-demand state TTL expiry —
 * no alarm triggers needed. See dashboard/index.js.
 */

const { execSync } = require('child_process')
const path = require('path')

// Load .env — aio CLI does not inject S2S credentials into hook process.env
try { require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') }) } catch (e) { /* dotenv not available — env vars must be set externally */ }

// Map .env vars to the __OW_* env vars that aio-lib-db and aio-lib-state expect
if (!process.env.__OW_NAMESPACE && process.env.AIO_runtime_namespace) {
  process.env.__OW_NAMESPACE = process.env.AIO_runtime_namespace
}
if (!process.env.__OW_API_KEY && process.env.AIO_runtime_auth) {
  process.env.__OW_API_KEY = process.env.AIO_runtime_auth
}

// ─── Configuration ──────────────────────────────────────────────────────────

const TRIGGERS = [
  { name: 'audit-cleanup-daily', cron: '0 2 * * *' },
  { name: 'archive-run-daily', cron: '0 3 * * *' }
]

const RULES = [
  { name: 'audit-cleanup-rule', trigger: 'audit-cleanup-daily', action: 'datahub/__secured_audit-cleanup' },
  { name: 'archive-run-rule', trigger: 'archive-run-daily', action: 'datahub/__secured_archive-run' }
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

    // Build S2S credentials from .env (aio CLI doesn't inject these into hook context)
    let scopes = process.env.IMS_OAUTH_S2S_SCOPES || '[]'
    try { scopes = JSON.parse(scopes) } catch (e) { /* keep as string */ }
    const token = await generateAccessToken({
      clientId: process.env.IMS_OAUTH_S2S_CLIENT_ID || process.env.SERVICE_API_KEY,
      clientSecret: process.env.IMS_OAUTH_S2S_CLIENT_SECRET,
      orgId: process.env.IMS_OAUTH_S2S_ORG_ID,
      scopes
    })
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

    console.log('   ✅ Database indexes ensured!\n')

    // ─── Pre-compute infra metrics and seed aio-lib-state ──────────────
    console.log('📊  Pre-computing infra metrics for Admin Console …')
    try {
      await seedInfraMetricsCache(client)
      console.log('   ✅ Infra metrics cached in aio-lib-state!\n')
    } catch (e) {
      console.warn(`   ⚠ Infra metrics caching skipped: ${e.message}\n`)
    }

    await client.close()
  } catch (e) {
    // Index creation + metrics caching is best-effort — don't fail the deploy
    console.warn(`   ⚠ Database setup skipped: ${e.message}\n`)
  }
}

/**
 * Pre-compute all infra-metrics sections and store in aio-lib-state.
 * Runs once per deploy — the infra-metrics action then serves from state
 * without any DB connections (~0.3s vs ~5-6s).
 */
async function seedInfraMetricsCache (client) {
  const stateLib = require('@adobe/aio-lib-state')
  const infraMetrics = require('../actions/infra-metrics/index.js')

  const CACHE_TTL = Number(process.env.INFRA_METRICS_CACHE_TTL_MINUTES || 30) * 60
  const prefix = infraMetrics.METRICS_CACHE_PREFIX

  // Build env config from process.env (mirrors getEnvConfig output)
  const env = {
    dbRegion: process.env.DB_REGION || 'apac',
    appTimezone: process.env.APP_TIMEZONE || 'UTC',
    mdmMaxStorageMB: Number(process.env.MDM_MAX_STORAGE_MB || 250),
    metricsCacheTTLMinutes: Number(process.env.METRICS_CACHE_TTL_MINUTES || 15),
    infraMetricsCacheTTLMinutes: Number(process.env.INFRA_METRICS_CACHE_TTL_MINUTES || 30),
    defaultPageSize: Number(process.env.DEFAULT_PAGE_SIZE || 25),
    maxPageSize: Number(process.env.MAX_PAGE_SIZE || 200),
    rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE || 100),
    apiMeshCacheTTL: Number(process.env.API_MESH_CACHE_TTL || 300),
    maxSchemaFields: Number(process.env.MAX_SCHEMA_FIELDS || 50),
    bulkBatchSize: Number(process.env.BULK_BATCH_SIZE || 500),
    queryTimeout: Number(process.env.QUERY_TIMEOUT || 10000),
    auditRetentionDays: Number(process.env.AUDIT_RETENTION_DAYS || 90),
    archiveRetentionDays: Number(process.env.ARCHIVE_RETENTION_DAYS || 365)
  }

  // Load settings from DB
  const settingsCol = await client.collection('settings')
  let settings = {}
  try {
    const docs = await settingsCol.find({ settingsId: 'app-settings' }).toArray()
    settings = (docs && docs.length > 0) ? docs[0] : {}
  } catch (_) { /* no settings yet — use empty */ }

  const tierLimits = {
    maxStorageMB: 250,
    maxDocuments: 500000,
    maxCollections: 20,
    maxDocumentSizeKB: 512,
    actionMemoryMB: 256,
    actionTimeoutMs: env.queryTimeout,
    ...(settings.guardrails || {}),
    ...(settings.infrastructure || {})
  }

  // Compute all sections — overview computes storage once and reuses it
  const storage = await infraMetrics.collectStorageMetrics(client, tierLimits)

  const [guardrails, failures, analytics, usage] = await Promise.all([
    infraMetrics.collectGuardrailStatus(client, settings, tierLimits, env, storage),
    infraMetrics.collectFailureReport(client, { days: 30 }),
    infraMetrics.collectAnalytics(client, { days: 30 }),
    infraMetrics.collectUsageMetrics(client, settings, tierLimits, env, storage)
  ])

  // Build overview from already-computed sections (no extra DB calls)
  const meshConfig = {
    cacheTTL: env.apiMeshCacheTTL,
    rateLimitPerMinute: env.rateLimitPerMinute,
    enableCORS: settings.api?.enableCORS !== false,
    corsOrigins: settings.api?.corsOrigins || '*',
    maxPageSize: settings.api?.maxPageSize || env.maxPageSize
  }
  const now = new Date().toISOString()

  const overview = {
    timestamp: now,
    storage,
    guardrails,
    failures: { summary: failures.summary, recentFailures: failures.recentFailures.slice(0, 10) },
    usage,
    apiMesh: meshConfig,
    health: {
      database: storage.summary.status === 'critical' ? 'degraded' : 'healthy',
      guardrails: guardrails.overallStatus,
      operations: failures.summary.failureRate > 10 ? 'degraded' : 'healthy',
      apiMesh: meshConfig.cacheTTL > 0 ? 'healthy' : 'degraded'
    }
  }

  // Build configuration section from settings + env
  const configuration = infraMetrics.buildConfiguration(settings, tierLimits, env)

  // Store each section + combined 'all' in aio-lib-state with TTL
  const state = await stateLib.init()

  const allData = {
    timestamp: now,
    storage, guardrails, failures, analytics, usage,
    configuration, apiMesh: meshConfig,
    health: {
      database: storage.summary.status === 'critical' ? 'degraded' : 'healthy',
      guardrails: guardrails.overallStatus,
      operations: failures.summary.failureRate > 10 ? 'degraded' : 'healthy',
      apiMesh: meshConfig.cacheTTL > 0 ? 'healthy' : 'degraded'
    }
  }

  const sections = {
    all: allData,
    overview,
    storage: { storage },
    guardrails: { guardrails },
    failures: { failures },
    analytics: { analytics },
    usage: { usage },
    configuration: { configuration }
  }

  for (const [section, data] of Object.entries(sections)) {
    const key = `${prefix}-${section}`
    const cacheDoc = { data: { ...data, _cached: false, _cachedAt: now }, cachedAt: now }
    await state.put(key, JSON.stringify(cacheDoc), { ttl: CACHE_TTL })
    console.log(`   ✓ Cached ${section} (TTL: ${CACHE_TTL}s)`)
  }
}
