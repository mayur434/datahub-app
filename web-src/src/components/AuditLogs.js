import React, { useState, useEffect } from 'react'
import {
  Heading, View, Flex, Button, TextField, Text, ProgressCircle,
  Picker, Item, ActionButton, StatusLight, Badge, Well, Tabs, TabList, TabPanels
} from '@adobe/react-spectrum'
import { useNavigate } from 'react-router-dom'
import { fetchAuditLogs, fetchFileList, fetchAuditArchives, triggerAuditCleanup, triggerArchivePurge } from './actionInvoker'
import { useDebounce } from './useDebounce'
import { useNotifications } from './NotificationProvider'
import Refresh from '@spectrum-icons/workflow/Refresh'
import Download from '@spectrum-icons/workflow/Download'

function AuditLogs ({ runtime, ims }) {
  const navigate = useNavigate()
  const notify = useNotifications()
  const [logs, setLogs] = useState([])
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [total, setTotal] = useState(0)

  // Filters
  const [filterMaster, setFilterMaster] = useState('')
  const [filterUser, setFilterUser] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // Archives state
  const [archives, setArchives] = useState([])
  const [archivesSummary, setArchivesSummary] = useState({})
  const [archivesLoading, setArchivesLoading] = useState(false)
  const [archivesTotal, setArchivesTotal] = useState(0)
  const [archivesPage, setArchivesPage] = useState(1)
  const [cleanupRunning, setCleanupRunning] = useState(false)
  const [purgeRunning, setPurgeRunning] = useState(false)

  // Active tab
  const [activeTab, setActiveTab] = useState('logs')

  // Debounce text filters to avoid excessive API calls
  const debouncedUser = useDebounce(filterUser, 400)

  useEffect(() => {
    loadEntities()
  }, [])

  useEffect(() => {
    loadLogs()
  }, [filterMaster, debouncedUser, filterAction, page])

  useEffect(() => {
    if (activeTab === 'archives') loadArchives()
  }, [activeTab, archivesPage])

  async function loadEntities () {
    try {
      const result = await fetchFileList(ims)
      setEntities(result.files || [])
    } catch (e) {
      console.error('Failed to load entities', e)
    }
  }

  async function loadLogs () {
    try {
      setLoading(true)
      const filters = {}
      if (filterMaster) filters.master = filterMaster
      if (filterUser) filters.user = filterUser
      if (filterAction) filters.action = filterAction
      filters.page = page
      filters.pageSize = pageSize

      const result = await fetchAuditLogs(filters, ims)
      setLogs(result.logs || [])
      setTotal(result.total || 0)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function handleClearFilters () {
    setFilterMaster('')
    setFilterUser('')
    setFilterAction('')
    setPage(1)
  }

  async function loadArchives () {
    try {
      setArchivesLoading(true)
      const result = await fetchAuditArchives({ page: archivesPage, pageSize: 10 }, ims)
      setArchives(result.archives || [])
      setArchivesSummary(result.summary || {})
      setArchivesTotal(result.total || 0)
    } catch (e) {
      console.error('Failed to load audit archives:', e)
    } finally {
      setArchivesLoading(false)
    }
  }

  async function handleRunCleanup () {
    try {
      setCleanupRunning(true)
      const result = await triggerAuditCleanup(ims)
      if (result.status === 'skipped') {
        notify.info(`Cleanup skipped: ${result.reason}`)
      } else if (result.archived) {
        notify.success(`Archived ${result.archived.recordCount} log(s) to ${result.archived.fileName}`)
        loadLogs()
        loadArchives()
      } else {
        notify.info('No expired logs to archive')
      }
    } catch (e) {
      notify.error(`Archive failed: ${e.message}`)
    } finally {
      setCleanupRunning(false)
    }
  }

  async function handleRunPurge () {
    try {
      setPurgeRunning(true)
      const result = await triggerArchivePurge(ims)
      if (result.status === 'skipped') {
        notify.info(`Purge skipped: ${result.reason}`)
      } else if (result.purgedArchives > 0) {
        notify.success(`Purged ${result.purgedArchives} expired archive(s)`)
        loadArchives()
      } else {
        notify.info('No expired archives to purge')
      }
    } catch (e) {
      notify.error(`Purge failed: ${e.message}`)
    } finally {
      setPurgeRunning(false)
    }
  }

  function formatBytes (bytes) {
    if (!bytes || bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const totalPages = Math.ceil(total / pageSize)
  const archivesTotalPages = Math.ceil(archivesTotal / 10)

  return (
    <View UNSAFE_className='mdm-page'>
      <Flex justifyContent='space-between' alignItems='center' marginBottom='size-300'>
        <View>
          <Heading level={1} UNSAFE_className='mdm-page__title'>Activity Log</Heading>
          <Text UNSAFE_className='mdm-page__subtitle'>Audit trail &amp; archived logs</Text>
        </View>
        <Flex gap='size-100'>
          <Button variant='secondary' onPress={handleRunCleanup} isDisabled={cleanupRunning || purgeRunning}>
            {cleanupRunning ? 'Running…' : 'Run Log Retention Now'}
          </Button>
          <Button variant='negative' onPress={handleRunPurge} isDisabled={purgeRunning || cleanupRunning}>
            {purgeRunning ? 'Running…' : 'Run Archive Retention Now'}
          </Button>
          <ActionButton isQuiet onPress={() => { loadLogs(); if (activeTab === 'archives') loadArchives() }}>
            <Refresh /><Text>Refresh</Text>
          </ActionButton>
        </Flex>
      </Flex>

      {error && (
        <div className='mdm-alert mdm-alert--error' style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 6 }}>
          <Text>{error}</Text>
        </div>
      )}

      <Tabs aria-label='Audit tabs' selectedKey={activeTab} onSelectionChange={setActiveTab}>
        <TabList>
          <Item key='logs'>Activity Log ({total})</Item>
          <Item key='archives'>Archives ({archivesTotal})</Item>
        </TabList>
        <TabPanels>
          {/* ─── Activity Log Tab ─── */}
          <Item key='logs'>
            <View marginTop='size-200'>
              {/* Filters */}
              <View UNSAFE_className='mdm-toolbar' marginBottom='size-200'>
                <Flex gap='size-200' alignItems='end' wrap>
                  <Picker label='Master' selectedKey={filterMaster} onSelectionChange={setFilterMaster} width='size-2000'>
                    <Item key=''>All Masters</Item>
                    {entities.map(e => <Item key={e.masterName || e.entity}>{e.displayName || e.masterName || e.entity}</Item>)}
                  </Picker>
                  <TextField label='User' value={filterUser} onChange={setFilterUser} placeholder='email' width='size-2400' />
                  <Picker label='Action' selectedKey={filterAction} onSelectionChange={setFilterAction} width='size-2000'>
                    <Item key=''>All Actions</Item>
                    <Item key='upload'>Upload</Item>
                    <Item key='create'>Create</Item>
                    <Item key='update'>Update</Item>
                    <Item key='delete'>Delete</Item>
                    <Item key='rollback'>Rollback</Item>
                    <Item key='schema-update'>Schema Update</Item>
                    <Item key='bulk-update'>Bulk Update</Item>
                    <Item key='delta-update'>Delta Update</Item>
                    <Item key='full-update'>Full Update</Item>
                    <Item key='visibility-update'>Visibility Update</Item>
                  </Picker>
                  <Button variant='secondary' onPress={handleClearFilters}>Clear</Button>
                </Flex>
              </View>

              {loading ? (
                <div className='mdm-loading-state'>
                  <ProgressCircle aria-label='Loading...' isIndeterminate size='L' />
                </div>
              ) : logs.length === 0 ? (
                <div className='mdm-empty-state'>
                  <div className='mdm-empty-state__icon'>📋</div>
                  <Heading level={2}>No audit entries</Heading>
                  <Text>No entries match the current filters.</Text>
                </div>
              ) : (
                <>
                  <div className='mdm-table-container'>
                    <table className='mdm-table mdm-table--hoverable'>
                      <thead>
                        <tr>
                          <th>Timestamp</th>
                          <th>Master</th>
                          <th>Action</th>
                          <th>User</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs.map(log => (
                          <tr key={log.id}>
                            <td><Text UNSAFE_className='mdm-text-muted'>{log.timestamp ? new Date(log.timestamp).toLocaleString() : '-'}</Text></td>
                            <td>
                              <button className='mdm-entity-cell__link' onClick={() => navigate(`/masters/${log.master || log.entity}`)}>
                                {log.master || log.entity}
                              </button>
                            </td>
                            <td><code className='mdm-code-inline'>{log.action}</code></td>
                            <td>{log.user}</td>
                            <td>
                              <Text UNSAFE_className='mdm-text-muted'>
                                {log.details ? JSON.stringify(log.details).substring(0, 80) : '-'}
                              </Text>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  <Flex justifyContent='space-between' alignItems='center' marginTop='size-200' UNSAFE_className='mdm-pagination'>
                    <Text UNSAFE_className='mdm-text-muted'>
                      Showing {logs.length} of {total} entries
                    </Text>
                    <Flex gap='size-100' alignItems='center'>
                      <Button variant='secondary' isDisabled={page <= 1} onPress={() => setPage(page - 1)}>Prev</Button>
                      <Text UNSAFE_className='mdm-pagination__current'>Page {page} of {totalPages || 1}</Text>
                      <Button variant='secondary' isDisabled={page >= totalPages} onPress={() => setPage(page + 1)}>Next</Button>
                    </Flex>
                  </Flex>
                </>
              )}
            </View>
          </Item>

          {/* ─── Archives Tab ─── */}
          <Item key='archives'>
            <View marginTop='size-200'>
              {archivesSummary.totalArchives > 0 && (
                <Well marginBottom='size-200'>
                  <Flex gap='size-400'>
                    <View>
                      <Text UNSAFE_className='mdm-text-muted'>Total Archives</Text>
                      <Heading level={4}>{archivesSummary.totalArchives}</Heading>
                    </View>
                    <View>
                      <Text UNSAFE_className='mdm-text-muted'>Total Records</Text>
                      <Heading level={4}>{(archivesSummary.totalRecords || 0).toLocaleString()}</Heading>
                    </View>
                    <View>
                      <Text UNSAFE_className='mdm-text-muted'>Total Size</Text>
                      <Heading level={4}>{formatBytes(archivesSummary.totalSizeBytes)}</Heading>
                    </View>
                  </Flex>
                </Well>
              )}

              {archivesLoading ? (
                <div className='mdm-loading-state'>
                  <ProgressCircle aria-label='Loading archives...' isIndeterminate size='L' />
                </div>
              ) : archives.length === 0 ? (
                <div className='mdm-empty-state'>
                  <div className='mdm-empty-state__icon'>🗄️</div>
                  <Heading level={2}>No audit archives</Heading>
                  <Text>Archived audit logs will appear here after the daily cleanup runs.</Text>
                </div>
              ) : (
                <>
                  <div className='mdm-table-container'>
                    <table className='mdm-table mdm-table--hoverable'>
                      <thead>
                        <tr>
                          <th>Archived At</th>
                          <th>Date Range</th>
                          <th>Records</th>
                          <th>Format</th>
                          <th>Size</th>
                          <th>Status</th>
                          <th>Expires</th>
                          <th>Download</th>
                        </tr>
                      </thead>
                      <tbody>
                        {archives.map(a => (
                          <tr key={a.archiveId}>
                            <td><Text UNSAFE_className='mdm-text-muted'>{new Date(a.archivedAt).toLocaleString()}</Text></td>
                            <td>
                              <Text UNSAFE_className='mdm-text-muted'>
                                {a.dateRange ? `${new Date(a.dateRange.from).toLocaleDateString()} – ${new Date(a.dateRange.to).toLocaleDateString()}` : '-'}
                              </Text>
                            </td>
                            <td>{(a.recordCount || 0).toLocaleString()}</td>
                            <td><code className='mdm-code-inline'>{a.format || 'csv.gz'}</code></td>
                            <td>
                              <Text>{formatBytes(a.sizeBytes)}</Text>
                              {a.uncompressedSizeBytes && (
                                <Text UNSAFE_style={{ fontSize: '11px', color: 'var(--spectrum-global-color-gray-600)' }}>
                                  {formatBytes(a.uncompressedSizeBytes)} uncompressed
                                </Text>
                              )}
                            </td>
                            <td>
                              <StatusLight variant={a.isExpired ? 'negative' : 'positive'}>
                                {a.isExpired ? 'Expired' : 'Active'}
                              </StatusLight>
                            </td>
                            <td>
                              {a.isExpired
                                ? <Text UNSAFE_className='mdm-text-muted'>—</Text>
                                : <Text UNSAFE_className='mdm-text-muted'>{a.daysUntilExpiry}d remaining</Text>}
                            </td>
                            <td>
                              {!a.isExpired && a.publicUrl
                                ? (
                                  <ActionButton isQuiet onPress={() => window.open(a.publicUrl, '_blank')}>
                                    <Download /><Text>Download</Text>
                                  </ActionButton>
                                  )
                                : <Text UNSAFE_className='mdm-text-muted'>Unavailable</Text>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Archives Pagination */}
                  <Flex justifyContent='space-between' alignItems='center' marginTop='size-200' UNSAFE_className='mdm-pagination'>
                    <Text UNSAFE_className='mdm-text-muted'>
                      Showing {archives.length} of {archivesTotal} archives
                    </Text>
                    <Flex gap='size-100' alignItems='center'>
                      <Button variant='secondary' isDisabled={archivesPage <= 1} onPress={() => setArchivesPage(archivesPage - 1)}>Prev</Button>
                      <Text UNSAFE_className='mdm-pagination__current'>Page {archivesPage} of {archivesTotalPages || 1}</Text>
                      <Button variant='secondary' isDisabled={archivesPage >= archivesTotalPages} onPress={() => setArchivesPage(archivesPage + 1)}>Next</Button>
                    </Flex>
                  </Flex>
                </>
              )}
            </View>
          </Item>
        </TabPanels>
      </Tabs>
    </View>
  )
}

export default AuditLogs
