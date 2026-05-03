import React, { useState, useEffect, useMemo } from 'react'
import {
  Heading, View, Flex, Button, Text, ProgressCircle,
  StatusLight, ActionButton, DialogTrigger, AlertDialog,
  SearchField, Picker, Item, Checkbox, MenuTrigger, Menu, ActionMenu
} from '@adobe/react-spectrum'
import { useNavigate } from 'react-router-dom'
import { fetchFileList, deleteFile, updateVisibility } from './actionInvoker'
import { useNotifications } from './NotificationProvider'
import useSwrCache, { clearSwrCache } from './useSwrCache'
import Add from '@spectrum-icons/workflow/Add'
import Refresh from '@spectrum-icons/workflow/Refresh'
import Delete from '@spectrum-icons/workflow/Delete'
import ViewDetail from '@spectrum-icons/workflow/ViewDetail'

function FileList ({ runtime, ims }) {
  const filesSwr = useSwrCache('file-list', () => fetchFileList(ims).then(r => r.files || []), { ttl: 2 * 60 * 1000 })
  const initialFiles = Array.isArray(filesSwr.data) ? filesSwr.data : []
  const [files, setFiles] = useState(initialFiles)
  const [loading, setLoading] = useState(!filesSwr.data)
  const [error, setError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterVisibility, setFilterVisibility] = useState('all')
  const [sortField, setSortField] = useState('displayName')
  const [sortDir, setSortDir] = useState('asc')
  const [selectedItems, setSelectedItems] = useState(new Set())
  const navigate = useNavigate()
  const notify = useNotifications()

  // Sync SWR data into local state
  useEffect(() => {
    if (filesSwr.data) {
      setFiles(Array.isArray(filesSwr.data) ? filesSwr.data : [])
      setLoading(false)
    }
    if (filesSwr.error && !filesSwr.data) setError(filesSwr.error)
  }, [filesSwr.data, filesSwr.error])

  async function loadFiles () {
    await filesSwr.refresh()
    clearSwrCache('dashboard') // invalidate dashboard cache too
  }

  async function handleDelete (master, displayName) {
    try {
      await deleteFile(master, ims)
      notify.success(`Master "${displayName}" deleted successfully`)
      clearSwrCache('dashboard')
      clearSwrCache('admin-overview')
      await loadFiles()
    } catch (e) {
      notify.error(`Failed to delete: ${e.message}`)
    }
  }

  async function handleToggleVisibility (master, currentVisibility) {
    try {
      const newVisibility = currentVisibility === 'public' ? 'private' : 'public'
      await updateVisibility(master, newVisibility, ims)
      notify.success(`Visibility updated to ${newVisibility}`)
      clearSwrCache('dashboard')
      await loadFiles()
    } catch (e) {
      notify.error(`Failed to update visibility: ${e.message}`)
    }
  }

  async function handleBulkDelete () {
    if (selectedItems.size === 0) return
    try {
      const promises = Array.from(selectedItems).map(master => deleteFile(master, ims))
      await Promise.all(promises)
      notify.success(`${selectedItems.size} masters deleted`)
      setSelectedItems(new Set())
      await loadFiles()
    } catch (e) {
      notify.error(`Bulk delete failed: ${e.message}`)
    }
  }

  function toggleSelection (masterName) {
    setSelectedItems(prev => {
      const next = new Set(prev)
      if (next.has(masterName)) next.delete(masterName)
      else next.add(masterName)
      return next
    })
  }

  function toggleSelectAll () {
    if (selectedItems.size === filteredFiles.length) {
      setSelectedItems(new Set())
    } else {
      setSelectedItems(new Set(filteredFiles.map(f => f.masterName || f.entityName)))
    }
  }

  function handleSort (field) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const filteredFiles = useMemo(() => {
    let result = [...files]

    // Search
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      result = result.filter(f =>
        f.displayName?.toLowerCase().includes(term) ||
        (f.masterName || f.entityName)?.toLowerCase().includes(term) ||
        f.description?.toLowerCase().includes(term)
      )
    }

    // Filter
    if (filterVisibility !== 'all') {
      result = result.filter(f => f.visibility === filterVisibility)
    }

    // Sort
    result.sort((a, b) => {
      let aVal = a[sortField] || ''
      let bVal = b[sortField] || ''
      if (typeof aVal === 'string') aVal = aVal.toLowerCase()
      if (typeof bVal === 'string') bVal = bVal.toLowerCase()
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
      return 0
    })

    return result
  }, [files, searchTerm, filterVisibility, sortField, sortDir])

  if (loading && files.length === 0) {
    return (
      <View UNSAFE_className='mdm-page'>
        <div className='mdm-loading-state'>
          <ProgressCircle aria-label='Loading...' isIndeterminate size='L' />
          <Text marginTop='size-200'>Loading masters...</Text>
        </div>
      </View>
    )
  }

  return (
    <View UNSAFE_className='mdm-page'>
      {/* Page Header */}
      <Flex justifyContent='space-between' alignItems='center' marginBottom='size-300'>
        <View>
          <Heading level={1} UNSAFE_className='mdm-page__title'>Masters</Heading>
          <Text UNSAFE_className='mdm-page__subtitle'>
            {files.length} registered {files.length === 1 ? 'master' : 'masters'}
          </Text>
        </View>
        <Flex gap='size-100'>
          <ActionButton onPress={loadFiles} isQuiet>
            <Refresh />
            <Text>Refresh</Text>
          </ActionButton>
          <Button variant='accent' onPress={() => navigate('/upload')}>
            <Add />
            <Text>Import Data</Text>
          </Button>
        </Flex>
      </Flex>

      {/* Toolbar */}
      <View UNSAFE_className='mdm-toolbar' marginBottom='size-200'>
        <Flex gap='size-200' alignItems='end' wrap>
          <SearchField
            label='Search masters'
            value={searchTerm}
            onChange={setSearchTerm}
            width='size-3000'
            aria-label='Search masters'
          />
          <Picker
            label='Visibility'
            selectedKey={filterVisibility}
            onSelectionChange={setFilterVisibility}
            width='size-1600'
          >
            <Item key='all'>All</Item>
            <Item key='public'>Public</Item>
            <Item key='private'>Private</Item>
          </Picker>

          {selectedItems.size > 0 && (
            <Flex alignItems='center' gap='size-100' marginStart='auto'>
              <Text UNSAFE_className='mdm-text-muted'>{selectedItems.size} selected</Text>
              <DialogTrigger>
                <Button variant='negative'>
                  <Delete />
                  <Text>Delete Selected</Text>
                </Button>
                <AlertDialog
                  variant='destructive'
                  title='Delete Entities'
                  primaryActionLabel='Delete All'
                  onPrimaryAction={handleBulkDelete}
                >
                  Are you sure you want to delete {selectedItems.size} masters? This action cannot be undone.
                </AlertDialog>
              </DialogTrigger>
            </Flex>
          )}
        </Flex>
      </View>

      {/* Empty State */}
      {filteredFiles.length === 0 && !loading && (
        <div className='mdm-empty-state'>
          <div className='mdm-empty-state__icon'>📂</div>
          <Heading level={2}>
            {searchTerm || filterVisibility !== 'all' ? 'No matching masters' : 'Get started'}
          </Heading>
          <Text>
            {searchTerm || filterVisibility !== 'all'
              ? 'Try adjusting your search or filter criteria.'
              : 'Import a CSV file to create your first master and start managing your master data.'}
          </Text>
          {!searchTerm && filterVisibility === 'all' && (
            <Button variant='accent' marginTop='size-200' onPress={() => navigate('/upload')}>
              Import Your First Dataset
            </Button>
          )}
        </div>
      )}

      {/* Data Table */}
      {filteredFiles.length > 0 && (
        <div className='mdm-table-container'>
          <table className='mdm-table mdm-table--hoverable'>
            <thead>
              <tr>
                <th className='mdm-table__check-col'>
                  <Checkbox
                    isSelected={selectedItems.size === filteredFiles.length && filteredFiles.length > 0}
                    isIndeterminate={selectedItems.size > 0 && selectedItems.size < filteredFiles.length}
                    onChange={toggleSelectAll}
                    aria-label='Select all'
                  />
                </th>
                <SortableHeader field='displayName' label='Master' currentSort={sortField} dir={sortDir} onSort={handleSort} />
                <SortableHeader field='recordCount' label='Records' currentSort={sortField} dir={sortDir} onSort={handleSort} />
                <th>Visibility</th>
                <th>CRUD</th>
                <SortableHeader field='updatedAt' label='Last Modified' currentSort={sortField} dir={sortDir} onSort={handleSort} />
                <th className='mdm-table__actions-col'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredFiles.map(file => (
                <tr key={file.masterName || file.entityName} className={selectedItems.has(file.masterName || file.entityName) ? 'mdm-table__row--selected' : ''}>
                  <td className='mdm-table__check-col'>
                    <Checkbox
                      isSelected={selectedItems.has(file.masterName || file.entityName)}
                      onChange={() => toggleSelection(file.masterName || file.entityName)}
                      aria-label={`Select ${file.displayName}`}
                    />
                  </td>
                  <td>
                    <div className='mdm-entity-cell'>
                      <button className='mdm-entity-cell__link' onClick={() => navigate(`/masters/${file.masterName || file.entityName}`)}>
                        {file.displayName}
                      </button>
                      <span className='mdm-entity-cell__sub'>{file.masterName || file.entityName}</span>
                    </div>
                  </td>
                  <td>
                    <Text UNSAFE_className='mdm-text-mono'>{(file.recordCount || 0).toLocaleString()}</Text>
                  </td>
                  <td>
                    <StatusLight variant={file.visibility === 'public' ? 'positive' : 'neutral'}>
                      {file.visibility}
                    </StatusLight>
                  </td>
                  <td>
                    <StatusLight variant={file.crudEnabled ? 'positive' : 'neutral'}>
                      {file.crudEnabled ? 'Enabled' : 'Read-only'}
                    </StatusLight>
                  </td>
                  <td>
                    <Text UNSAFE_className='mdm-text-muted'>
                      {file.updatedAt ? new Date(file.updatedAt).toLocaleDateString() : '-'}
                    </Text>
                    {file.lastModifiedBy && (
                      <Text UNSAFE_style={{ fontSize: '11px', color: 'var(--spectrum-global-color-gray-500)', display: 'block' }}>
                        by {file.lastModifiedBy}
                      </Text>
                    )}
                  </td>
                  <td className='mdm-table__actions-col'>
                    <ActionMenu
                      onAction={(key) => {
                        switch (key) {
                          case 'view': navigate(`/masters/${file.masterName || file.entityName}`); break
                          case 'records': navigate(`/masters/${file.masterName || file.entityName}/records`); break
                          case 'schema': navigate(`/masters/${file.masterName || file.entityName}/schema`); break
                          case 'archives': navigate(`/masters/${file.masterName || file.entityName}/archives`); break
                          case 'visibility': handleToggleVisibility(file.masterName || file.entityName, file.visibility); break
                          case 'delete': handleDelete(file.masterName || file.entityName, file.displayName); break
                        }
                      }}
                    >
                      <Item key='view'>View Details</Item>
                      <Item key='records'>Manage Records</Item>
                      <Item key='schema'>Edit Schema</Item>
                      <Item key='archives'>Archives &amp; Backups</Item>
                      <Item key='visibility'>{file.visibility === 'public' ? 'Make Private' : 'Make Public'}</Item>
                      <Item key='delete'>Delete Master</Item>
                    </ActionMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </View>
  )
}

function SortableHeader ({ field, label, currentSort, dir, onSort }) {
  const isActive = currentSort === field
  return (
    <th
      className='mdm-table__sortable-header'
      onClick={() => onSort(field)}
      aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span>{label}</span>
      {isActive && <span className='mdm-table__sort-indicator'>{dir === 'asc' ? '↑' : '↓'}</span>}
    </th>
  )
}

export default FileList
