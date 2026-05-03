/**
 * Post-deploy hook — creates alarm triggers and rules in Adobe I/O Runtime.
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

module.exports = () => {
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
}
