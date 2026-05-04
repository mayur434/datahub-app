import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Heading, View, Flex, Button, TextField, Text, ProgressCircle, Well,
  Picker, Item, TextArea, Divider, SearchField, StatusLight, ActionButton,
  DialogTrigger, Dialog, AlertDialog, Content, ButtonGroup, Checkbox
} from '@adobe/react-spectrum'
import { useParams, useNavigate } from 'react-router-dom'
import { queryData, createRecord, patchRecord, deleteRecord, fetchFileDetail, fullUpdate, deltaUpdate, invokeAction } from './actionInvoker'
import { useNotifications } from './NotificationProvider'
import { useApp } from './AppContext'
import { clearSwrCache } from './useSwrCache'
import { useDebounce } from './useDebounce'
import Add from '@spectrum-icons/workflow/Add'
import Download from '@spectrum-icons/workflow/Download'
import UploadToCloud from '@spectrum-icons/workflow/UploadToCloud'
import Refresh from '@spectrum-icons/workflow/Refresh'

function RecordManager ({ runtime, ims }) {
  const { master } = useParams()
  const navigate = useNavigate()
  const notify = useNotifications()
  const { appSettings } = useApp()
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(appSettings.defaultPageSize || appSettings.uiPageSize || 25)

  // Create/Edit form
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingRecord, setEditingRecord] = useState(null)
  const [formData, setFormData] = useState({})

  // Bulk operations
  const [showBulkUpload, setShowBulkUpload] = useState(false)
  const [bulkCsvContent, setBulkCsvContent] = useState('')
  const [bulkMode, setBulkMode] = useState('full-update')

  // Operation-specific loading states (prevent duplicate XHR)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(null) // holds PK of record being deleted
  const [bulkUploading, setBulkUploading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('')
  const [filterField, setFilterField] = useState('')
  const [filterValue, setFilterValue] = useState('')
  const [sortField, setSortField] = useState('')
  const [sortDir, setSortDir] = useState('asc')

  // Selection
  const [selectedRecords, setSelectedRecords] = useState(new Set())

  // Reset cached file metadata only when master changes
  useEffect(() => {
    fileRef.current = null
  }, [master])

  useEffect(() => {
    loadData()
  }, [master, page, pageSize, sortField, sortDir])

  async function loadData () {
    try {
      setLoading(true)
      setRefreshing(true)

      const queryParams = { page, pageSize, includeMeta: !fileRef.current }
      if (filterField && filterValue) {
        queryParams[filterField] = filterValue
      }
      if (sortField) {
        queryParams.sort = sortField
        queryParams.order = sortDir
      }

      const dataResult = await queryData(master, queryParams, ims)

      // Use piggybacked file metadata if present (first load), otherwise use cached ref
      if (dataResult.file && !fileRef.current) {
        fileRef.current = dataResult.file
        setFile(dataResult.file)
      } else if (!fileRef.current) {
        // Fallback: fetch file metadata separately
        const fileResult = await fetchFileDetail(master, ims)
        fileRef.current = fileResult.file
        setFile(fileResult.file)
      }

      setRecords(dataResult.data || [])
      setTotal(dataResult.total || 0)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  async function handleCreate () {
    try {
      setCreating(true)
      await createRecord(master, formData, ims)
      notify.success('Record created successfully')
      clearSwrCache('dashboard')
      clearSwrCache('file-list')
      fileRef.current = null // Refresh metadata (recordCount changed)
      setShowCreateForm(false)
      setFormData({})
      await loadData()
    } catch (e) {
      notify.error(`Create failed: ${e.message}`)
    } finally {
      setCreating(false)
    }
  }

  async function handleEdit () {
    try {
      setEditing(true)
      const pk = editingRecord[file.primaryKey]
      // Only send editable schema fields that actually changed
      const editableFields = (file.schema || []).filter(f => f.editable).map(f => f.name)
      const changedData = {}
      editableFields.forEach(field => {
        if (String(formData[field] ?? '') !== String(editingRecord[field] ?? '')) {
          changedData[field] = formData[field]
        }
      })
      if (Object.keys(changedData).length === 0) {
        notify.info('No changes detected')
        setEditing(false)
        return
      }
      await patchRecord(master, pk, changedData, ims)
      notify.success('Record updated successfully')
      setEditingRecord(null)
      setFormData({})
      await loadData()
    } catch (e) {
      notify.error(`Update failed: ${e.message}`)
    } finally {
      setEditing(false)
    }
  }

  async function handleDelete (record) {
    const pk = record[file.primaryKey]
    try {
      setDeleting(pk)
      await deleteRecord(master, pk, ims)
      notify.success('Record deleted')
      clearSwrCache('dashboard')
      clearSwrCache('file-list')
      fileRef.current = null // Refresh metadata (recordCount changed)
      await loadData()
    } catch (e) {
      notify.error(`Delete failed: ${e.message}`)
    } finally {
      setDeleting(null)
    }
  }

  async function handleBulkUpload () {
    try {
      setBulkUploading(true)
      let result
      if (bulkMode === 'full-update') {
        result = await fullUpdate(master, bulkCsvContent, ims)
      } else {
        result = await deltaUpdate(master, bulkCsvContent, bulkMode, ims)
      }
      notify.success(`Bulk operation complete: ${result.message || 'Success'}`)
      clearSwrCache()
      fileRef.current = null // Refresh metadata (recordCount changed)
      setShowBulkUpload(false)
      setBulkCsvContent('')
      await loadData()
    } catch (e) {
      notify.error(`Bulk operation failed: ${e.message}`)
    } finally {
      setBulkUploading(false)
    }
  }

  function handleBulkFileSelect (e) {
    const selectedFile = e.target.files[0]
    if (!selectedFile) return
    const reader = new FileReader()
    reader.onload = (event) => {
      setBulkCsvContent(event.target.result)
    }
    reader.readAsText(selectedFile)
  }

  function startEdit (record) {
    setEditingRecord(record)
    setFormData({ ...record })
    setShowCreateForm(false)
  }

  function startCreate () {
    setShowCreateForm(true)
    setEditingRecord(null)
    const emptyData = {}
    if (file && file.schema) {
      file.schema.forEach(f => { emptyData[f.name] = '' })
    }
    // Auto-generate primary key
    if (file?.primaryKey) {
      emptyData[file.primaryKey] = crypto.randomUUID()
    }
    setFormData(emptyData)
  }

  function handleApplyFilter () {
    setPage(1)
    loadData()
  }

  function handleClearFilters () {
    setFilterField('')
    setFilterValue('')
    setSearchTerm('')
    setPage(1)
    loadData()
  }

  function handleSort (field) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const SYSTEM_FIELDS = ['createdAt', 'updatedAt', 'createdBy', 'updatedBy']

  function exportCSV () {
    if (!records.length || !file?.schema) return
    const headers = [...file.schema.map(f => f.name), ...SYSTEM_FIELDS]
    const rows = records.map(r => headers.map(h => {
      const val = SYSTEM_FIELDS.includes(h) ? (r._systemFields?.[h] || '') : (r[h] || '')
      return val.toString().includes(',') ? `"${val}"` : val
    }).join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${master}-export-page${page}.csv`
    a.click()
    URL.revokeObjectURL(url)
    notify.info('CSV exported')
  }

  // Filtered records by local search
  const displayRecords = useMemo(() => {
    if (!searchTerm) return records
    const term = searchTerm.toLowerCase()
    return records.filter(r =>
      Object.entries(r).filter(([k]) => k !== '_systemFields').some(([, v]) => String(v).toLowerCase().includes(term))
    )
  }, [records, searchTerm])

  const totalPages = Math.ceil(total / pageSize)

  if (loading && !file) {
    return (
      <View UNSAFE_className='mdm-page'>
        <div className='mdm-loading-state'>
          <ProgressCircle aria-label='Loading...' isIndeterminate size='L' />
          <Text marginTop='size-200'>Loading records...</Text>
        </div>
      </View>
    )
  }

  return (
    <View UNSAFE_className='mdm-page'>
      {/* Header */}
      <Flex justifyContent='space-between' alignItems='start' marginBottom='size-300'>
        <View>
          <Heading level={1} UNSAFE_className='mdm-page__title'>
            Records: {file?.displayName || master}
          </Heading>
          <Text UNSAFE_className='mdm-page__subtitle'>
            {total} total records • Page {page} of {totalPages || 1}
          </Text>
        </View>
        <Flex gap='size-100'>
          <ActionButton isQuiet onPress={loadData} isDisabled={refreshing}><Refresh /><Text>{refreshing ? 'Loading...' : 'Refresh'}</Text></ActionButton>
          <ActionButton isQuiet onPress={exportCSV}><Download /><Text>Export</Text></ActionButton>
          {file?.crudEnabled && (
            <>
              <Button variant='secondary' onPress={() => setShowBulkUpload(!showBulkUpload)} isDisabled={bulkUploading}>
                <UploadToCloud /><Text>Bulk</Text>
              </Button>
              <Button variant='accent' onPress={startCreate} isDisabled={creating}>
                <Add /><Text>New Record</Text>
              </Button>
            </>
          )}
        </Flex>
      </Flex>

      {error && (
        <Well marginBottom='size-200' UNSAFE_className='mdm-alert mdm-alert--error'>
          <Text>{error}</Text>
        </Well>
      )}

      {/* Filter Toolbar */}
      <View UNSAFE_className='mdm-toolbar' marginBottom='size-200'>
        <Flex gap='size-200' alignItems='end' wrap>
          <SearchField
            label='Quick search'
            value={searchTerm}
            onChange={setSearchTerm}
            width='size-2400'
            aria-label='Search records'
          />
          <Picker label='Filter by' selectedKey={filterField} onSelectionChange={setFilterField} width='size-1600'>
            <Item key=''>No filter</Item>
            {file?.schema?.map(s => (
              <Item key={s.name}>{s.name}</Item>
            ))}
          </Picker>
          {filterField && (
            <TextField label='Value' value={filterValue} onChange={setFilterValue} width='size-2000' />
          )}
          <Button variant='primary' onPress={handleApplyFilter} isDisabled={!filterField}>Apply</Button>
          <Button variant='secondary' onPress={handleClearFilters}>Clear</Button>
          <Picker label='Per page' selectedKey={String(pageSize)} onSelectionChange={(v) => { setPageSize(Number(v)); setPage(1) }} width='size-1200'>
            <Item key='10'>10</Item>
            <Item key='25'>25</Item>
            <Item key='50'>50</Item>
            <Item key='100'>100</Item>
          </Picker>
        </Flex>
      </View>

      {/* Bulk Upload Panel */}
      {showBulkUpload && (
        <View UNSAFE_className='mdm-card' marginBottom='size-300'>
          <Flex justifyContent='space-between' alignItems='center' marginBottom='size-200'>
            <Heading level={3}>Bulk Data Upload</Heading>
            <ActionButton isQuiet onPress={() => setShowBulkUpload(false)}>✕</ActionButton>
          </Flex>
          <Flex direction='column' gap='size-200'>
            <Picker label='Operation Mode' selectedKey={bulkMode} onSelectionChange={setBulkMode}>
              <Item key='full-update'>Full Update — Replace all records</Item>
              <Item key='upsert'>Delta Upsert — Insert or update</Item>
              <Item key='update-only'>Delta Update Only — Update existing</Item>
              <Item key='insert-only'>Delta Insert Only — Add new records</Item>
              <Item key='mixed'>Delta Mixed — Use _action column</Item>
            </Picker>
            <View>
              <Text marginBottom='size-50'><strong>Select CSV file:</strong></Text>
              <input type='file' accept='.csv' onChange={handleBulkFileSelect} className='mdm-file-input' />
            </View>
            <TextArea
              label='Or paste CSV content directly'
              value={bulkCsvContent}
              onChange={setBulkCsvContent}
              height='size-1700'
              UNSAFE_style={{ fontFamily: 'monospace', fontSize: '12px' }}
            />
            <Flex gap='size-100'>
              <Button variant='accent' onPress={handleBulkUpload} isDisabled={!bulkCsvContent || bulkUploading}>
                {bulkUploading ? 'Processing...' : 'Execute Upload'}
              </Button>
              <Button variant='secondary' onPress={() => { setShowBulkUpload(false); setBulkCsvContent('') }} isDisabled={bulkUploading}>
                Cancel
              </Button>
            </Flex>
          </Flex>
        </View>
      )}

      {/* Create/Edit Form */}
      {(showCreateForm || editingRecord) && (
        <View UNSAFE_className='mdm-card' marginBottom='size-300'>
          <Flex justifyContent='space-between' alignItems='center' marginBottom='size-200'>
            <Heading level={3}>{editingRecord ? 'Edit Record' : 'Create New Record'}</Heading>
            <ActionButton isQuiet onPress={() => { setShowCreateForm(false); setEditingRecord(null); setFormData({}) }}>✕</ActionButton>
          </Flex>
          <div className='mdm-form-grid'>
            {file?.schema?.filter(field => !(showCreateForm && field.name === file?.primaryKey) && !SYSTEM_FIELDS.includes(field.name)).map(field => (
              <TextField
                key={field.name}
                label={field.name}
                value={formData[field.name] || ''}
                onChange={(val) => setFormData({ ...formData, [field.name]: val })}
                isDisabled={editingRecord && !field.editable}
                isRequired={field.required}
                validationState={field.required && !formData[field.name] ? 'invalid' : undefined}
                description={field.type !== 'string' ? `Type: ${field.type}` : undefined}
              />
            ))}
          </div>
          <Flex gap='size-100' marginTop='size-200'>
            <Button variant='accent' onPress={editingRecord ? handleEdit : handleCreate} isDisabled={creating || editing}>
              {creating ? 'Creating...' : editing ? 'Saving...' : editingRecord ? 'Save Changes' : 'Create Record'}
            </Button>
            <Button variant='secondary' onPress={() => { setShowCreateForm(false); setEditingRecord(null); setFormData({}) }} isDisabled={creating || editing}>
              Cancel
            </Button>
          </Flex>
        </View>
      )}

      {/* Records Table */}
      {displayRecords.length === 0 && !loading ? (
        <div className='mdm-empty-state'>
          <div className='mdm-empty-state__icon'>📋</div>
          <Heading level={2}>{searchTerm ? 'No matching records' : 'No records'}</Heading>
          <Text>{searchTerm ? 'Try adjusting your search term.' : 'Upload data or create records to get started.'}</Text>
        </div>
      ) : (
        <div className='mdm-table-container'>
          <table className='mdm-table mdm-table--hoverable mdm-table--records'>
            <thead>
              <tr>
                {file?.schema?.map(field => (
                  <th
                    key={field.name}
                    className='mdm-table__sortable-header'
                    onClick={() => handleSort(field.name)}
                    title={`Sort by ${field.name}`}
                  >
                    <span className='mdm-table__header-content'>
                      <span>{field.name}</span>
                      {field.name === file.primaryKey && <span className='mdm-badge-pk'>PK</span>}
                      {field.queryable && <span className='mdm-badge-queryable'>Q</span>}
                      <span className={`mdm-table__sort-indicator ${sortField === field.name ? 'mdm-table__sort-indicator--active' : ''}`}>
                        {sortField === field.name ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                      </span>
                    </span>
                  </th>
                ))}
                {SYSTEM_FIELDS.map(sf => (
                  <th key={sf} className='mdm-table__system-col'>
                    <span className='mdm-text-muted'>{sf}</span>
                  </th>
                ))}
                {file?.crudEnabled && <th className='mdm-table__actions-col'>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {displayRecords.map((record, idx) => (
                <tr key={record[file?.primaryKey] || idx}>
                  {file?.schema?.map(field => (
                    <td key={field.name}>
                      <span className='mdm-cell-value' title={String(record[field.name] || '')}>
                        {record[field.name] !== undefined && record[field.name] !== null
                          ? String(record[field.name])
                          : <span className='mdm-text-muted'>—</span>
                        }
                      </span>
                    </td>
                  ))}
                  {SYSTEM_FIELDS.map(sf => (
                    <td key={sf} className='mdm-table__system-col'>
                      <span className='mdm-cell-value mdm-text-muted' title={record._systemFields?.[sf] || ''}>
                        {record._systemFields?.[sf]
                          ? sf.endsWith('At') ? new Date(record._systemFields[sf]).toLocaleString() : record._systemFields[sf]
                          : <span className='mdm-text-muted'>—</span>
                        }
                      </span>
                    </td>
                  ))}
                  {file?.crudEnabled && (
                    <td className='mdm-table__actions-col'>
                      <Flex gap='size-50'>
                        <ActionButton isQuiet size='S' onPress={() => startEdit(record)} isDisabled={deleting === record[file.primaryKey]}>Edit</ActionButton>
                        <DialogTrigger>
                          <ActionButton isQuiet size='S' UNSAFE_className='mdm-btn-danger' isDisabled={deleting === record[file.primaryKey]}>
                            {deleting === record[file.primaryKey] ? 'Deleting...' : 'Del'}
                          </ActionButton>
                          <AlertDialog
                            variant='destructive'
                            title='Delete Record'
                            primaryActionLabel='Delete'
                            onPrimaryAction={() => handleDelete(record)}
                          >
                            Delete record "{record[file.primaryKey]}"? This cannot be undone.
                          </AlertDialog>
                        </DialogTrigger>
                      </Flex>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > 0 && (
        <Flex justifyContent='space-between' alignItems='center' marginTop='size-200' UNSAFE_className='mdm-pagination'>
          <Text UNSAFE_className='mdm-text-muted'>
            Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total}
          </Text>
          <Flex gap='size-100' alignItems='center'>
            <Button variant='secondary' isDisabled={page <= 1} onPress={() => setPage(1)}>First</Button>
            <Button variant='secondary' isDisabled={page <= 1} onPress={() => setPage(page - 1)}>Prev</Button>
            <Text UNSAFE_className='mdm-pagination__current'>Page {page}</Text>
            <Button variant='secondary' isDisabled={page >= totalPages} onPress={() => setPage(page + 1)}>Next</Button>
            <Button variant='secondary' isDisabled={page >= totalPages} onPress={() => setPage(totalPages)}>Last</Button>
          </Flex>
        </Flex>
      )}
    </View>
  )
}

export default RecordManager
