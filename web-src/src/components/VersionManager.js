import React, { useState, useEffect } from 'react'
import {
  Heading, View, Flex, Button, Text, ProgressCircle, Well,
  StatusLight, DialogTrigger, AlertDialog, ActionButton
} from '@adobe/react-spectrum'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchVersions, rollbackVersion } from './actionInvoker'
import { useNotifications } from './NotificationProvider'

function VersionManager ({ runtime, ims }) {
  const { master } = useParams()
  const navigate = useNavigate()
  const notify = useNotifications()
  const [versions, setVersions] = useState([])
  const [activeVersionId, setActiveVersionId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadVersions()
  }, [master])

  async function loadVersions () {
    try {
      setLoading(true)
      const result = await fetchVersions(master, ims)
      setVersions(result.versions || [])
      setActiveVersionId(result.activeVersionId || '')
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRollback (versionId) {
    try {
      setLoading(true)
      setError(null)
      const result = await rollbackVersion(master, versionId, ims)
      notify.success(`Rolled back to version '${versionId}'. New version: ${result.newVersionId}`)
      await loadVersions()
    } catch (e) {
      setError(e.message)
      notify.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading && versions.length === 0) {
    return (
      <View UNSAFE_className='mdm-page'>
        <div className='mdm-loading-state'>
          <ProgressCircle aria-label='Loading...' isIndeterminate size='L' />
        </div>
      </View>
    )
  }

  return (
    <View UNSAFE_className='mdm-page'>
      <Flex justifyContent='space-between' alignItems='center' marginBottom='size-300'>
        <View>
          <Heading level={1} UNSAFE_className='mdm-page__title'>Versions: {master}</Heading>
          <Text UNSAFE_className='mdm-page__subtitle'>
            Active: {activeVersionId} • {versions.length} versions total
          </Text>
        </View>
        <Button variant='secondary' onPress={() => navigate(`/masters/${master}`)}>Back to Master</Button>
      </Flex>

      {error && (
        <Well marginBottom='size-200' UNSAFE_className='mdm-alert mdm-alert--error'>
          <Text>{error}</Text>
        </Well>
      )}

      {versions.length === 0 ? (
        <div className='mdm-empty-state'>
          <div className='mdm-empty-state__icon'>📦</div>
          <Heading level={2}>No versions found</Heading>
          <Text>Versions are created automatically when data changes.</Text>
        </div>
      ) : (
        <div className='mdm-table-container'>
          <table className='mdm-table mdm-table--hoverable'>
            <thead>
              <tr>
                <th>Version</th>
                <th>Operation</th>
                <th>Created By</th>
                <th>Created At</th>
                <th>Records</th>
                <th>Changes</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {versions.map(version => (
                <tr key={version.versionId} className={version.versionId === activeVersionId ? 'mdm-table__row--selected' : ''}>
                  <td>
                    <strong>{version.versionId}</strong>
                    {version.versionId === activeVersionId && (
                      <StatusLight variant='positive' marginStart='size-50'>Active</StatusLight>
                    )}
                  </td>
                  <td>{version.operation}</td>
                  <td><Text UNSAFE_className='mdm-text-muted'>{version.createdBy}</Text></td>
                  <td>{version.createdAt ? new Date(version.createdAt).toLocaleString() : '-'}</td>
                  <td>{version.recordCount || '-'}</td>
                  <td>
                    <Flex gap='size-50'>
                      {version.changeSummary?.inserted > 0 && <span className='mdm-code-badge'>+{version.changeSummary.inserted}</span>}
                      {version.changeSummary?.updated > 0 && <span className='mdm-code-badge'>~{version.changeSummary.updated}</span>}
                      {version.changeSummary?.deleted > 0 && <span className='mdm-code-badge'>-{version.changeSummary.deleted}</span>}
                    </Flex>
                  </td>
                  <td><StatusLight variant='info'>{version.status}</StatusLight></td>
                  <td>
                    {version.versionId !== activeVersionId && (
                      <DialogTrigger>
                        <ActionButton isQuiet>Rollback</ActionButton>
                        <AlertDialog
                          variant='confirmation'
                          title='Rollback Version'
                          primaryActionLabel='Rollback'
                          onPrimaryAction={() => handleRollback(version.versionId)}
                        >
                          Rollback to version "{version.versionId}"? This creates a new version and invalidates cache.
                        </AlertDialog>
                      </DialogTrigger>
                    )}
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

export default VersionManager
