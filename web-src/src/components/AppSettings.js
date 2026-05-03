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
  const [archiveRetentionDays, setArchiveRetentionDays] = useState(365)
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

      // Populate form — all values come from server (env-enforced), no local fallbacks
      if (s.audit) {
        setAuditEnabled(s.audit.enabled !== false)
        setRetentionDays(s.audit.retentionDays)
        setArchiveRetentionDays(s.audit.archiveRetentionDays)
      }
      if (s.notifications) {
        setEnableAuditAlerts(s.notifications.enableAuditAlerts || false)
        setAlertThreshold(s.notifications.alertThreshold)
      }
      if (s.guardrails) {
        setMaxStorageMB(s.guardrails.maxStorageMB)
        setMaxFileSizeMB(s.guardrails.maxFileSizeMB)
      }
      if (s.general) {
        setTimezone(s.general.timezone)
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
          enabled: auditEnabled
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

      {/* Audit Section */}
      <View UNSAFE_className='mdm-card' marginBottom='size-300'>
        <Flex alignItems='center' gap='size-150' marginBottom='size-200'>
          <Heading level={3}>Auditing</Heading>
          <StatusLight variant={auditEnabled ? 'positive' : 'negative'}>
            {auditEnabled ? 'Enabled' : 'Disabled'}
          </StatusLight>
        </Flex>
        <Text marginBottom='size-200'>
          When enabled, all data operations (uploads, updates, deletes, schema changes) are logged to the audit trail.
          Disabling stops all audit writes across every action — saves DB space and reduces overhead.
        </Text>
        <Divider size='S' marginBottom='size-200' />

        <Flex direction='column' gap='size-200'>
          <Switch isSelected={auditEnabled} onChange={setAuditEnabled}>
            Enable Auditing
          </Switch>

          <NumberField
            label='Log retention period (days)'
            value={retentionDays}
            onChange={setRetentionDays}
            minValue={1}
            maxValue={730}
            step={1}
            width='size-2400'
            isReadOnly
            description='Fixed at deployment — configured via AUDIT_RETENTION_DAYS in .env'
          />

          <NumberField
            label='Archive retention period (days)'
            value={archiveRetentionDays}
            onChange={setArchiveRetentionDays}
            minValue={1}
            maxValue={3650}
            step={1}
            width='size-2400'
            isReadOnly
            description='Fixed at deployment — configured via ARCHIVE_RETENTION_DAYS in .env'
          />

          <Well UNSAFE_style={{ fontSize: '13px' }}>
            <Text>
              <strong>How it works:</strong> When auditing is ON, a daily scheduler (02:00 UTC) archives logs older
              than {retentionDays} days as compressed CSV files, then purges archive files older than {archiveRetentionDays} days.
              Use the buttons on the Activity Log page to run either phase manually.
            </Text>
          </Well>
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
            <strong>Scheduler Info:</strong> The audit cleanup job runs daily at 02:00 UTC via the
            App Builder alarm package. When auditing is ON, the job archives expired logs as compressed
            CSV files and purges old archives automatically. Use the Activity Log page to run either
            phase on demand.
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
