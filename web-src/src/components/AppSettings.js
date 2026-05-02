import React, { useState, useEffect } from 'react'
import {
  Heading, View, Flex, Button, Text, ProgressCircle, Divider,
  Switch, NumberField, Well, StatusLight, TextField
} from '@adobe/react-spectrum'
import { useNavigate } from 'react-router-dom'
import { invokeAction } from './actionInvoker'
import { useNotifications } from './NotificationProvider'
import Settings from '@spectrum-icons/workflow/Settings'

function AppSettings ({ runtime, ims }) {
  const navigate = useNavigate()
  const notify = useNotifications()
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Local form state
  const [auditEnabled, setAuditEnabled] = useState(true)
  const [retentionDays, setRetentionDays] = useState(90)
  const [cleanupEnabled, setCleanupEnabled] = useState(false)
  const [enableAuditAlerts, setEnableAuditAlerts] = useState(false)
  const [alertThreshold, setAlertThreshold] = useState(10)

  // Guardrails
  const [maxStorageMB, setMaxStorageMB] = useState(10240)
  const [maxFileSizeMB, setMaxFileSizeMB] = useState(10)

  // Timezone (read-only)
  const [timezone, setTimezone] = useState('Asia/Kolkata')

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings () {
    try {
      setLoading(true)
      const result = await invokeAction('app-settings', {}, ims, 'GET')
      const s = result.settings
      setSettings(s)

      // Populate form
      if (s.audit) {
        setAuditEnabled(s.audit.enabled !== false)
        setRetentionDays(s.audit.retentionDays || 90)
        setCleanupEnabled(s.audit.cleanupEnabled || false)
      } else if (s.auditRetention) {
        // Legacy key fallback
        setAuditEnabled(s.auditRetention.enabled !== false)
        setRetentionDays(s.auditRetention.retentionDays || 90)
        setCleanupEnabled(s.auditRetention.cleanupEnabled || false)
      }
      if (s.notifications) {
        setEnableAuditAlerts(s.notifications.enableAuditAlerts || false)
        setAlertThreshold(s.notifications.alertThreshold || 10)
      }
      if (s.guardrails) {
        setMaxStorageMB(s.guardrails.maxStorageMB || 10240)
        setMaxFileSizeMB(s.guardrails.maxFileSizeMB || 10)
      }
      if (s.general) {
        setTimezone(s.general.timezone || 'Asia/Kolkata')
      }
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave () {
    try {
      setSaving(true)
      const updatedSettings = {
        audit: {
          enabled: auditEnabled,
          retentionDays,
          cleanupEnabled
        },
        guardrails: {
          maxFileSizeMB
        },
        notifications: {
          enableAuditAlerts,
          alertThreshold
        }
      }

      await invokeAction('app-settings', { settings: updatedSettings }, ims, 'POST')
      notify.success('Settings saved successfully')
      await loadSettings()
    } catch (e) {
      notify.error(`Failed to save settings: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleRunCleanupNow () {
    try {
      setSaving(true)
      const result = await invokeAction('audit-cleanup', {}, ims, 'POST')
      if (result.status === 'skipped') {
        notify.info(`Cleanup skipped: ${result.reason}`)
      } else {
        notify.success(`Cleanup complete: ${result.deleted} log(s) removed`)
      }
    } catch (e) {
      notify.error(`Cleanup failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <View UNSAFE_className='mdm-page'>
        <div className='mdm-loading-state'>
          <ProgressCircle aria-label='Loading settings...' isIndeterminate size='L' />
        </div>
      </View>
    )
  }

  if (error) {
    return (
      <View UNSAFE_className='mdm-page'>
        <div className='mdm-empty-state'>
          <div className='mdm-empty-state__icon'>⚠</div>
          <Heading level={2}>Failed to load settings</Heading>
          <Text>{error}</Text>
          <Button variant='primary' marginTop='size-200' onPress={loadSettings}>Retry</Button>
        </div>
      </View>
    )
  }

  return (
    <View UNSAFE_className='mdm-page'>
      <Flex justifyContent='space-between' alignItems='center' marginBottom='size-400'>
        <View>
          <Flex alignItems='center' gap='size-150'>
            <Settings size='L' />
            <Heading level={1} UNSAFE_className='mdm-page__title'>App Settings</Heading>
          </Flex>
          <Text UNSAFE_className='mdm-page__subtitle'>
            Configure application-wide settings for MDM
          </Text>
        </View>
        <Button variant='cta' onPress={handleSave} isDisabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </Flex>

      {/* Audit Retention Section */}
      <View UNSAFE_className='mdm-card' marginBottom='size-300'>
        <Flex alignItems='center' gap='size-150' marginBottom='size-200'>
          <Heading level={3}>Audit Log Retention</Heading>
          <StatusLight variant={cleanupEnabled ? 'positive' : 'neutral'}>
            {cleanupEnabled ? 'Cleanup Active' : 'Cleanup Disabled'}
          </StatusLight>
        </Flex>
        <Text marginBottom='size-200'>
          Configure how long audit logs are retained and whether automatic cleanup is enabled.
          The cleanup job runs daily via the alarm scheduler.
        </Text>
        <Divider size='S' marginBottom='size-200' />

        <Flex direction='column' gap='size-200'>
          <Switch isSelected={auditEnabled} onChange={setAuditEnabled}>
            Enable audit logging
          </Switch>

          <NumberField
            label='Retention period (days)'
            value={retentionDays}
            onChange={setRetentionDays}
            minValue={1}
            maxValue={365}
            step={1}
            width='size-2400'
            isDisabled={!auditEnabled}
          />

          <View>
            <Switch isSelected={cleanupEnabled} onChange={setCleanupEnabled} isDisabled={!auditEnabled}>
              Enable scheduled cleanup
            </Switch>
            <Text UNSAFE_style={{ fontSize: '12px', color: 'var(--spectrum-global-color-gray-600)' }}>
              When enabled, a daily scheduled job will automatically delete audit logs older than the retention period.
            </Text>
          </View>

          <Flex gap='size-100' marginTop='size-100'>
            <Button
              variant='secondary'
              onPress={handleRunCleanupNow}
              isDisabled={saving || !auditEnabled}
            >
              Run Cleanup Now
            </Button>
          </Flex>
        </Flex>
      </View>

      {/* Guardrails Section */}
      <View UNSAFE_className='mdm-card' marginBottom='size-300'>
        <Heading level={3} marginBottom='size-200'>Guardrails</Heading>
        <Text marginBottom='size-200'>
          Manage upload limits for master data files. The total MDM storage capacity is
          fixed at deployment time via the MDM_MAX_STORAGE_MB environment variable.
        </Text>
        <Divider size='S' marginBottom='size-200' />

        <Flex direction='column' gap='size-200'>
          <TextField
            label='MDM Max Storage (MB)'
            value={String(maxStorageMB)}
            isReadOnly
            width='size-2400'
            description='Fixed at deployment — configured via MDM_MAX_STORAGE_MB in .env'
          />
          <NumberField
            label='Max File Size per Upload (MB)'
            value={maxFileSizeMB}
            onChange={setMaxFileSizeMB}
            minValue={1}
            maxValue={Math.min(100, maxStorageMB)}
            step={1}
            width='size-2400'
            description='Maximum CSV file size allowed per upload (1–100 MB)'
          />
          <Well>
            <Text>
              <strong>Potential master files:</strong>{' '}
              {maxFileSizeMB > 0 ? Math.floor(maxStorageMB / maxFileSizeMB) : '—'}
            </Text>
            <Text UNSAFE_style={{ fontSize: '12px', color: 'var(--spectrum-global-color-gray-600)' }}>
              Estimated from ⌊{maxStorageMB} MB ÷ {maxFileSizeMB} MB per file⌋ — actual count depends on record sizes.
            </Text>
          </Well>
        </Flex>
      </View>

      {/* Timezone Section */}
      <View UNSAFE_className='mdm-card' marginBottom='size-300'>
        <Heading level={3} marginBottom='size-200'>Timezone</Heading>
        <Text marginBottom='size-200'>
          The application timezone is set at initialization and cannot be changed.
          All timestamps in audit fields and system records use this timezone.
        </Text>
        <Divider size='S' marginBottom='size-200' />
        <TextField
          label='App Timezone'
          value={timezone}
          isReadOnly
          width='size-3600'
          description='Configured via APP_TIMEZONE in .env at deployment time'
        />
      </View>

      {/* Notifications Section */}
      <View UNSAFE_className='mdm-card' marginBottom='size-300'>
        <Heading level={3} marginBottom='size-200'>Notifications</Heading>
        <Text marginBottom='size-200'>
          Configure alert thresholds and notification preferences.
        </Text>
        <Divider size='S' marginBottom='size-200' />

        <Flex direction='column' gap='size-200'>
          <Switch isSelected={enableAuditAlerts} onChange={setEnableAuditAlerts}>
            Enable audit failure alerts
          </Switch>

          <NumberField
            label='Alert threshold (failures)'
            value={alertThreshold}
            onChange={setAlertThreshold}
            minValue={1}
            maxValue={100}
            step={1}
            width='size-2400'
            isDisabled={!enableAuditAlerts}
          />
        </Flex>
      </View>

      {/* Info Section */}
      <Well marginTop='size-200'>
        <Flex direction='column' gap='size-100'>
          <Text>
            <strong>Scheduler Info:</strong> The audit cleanup job is configured as a cron trigger using the
            App Builder alarm package. It runs daily at 02:00 UTC. When "Enable scheduled cleanup" is ON,
            the job will purge audit logs older than the configured retention period.
          </Text>
          <Text>
            <strong>Guardrails Info:</strong> MDM Max Storage is set at deployment via .env and cannot be changed from the admin console.
            Max File Size per Upload is configurable here. Potential master files = ⌊Max Storage ÷ File Size⌋.
          </Text>
        </Flex>
      </Well>
    </View>
  )
}

export default AppSettings
