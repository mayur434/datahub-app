import React, { useState, useEffect } from 'react'
import {
  Heading, View, Flex, Button, Text, ProgressCircle, Well, Divider,
  StatusLight, NumberField, TextField, Switch, Picker, Item,
  ActionButton, DialogTrigger, Dialog, Content, ButtonGroup
} from '@adobe/react-spectrum'
import { useParams, useNavigate } from 'react-router-dom'
import { invokeAction } from './actionInvoker'
import { useNotifications } from './NotificationProvider'
import Download from '@spectrum-icons/workflow/Download'
import Delete from '@spectrum-icons/workflow/Delete'
import Settings from '@spectrum-icons/workflow/Settings'

function ArchiveManager ({ runtime, ims }) {
  const { master } = useParams()
  const navigate = useNavigate()
  const notify = useNotifications()

  const [archives, setArchives] = useState([])
  const [summary, setSummary] = useState(null)
  const [pagination, setPagination] = useState(null)
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [archiving, setArchiving] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)

  // Config form state
  const [cfgEnabled, setCfgEnabled] = useState(false)
  const [cfgThreshold, setCfgThreshold] = useState(50000)
  const [cfgRetention, setCfgRetention] = useState(90)
  const [cfgKeepLatest, setCfgKeepLatest] = useState(10000)
  const [cfgFormat, setCfgFormat] = useState('csv')
  const [cfgEmail, setCfgEmail] = useState('')

  useEffect(() => {
    loadData()
  }, [master, page])

  async function loadData () {
    try {
      setLoading(true)
      const [archiveResult, configResult] = await Promise.all([
        invokeAction('archive-list', { master, page, pageSize: 20 }, ims, 'GET'),
        invokeAction('archive-config', { master }, ims, 'GET')
      ])

      setArchives(archiveResult.archives || [])
      setSummary(archiveResult.summary || null)
      setPagination(archiveResult.pagination || null)

      setConfig(configResult)
      const eff = configResult.effectiveConfig || {}
      setCfgEnabled(eff.enabled || false)
      setCfgThreshold(eff.threshold || 50000)
      setCfgRetention(eff.retentionDays || 90)
      setCfgKeepLatest(eff.keepLatest || 10000)
      setCfgFormat(eff.archiveFormat || 'csv')
      setCfgEmail(eff.notifyEmail || '')

      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveConfig () {
    try {
      setSavingConfig(true)
      await invokeAction('archive-config', {
        master,
        archival: {
          enabled: cfgEnabled,
          threshold: cfgThreshold,
          retentionDays: cfgRetention,
          keepLatest: cfgKeepLatest,
          archiveFormat: cfgFormat,
          notifyEmail: cfgEmail
        }
      }, ims, 'POST')
      notify.success('Archive configuration saved')
      setShowConfig(false)
      await loadData()
    } catch (e) {
      notify.error(`Failed to save config: ${e.message}`)
    } finally {
      setSavingConfig(false)
    }
  }

  async function handleRunNow () {
    try {
      setArchiving(true)
      const result = await invokeAction('archive-run', { master }, ims, 'POST')
      if (result.archived > 0) {
        notify.success(`Archived ${result.recordsArchived} records from ${result.archived} master(s)`)
      } else {
        notify.info('No masters exceeded their archive threshold')
      }
      await loadData()
    } catch (e) {
      notify.error(`Archive run failed: ${e.message}`)
    } finally {
      setArchiving(false)
    }
  }

  function formatBytes (bytes) {
    if (!bytes) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    let i = 0
    let val = bytes
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++ }
    return `${val.toFixed(1)} ${units[i]}`
  }

  function formatDate (iso) {
    if (!iso) return '-'
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    })
  }

  if (loading && archives.length === 0) {
    return (
      <View UNSAFE_className='mdm-page'>
        <div className='mdm-loading-state'>
          <ProgressCircle aria-label='Loading archives...' isIndeterminate size='L' />
        </div>
      </View>
    )
  }

  return (
    <View UNSAFE_className='mdm-page'>
      <Flex justifyContent='space-between' alignItems='center' marginBottom='size-300'>
        <View>
          <Heading level={1} UNSAFE_className='mdm-page__title'>
            Archives{master ? `: ${config?.displayName || master}` : ''}
          </Heading>
          <Text UNSAFE_className='mdm-page__subtitle'>
            {master
              ? `Manage backups and archival for this master • ${config?.recordCount?.toLocaleString() || 0} current records`
              : 'View all master archives and backups'
            }
          </Text>
        </View>
        <Flex gap='size-100'>
          {master && (
            <Button variant='secondary' onPress={() => navigate(`/masters/${master}`)}>
              Back to Master
            </Button>
          )}
          <Button variant='secondary' onPress={() => setShowConfig(!showConfig)}>
            <Settings size='S' />
            <Text>Configure</Text>
          </Button>
          <Button variant='accent' onPress={handleRunNow} isDisabled={archiving}>
            {archiving ? 'Running...' : 'Run Archive Now'}
          </Button>
        </Flex>
      </Flex>

      {error && (
        <Well marginBottom='size-200' UNSAFE_className='mdm-alert mdm-alert--error'>
          <Text>{error}</Text>
        </Well>
      )}

      {/* Configuration Panel */}
      {showConfig && (
        <View UNSAFE_className='mdm-card' marginBottom='size-300'>
          <Heading level={3} marginBottom='size-200'>Archival Configuration</Heading>
          <Text UNSAFE_className='mdm-text-muted' marginBottom='size-200'>
            Configure when this master's records should be archived.
            When record count exceeds the threshold, oldest records are exported to file storage and removed from the database.
          </Text>
          <Divider marginBottom='size-200' />

          <Flex direction='column' gap='size-200'>
            <Switch isSelected={cfgEnabled} onChange={setCfgEnabled}>
              Enable automatic archival for this master
            </Switch>

            <Flex gap='size-300' wrap>
              <NumberField
                label='Record Threshold'
                value={cfgThreshold}
                onChange={setCfgThreshold}
                minValue={100}
                maxValue={10000000}
                step={1000}
                width='size-2400'
                isDisabled={!cfgEnabled}
                description='Archive when total records exceed this count'
              />
              <NumberField
                label='Keep Latest Records'
                value={cfgKeepLatest}
                onChange={setCfgKeepLatest}
                minValue={0}
                maxValue={10000000}
                step={1000}
                width='size-2400'
                isDisabled={!cfgEnabled}
                description='How many recent records to retain after archival'
              />
              <NumberField
                label='Retention Period (days)'
                value={cfgRetention}
                onChange={setCfgRetention}
                minValue={1}
                maxValue={3650}
                step={1}
                width='size-2400'
                isDisabled={!cfgEnabled}
                description='How long archived files are kept before auto-deletion'
              />
            </Flex>

            <Flex gap='size-300' wrap>
              <Picker label='Archive Format' selectedKey={cfgFormat} onSelectionChange={setCfgFormat}
                isDisabled={!cfgEnabled} width='size-2400'>
                <Item key='csv'>CSV</Item>
                <Item key='json'>JSON</Item>
              </Picker>
              <TextField
                label='Notification Email'
                value={cfgEmail}
                onChange={setCfgEmail}
                width='size-3600'
                isDisabled={!cfgEnabled}
                description='Receive email with download link when archival runs'
              />
            </Flex>

            <Flex gap='size-100' marginTop='size-100'>
              <Button variant='cta' onPress={handleSaveConfig} isDisabled={savingConfig}>
                {savingConfig ? 'Saving...' : 'Save Configuration'}
              </Button>
              <Button variant='secondary' onPress={() => setShowConfig(false)}>Cancel</Button>
            </Flex>
          </Flex>
        </View>
      )}

      {/* Summary Cards */}
      {summary && (
        <Flex gap='size-200' marginBottom='size-300' wrap>
          <View UNSAFE_className='mdm-card' flex='1' minWidth='size-2400'>
            <Text UNSAFE_className='mdm-text-muted'>Total Archives</Text>
            <Heading level={2}>{summary.totalArchives}</Heading>
          </View>
          <View UNSAFE_className='mdm-card' flex='1' minWidth='size-2400'>
            <Text UNSAFE_className='mdm-text-muted'>Records Archived</Text>
            <Heading level={2}>{summary.totalRecordsArchived?.toLocaleString()}</Heading>
          </View>
          <View UNSAFE_className='mdm-card' flex='1' minWidth='size-2400'>
            <Text UNSAFE_className='mdm-text-muted'>Storage Used</Text>
            <Heading level={2}>{formatBytes(summary.totalSizeBytes)}</Heading>
          </View>
          <View UNSAFE_className='mdm-card' flex='1' minWidth='size-2400'>
            <Text UNSAFE_className='mdm-text-muted'>Active / Expired</Text>
            <Heading level={2}>{summary.activeCount} / {summary.expiredCount}</Heading>
          </View>
        </Flex>
      )}

      {/* Archive List Table */}
      {archives.length === 0 ? (
        <View UNSAFE_className='mdm-card'>
          <div className='mdm-empty-state'>
            <div className='mdm-empty-state__icon'>📦</div>
            <Heading level={3}>No Archives Yet</Heading>
            <Text>Archives will appear here when master records exceed the configured threshold.</Text>
            {!cfgEnabled && (
              <Button variant='primary' marginTop='size-200' onPress={() => setShowConfig(true)}>
                Enable Archival
              </Button>
            )}
          </div>
        </View>
      ) : (
        <div className='mdm-table-container'>
          <table className='mdm-table mdm-table--hoverable'>
            <thead>
              <tr>
                <th>Archive</th>
                {!master && <th>Master</th>}
                <th>Records</th>
                <th>Size</th>
                <th>Archived On</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {archives.map(archive => (
                <tr key={archive.archiveId}>
                  <td>
                    <div>
                      <Text><strong>{archive.fileName}</strong></Text>
                      <Text UNSAFE_className='mdm-text-muted' UNSAFE_style={{ fontSize: '11px' }}>
                        {archive.archiveId}
                      </Text>
                    </div>
                  </td>
                  {!master && (
                    <td>
                      <button className='mdm-entity-cell__link'
                        onClick={() => navigate(`/masters/${archive.masterName}/archives`)}>
                        {archive.masterDisplayName || archive.masterName}
                      </button>
                    </td>
                  )}
                  <td><Text UNSAFE_className='mdm-text-mono'>{archive.recordCount?.toLocaleString()}</Text></td>
                  <td>{formatBytes(archive.sizeBytes)}</td>
                  <td>{formatDate(archive.archivedAt)}</td>
                  <td>
                    <Flex direction='column'>
                      <Text>{formatDate(archive.expiresAt)}</Text>
                      {archive.daysUntilExpiry > 0 && (
                        <Text UNSAFE_className='mdm-text-muted' UNSAFE_style={{ fontSize: '11px' }}>
                          {archive.daysUntilExpiry} days left
                        </Text>
                      )}
                    </Flex>
                  </td>
                  <td>
                    {archive.isExpired || archive.status === 'expired'
                      ? <StatusLight variant='negative'>Expired</StatusLight>
                      : <StatusLight variant='positive'>Active</StatusLight>
                    }
                  </td>
                  <td>
                    <Flex gap='size-50'>
                      {archive.publicUrl && archive.status === 'active' && !archive.isExpired && (
                        <ActionButton isQuiet onPress={() => window.open(archive.publicUrl, '_blank')}>
                          <Download size='S' />
                        </ActionButton>
                      )}
                    </Flex>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <Flex justifyContent='center' gap='size-100' marginTop='size-200'>
              <Button variant='secondary' isQuiet isDisabled={page <= 1} onPress={() => setPage(p => p - 1)}>
                Previous
              </Button>
              <Text UNSAFE_className='mdm-text-muted'>
                Page {pagination.page} of {pagination.totalPages}
              </Text>
              <Button variant='secondary' isQuiet isDisabled={page >= pagination.totalPages} onPress={() => setPage(p => p + 1)}>
                Next
              </Button>
            </Flex>
          )}
        </div>
      )}

      {/* Effective Config Summary */}
      {config && config.effectiveConfig && (
        <View marginTop='size-300'>
          <Well>
            <Flex gap='size-400' wrap>
              <View>
                <Text UNSAFE_className='mdm-text-muted'>Status</Text>
                <StatusLight variant={config.effectiveConfig.enabled ? 'positive' : 'neutral'}>
                  {config.effectiveConfig.enabled ? 'Enabled' : 'Disabled'}
                </StatusLight>
              </View>
              <View>
                <Text UNSAFE_className='mdm-text-muted'>Threshold</Text>
                <Text><strong>{config.effectiveConfig.threshold?.toLocaleString()}</strong> records</Text>
              </View>
              <View>
                <Text UNSAFE_className='mdm-text-muted'>Keep Latest</Text>
                <Text><strong>{config.effectiveConfig.keepLatest?.toLocaleString()}</strong> records</Text>
              </View>
              <View>
                <Text UNSAFE_className='mdm-text-muted'>Retention</Text>
                <Text><strong>{config.effectiveConfig.retentionDays}</strong> days</Text>
              </View>
              <View>
                <Text UNSAFE_className='mdm-text-muted'>Last Archive</Text>
                <Text>{config.effectiveConfig.lastArchiveAt ? formatDate(config.effectiveConfig.lastArchiveAt) : 'Never'}</Text>
              </View>
              <View>
                <Text UNSAFE_className='mdm-text-muted'>Total Archived</Text>
                <Text><strong>{(config.effectiveConfig.totalArchived || 0).toLocaleString()}</strong> records</Text>
              </View>
            </Flex>
          </Well>
        </View>
      )}
    </View>
  )
}

export default ArchiveManager
