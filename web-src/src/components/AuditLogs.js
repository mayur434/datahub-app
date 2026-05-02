import React, { useState, useEffect } from 'react'
import {
  Heading, View, Flex, Button, TextField, Text, ProgressCircle,
  Picker, Item, ActionButton, StatusLight
} from '@adobe/react-spectrum'
import { useNavigate } from 'react-router-dom'
import { fetchAuditLogs, fetchFileList, invokeAction } from './actionInvoker'
import { useDebounce } from './useDebounce'
import Refresh from '@spectrum-icons/workflow/Refresh'

function AuditLogs ({ runtime, ims }) {
  const navigate = useNavigate()
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

  // Debounce text filters to avoid excessive API calls
  const debouncedUser = useDebounce(filterUser, 400)

  useEffect(() => {
    loadEntities()
    // Load default page size from settings
    ;(async () => {
      try {
        const r = await invokeAction('app-settings', {}, ims, 'GET')
        const defaultPs = r?.settings?.api?.defaultPageSize
        if (defaultPs) setPageSize(defaultPs)
      } catch (_) { /* keep default */ }
    })()
  }, [])

  useEffect(() => {
    loadLogs()
  }, [filterMaster, debouncedUser, filterAction, page])

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

  const totalPages = Math.ceil(total / pageSize)

  return (
    <View UNSAFE_className='mdm-page'>
      <Flex justifyContent='space-between' alignItems='center' marginBottom='size-300'>
        <View>
          <Heading level={1} UNSAFE_className='mdm-page__title'>Audit Logs</Heading>
          <Text UNSAFE_className='mdm-page__subtitle'>{total} total entries</Text>
        </View>
        <ActionButton isQuiet onPress={loadLogs}>
          <Refresh /><Text>Refresh</Text>
        </ActionButton>
      </Flex>

      {error && (
        <div className='mdm-alert mdm-alert--error' style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 6 }}>
          <Text>{error}</Text>
        </div>
      )}

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
  )
}

export default AuditLogs
