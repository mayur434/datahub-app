import React, { useState, useEffect } from 'react'
import {
  Heading, View, Flex, Button, Text, ProgressCircle, Well, Divider,
  StatusLight, ActionButton, TextField, TextArea, DialogTrigger, Dialog,
  Content, ButtonGroup, AlertDialog, Picker, Item, Checkbox
} from '@adobe/react-spectrum'
import { useNavigate } from 'react-router-dom'
import { invokeAction } from './actionInvoker'
import { useNotifications } from './NotificationProvider'
import useSwrCache from './useSwrCache'
import Copy from '@spectrum-icons/workflow/Copy'
import Add from '@spectrum-icons/workflow/Add'
import Delete from '@spectrum-icons/workflow/Delete'
import Refresh from '@spectrum-icons/workflow/Refresh'
import UserGroup from '@spectrum-icons/workflow/UserGroup'
import Edit from '@spectrum-icons/workflow/Edit'

function PartnerConsole ({ runtime, ims }) {
  const navigate = useNavigate()
  const notify = useNotifications()
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // SWR cache for eligible masters — avoids a cold-start on every PartnerConsole visit
  const mastersSwr = useSwrCache('partner-masters', async () => {
    const result = await invokeAction('file-list', {}, ims, 'GET')
    const files = result.files || result.data || []
    return files
      .filter(f => (f.masterName || f.entityName) && f.visibility === 'public' && f.crudEnabled)
      .map(f => ({ masterName: f.masterName || f.entityName, displayName: f.displayName || f.masterName || f.entityName }))
  }, { ttl: 5 * 60 * 1000 })
  const masters = mastersSwr.data || []

  // Create form state
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createMasters, setCreateMasters] = useState([])
  const [creating, setCreating] = useState(false)

  // Edit form state
  const [editPartner, setEditPartner] = useState(null) // partner object being edited
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editMasters, setEditMasters] = useState([])
  const [saving, setSaving] = useState(false)

  // Created credentials display
  const [createdCreds, setCreatedCreds] = useState(null)

  useEffect(() => {
    loadPartners()
  }, [])

  async function loadPartners () {
    try {
      setLoading(true)
      const result = await invokeAction('partner-management', {}, ims, 'GET')
      setPartners(result.partners || [])
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate () {
    if (!createName.trim()) {
      notify.error('Partner name is required')
      return
    }
    if (createMasters.length === 0) {
      notify.error('Select at least one master for the partner')
      return
    }
    try {
      setCreating(true)
      const result = await invokeAction('partner-management', {
        op: 'create',
        name: createName,
        description: createDesc,
        contactEmail: createEmail,
        allowedMasters: createMasters
      }, ims, 'POST')

      setCreatedCreds({
        partnerId: result.partner.partnerId,
        partnerKey: result.partner.partnerKey,
        name: result.partner.name
      })

      // Reset form
      setCreateName('')
      setCreateDesc('')
      setCreateEmail('')
      setCreateMasters([])
      setShowCreate(false)

      notify.success('Partner created successfully')
      await loadPartners()
    } catch (e) {
      notify.error(`Failed to create partner: ${e.message}`)
    } finally {
      setCreating(false)
    }
  }

  async function handleStatusChange (partnerId, newStatus) {
    try {
      await invokeAction('partner-management', { op: 'update', partnerId, status: newStatus }, ims, 'POST')
      notify.success(`Partner status updated to ${newStatus}`)
      await loadPartners()
    } catch (e) {
      notify.error(`Failed to update status: ${e.message}`)
    }
  }

  async function handleRegenerateKey (partnerId) {
    try {
      const result = await invokeAction('partner-management', { op: 'update', partnerId, regenerateKey: true }, ims, 'POST')
      if (result.partnerKey) {
        setCreatedCreds({
          partnerId,
          partnerKey: result.partnerKey,
          name: partners.find(p => p.partnerId === partnerId)?.name || partnerId
        })
      }
      notify.success('Partner key regenerated')
    } catch (e) {
      notify.error(`Failed to regenerate key: ${e.message}`)
    }
  }

  async function handleDelete (partnerId) {
    try {
      await invokeAction('partner-management', { op: 'delete', partnerId }, ims, 'POST')
      notify.success('Partner removed')
      await loadPartners()
    } catch (e) {
      notify.error(`Failed to delete partner: ${e.message}`)
    }
  }

  function startEdit (partner) {
    setEditPartner(partner)
    setEditName(partner.name || '')
    setEditDesc(partner.description || '')
    setEditEmail(partner.contactEmail || '')
    setEditMasters(partner.allowedMasters || partner.allowedEntities || [])
  }

  function cancelEdit () {
    setEditPartner(null)
    setEditName('')
    setEditDesc('')
    setEditEmail('')
    setEditMasters([])
  }

  async function handleSaveEdit () {
    if (editMasters.length === 0) {
      notify.error('Select at least one master for the partner')
      return
    }
    try {
      setSaving(true)
      await invokeAction('partner-management', {
        op: 'update',
        partnerId: editPartner.partnerId,
        name: editName,
        description: editDesc,
        contactEmail: editEmail,
        allowedMasters: editMasters
      }, ims, 'POST')
      notify.success('Partner updated successfully')
      cancelEdit()
      await loadPartners()
    } catch (e) {
      notify.error(`Failed to update partner: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  function copyToClipboard (text) {
    navigator.clipboard.writeText(text)
    notify.info('Copied to clipboard')
  }

  if (loading) {
    return (
      <View UNSAFE_className='mdm-page'>
        <div className='mdm-loading-state'>
          <ProgressCircle aria-label='Loading...' isIndeterminate size='L' />
        </div>
      </View>
    )
  }

  if (error) {
    return (
      <View UNSAFE_className='mdm-page'>
        <div className='mdm-empty-state'>
          <div className='mdm-empty-state__icon'>⚠</div>
          <Heading level={2}>Failed to load partners</Heading>
          <Text>{error}</Text>
          <Button variant='primary' marginTop='size-200' onPress={loadPartners}>Retry</Button>
        </div>
      </View>
    )
  }

  return (
    <View UNSAFE_className='mdm-page'>
      {/* Page Header */}
      <Flex justifyContent='space-between' alignItems='center' marginBottom='size-400'>
        <View>
          <Flex alignItems='center' gap='size-150'>
            <UserGroup size='L' />
            <Heading level={1} UNSAFE_className='mdm-page__title'>Integration Partners</Heading>
          </Flex>
          <Text UNSAFE_className='mdm-page__subtitle'>
            Manage API integration partners for public CRUD operations via API Mesh
          </Text>
        </View>
        <Flex gap='size-100'>
          <Button variant='secondary' onPress={loadPartners}>
            <Refresh size='S' />
            <Text>Refresh</Text>
          </Button>
          <Button variant='cta' onPress={() => setShowCreate(true)}>
            <Add size='S' />
            <Text>Onboard Partner</Text>
          </Button>
        </Flex>
      </Flex>

      {/* Created Credentials Alert */}
      {createdCreds && (
        <View UNSAFE_className='mdm-card' marginBottom='size-300' UNSAFE_style={{ border: '2px solid var(--spectrum-global-color-green-500)', background: 'var(--spectrum-global-color-green-100)' }}>
          <Flex justifyContent='space-between' alignItems='center' marginBottom='size-200'>
            <Heading level={3}>Partner Credentials — Save Now</Heading>
            <Button variant='secondary' onPress={() => setCreatedCreds(null)}>Dismiss</Button>
          </Flex>
          <Text marginBottom='size-200'>
            <strong>⚠ Important:</strong> The partner key is shown only once. Copy and share it securely with the partner.
          </Text>
          <Well>
            <Flex direction='column' gap='size-100'>
              <Flex alignItems='center' gap='size-100'>
                <Text><strong>Partner Name:</strong> {createdCreds.name}</Text>
              </Flex>
              <Flex alignItems='center' gap='size-100'>
                <Text><strong>Partner ID:</strong></Text>
                <code className='mdm-code-inline'>{createdCreds.partnerId}</code>
                <ActionButton isQuiet onPress={() => copyToClipboard(createdCreds.partnerId)}>
                  <Copy size='S' />
                </ActionButton>
              </Flex>
              <Flex alignItems='center' gap='size-100'>
                <Text><strong>Partner Key:</strong></Text>
                <code className='mdm-code-inline'>{createdCreds.partnerKey}</code>
                <ActionButton isQuiet onPress={() => copyToClipboard(createdCreds.partnerKey)}>
                  <Copy size='S' />
                </ActionButton>
              </Flex>
            </Flex>
          </Well>
          <Divider size='S' marginY='size-200' />
          <Text UNSAFE_style={{ fontSize: '13px' }}>
            Partners must include these headers with every mutation request:
          </Text>
          <div className='mdm-code-block' style={{ marginTop: '8px' }}>
            <pre className='mdm-code-block__content'>{`x-partner-id: ${createdCreds.partnerId}
x-partner-key: ${createdCreds.partnerKey}`}</pre>
          </div>
        </View>
      )}

      {/* Create Partner Form */}
      {showCreate && (
        <View UNSAFE_className='mdm-card' marginBottom='size-300'>
          <Heading level={3} marginBottom='size-200'>Onboard New Partner</Heading>
          <Flex direction='column' gap='size-200'>
            <TextField
              label='Partner Name'
              value={createName}
              onChange={setCreateName}
              isRequired
              width='size-4600'
            />
            <TextArea
              label='Description'
              value={createDesc}
              onChange={setCreateDesc}
              width='size-4600'
            />
            <TextField
              label='Contact Email'
              value={createEmail}
              onChange={setCreateEmail}
              width='size-4600'
              type='email'
            />
            {masters.length > 0
              ? (
                <View>
                  <Text marginBottom='size-50'><strong>Allowed Masters</strong> <Text UNSAFE_style={{ color: '#e34850' }}>*</Text></Text>
                  <Text UNSAFE_style={{ fontSize: '12px', color: '#6e6e6e' }} marginBottom='size-100'>
                    Select the masters this partner can access for CRUD operations. Only public masters with CRUD enabled are shown.
                  </Text>
                  <Flex wrap gap='size-100' marginTop='size-100'>
                    {masters.map(e => (
                      <Button
                        key={e.masterName}
                        variant={createMasters.includes(e.masterName) ? 'primary' : 'secondary'}
                        onPress={() => {
                          setCreateMasters(prev =>
                            prev.includes(e.masterName) ? prev.filter(x => x !== e.masterName) : [...prev, e.masterName]
                          )
                        }}
                        UNSAFE_style={{ minWidth: 'auto' }}
                      >
                        {e.displayName}
                      </Button>
                    ))}
                  </Flex>
                  {createMasters.length > 0 && (
                    <Text marginTop='size-100' UNSAFE_style={{ fontSize: '12px' }}>
                      <strong>{createMasters.length}</strong> master{createMasters.length === 1 ? '' : 's'} selected
                    </Text>
                  )}
                </View>
                )
              : (
                <Well>
                  <Text>No eligible masters found. Masters must be <strong>public</strong> with <strong>CRUD enabled</strong> to be assigned to partners.</Text>
                </Well>
                )}
            <Divider size='S' />
            <Flex gap='size-100'>
              <Button variant='cta' onPress={handleCreate} isDisabled={creating || createMasters.length === 0}>
                {creating ? 'Creating...' : 'Create Partner'}
              </Button>
              <Button variant='secondary' onPress={() => setShowCreate(false)}>Cancel</Button>
            </Flex>
          </Flex>
        </View>
      )}

      {/* Edit Partner Form */}
      {editPartner && (
        <View UNSAFE_className='mdm-card' marginBottom='size-300' UNSAFE_style={{ border: '2px solid var(--spectrum-global-color-blue-500)' }}>
          <Heading level={3} marginBottom='size-200'>Edit Partner: {editPartner.name}</Heading>
          <Flex direction='column' gap='size-200'>
            <TextField
              label='Partner Name'
              value={editName}
              onChange={setEditName}
              isRequired
              width='size-4600'
            />
            <TextArea
              label='Description'
              value={editDesc}
              onChange={setEditDesc}
              width='size-4600'
            />
            <TextField
              label='Contact Email'
              value={editEmail}
              onChange={setEditEmail}
              width='size-4600'
              type='email'
            />
            {masters.length > 0
              ? (
                <View>
                  <Text marginBottom='size-50'><strong>Allowed Masters</strong> <Text UNSAFE_style={{ color: '#e34850' }}>*</Text></Text>
                  <Text UNSAFE_style={{ fontSize: '12px', color: '#6e6e6e' }} marginBottom='size-100'>
                    Select the masters this partner can access. Only public masters with CRUD enabled are shown.
                  </Text>
                  <Flex wrap gap='size-100' marginTop='size-100'>
                    {masters.map(e => (
                      <Button
                        key={e.masterName}
                        variant={editMasters.includes(e.masterName) ? 'primary' : 'secondary'}
                        onPress={() => {
                          setEditMasters(prev =>
                            prev.includes(e.masterName) ? prev.filter(x => x !== e.masterName) : [...prev, e.masterName]
                          )
                        }}
                        UNSAFE_style={{ minWidth: 'auto' }}
                      >
                        {e.displayName}
                      </Button>
                    ))}
                  </Flex>
                  {editMasters.length > 0 && (
                    <Text marginTop='size-100' UNSAFE_style={{ fontSize: '12px' }}>
                      <strong>{editMasters.length}</strong> master{editMasters.length === 1 ? '' : 's'} selected
                    </Text>
                  )}
                  {/* Show warning for masters assigned but no longer eligible */}
                  {editMasters.filter(e => !masters.find(ent => ent.masterName === e)).length > 0 && (
                    <Well marginTop='size-100'>
                      <Text UNSAFE_style={{ fontSize: '12px', color: '#e34850' }}>
                        <strong>Warning:</strong> The following assigned masters are no longer public/CRUD-enabled and will be removed on save:{' '}
                        {editMasters.filter(e => !masters.find(ent => ent.masterName === e)).join(', ')}
                      </Text>
                    </Well>
                  )}
                </View>
                )
              : (
                <Well>
                  <Text>No eligible masters found. Masters must be <strong>public</strong> with <strong>CRUD enabled</strong> to be assigned to partners.</Text>
                </Well>
                )}
            <Divider size='S' />
            <Flex gap='size-100'>
              <Button variant='cta' onPress={handleSaveEdit} isDisabled={saving || editMasters.length === 0}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button variant='secondary' onPress={cancelEdit}>Cancel</Button>
            </Flex>
          </Flex>
        </View>
      )}

      {/* Partners List */}
      {partners.length === 0
        ? (
          <View UNSAFE_className='mdm-card'>
            <div className='mdm-empty-state'>
              <div className='mdm-empty-state__icon'><UserGroup size='XXL' /></div>
              <Heading level={3}>No Integration Partners</Heading>
              <Text>Onboard your first partner to enable API CRUD access via API Mesh.</Text>
              <Button variant='cta' marginTop='size-200' onPress={() => setShowCreate(true)}>
                Onboard Partner
              </Button>
            </div>
          </View>
          )
        : (
          <View>
            <table className='mdm-table'>
              <thead>
                <tr>
                  <th>Partner</th>
                  <th>Partner ID</th>
                  <th>Status</th>
                  <th>Allowed Masters</th>
                  <th>Key</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {partners.map(p => (
                  <tr key={p.partnerId}>
                    <td>
                      <strong>{p.name}</strong>
                      {p.description && <Text UNSAFE_style={{ fontSize: '12px', display: 'block', color: '#6e6e6e' }}>{p.description}</Text>}
                      {p.contactEmail && <Text UNSAFE_style={{ fontSize: '11px', display: 'block', color: '#999' }}>{p.contactEmail}</Text>}
                    </td>
                    <td>
                      <Flex alignItems='center' gap='size-50'>
                        <code className='mdm-code-inline'>{p.partnerId}</code>
                        <ActionButton isQuiet onPress={() => copyToClipboard(p.partnerId)}>
                          <Copy size='S' />
                        </ActionButton>
                      </Flex>
                    </td>
                    <td>
                      <StatusLight variant={p.status === 'active' ? 'positive' : p.status === 'suspended' ? 'notice' : 'negative'}>
                        {p.status}
                      </StatusLight>
                    </td>
                    <td>
                      {(p.allowedMasters || p.allowedEntities) && (p.allowedMasters || p.allowedEntities).length > 0
                        ? <Flex wrap gap='size-50'>{(p.allowedMasters || p.allowedEntities).map(e => <code key={e} className='mdm-code-badge'>{e}</code>)}</Flex>
                        : <Text UNSAFE_style={{ color: '#999' }}>All masters</Text>}
                    </td>
                    <td>
                      <StatusLight variant={p.keyConfigured ? 'positive' : 'negative'}>
                        {p.keyConfigured ? 'Configured' : 'Missing'}
                      </StatusLight>
                    </td>
                    <td>
                      <Text UNSAFE_style={{ fontSize: '12px' }}>
                        {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—'}
                      </Text>
                    </td>
                    <td>
                      <Flex gap='size-50' wrap>
                        <ActionButton isQuiet onPress={() => startEdit(p)} aria-label='Edit partner'>
                          <Edit size='S' />
                        </ActionButton>
                        {p.status === 'active' && (
                          <Button variant='secondary' isQuiet onPress={() => handleStatusChange(p.partnerId, 'suspended')}>
                            Suspend
                          </Button>
                        )}
                        {p.status === 'suspended' && (
                          <Button variant='secondary' isQuiet onPress={() => handleStatusChange(p.partnerId, 'active')}>
                            Activate
                          </Button>
                        )}
                        <DialogTrigger>
                          <ActionButton isQuiet>
                            <Refresh size='S' />
                          </ActionButton>
                          <AlertDialog
                            title='Regenerate Key'
                            variant='warning'
                            primaryActionLabel='Regenerate'
                            cancelLabel='Cancel'
                            onPrimaryAction={() => handleRegenerateKey(p.partnerId)}
                          >
                            This will invalidate the current partner key for "{p.name}".
                            The partner will need to update their integration with the new key.
                          </AlertDialog>
                        </DialogTrigger>
                        <DialogTrigger>
                          <ActionButton isQuiet>
                            <Delete size='S' />
                          </ActionButton>
                          <AlertDialog
                            title='Remove Partner'
                            variant='destructive'
                            primaryActionLabel='Remove'
                            cancelLabel='Cancel'
                            onPrimaryAction={() => handleDelete(p.partnerId)}
                          >
                            This will permanently revoke API access for "{p.name}".
                            All existing integrations will stop working.
                          </AlertDialog>
                        </DialogTrigger>
                      </Flex>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </View>
          )}

      {/* How It Works */}
      <Well marginTop='size-300'>
        <Heading level={4} marginBottom='size-100'>How Partner Integration Works</Heading>
        <Text>
          <strong>1. Onboard:</strong> Create a partner and assign specific masters they can access. Share the credentials securely.<br />
          <strong>2. Master Access:</strong> Partners can only perform CRUD operations on the masters explicitly assigned to them. Read operations are always public — no credentials needed.<br />
          <strong>3. Integrate:</strong> Partners include <code className='mdm-code-inline'>x-partner-id</code> and <code className='mdm-code-inline'>x-partner-key</code> headers with API Mesh mutation requests.<br />
          <strong>4. Manage:</strong> Edit partner master access, suspend, activate, regenerate keys, or remove partners at any time.
        </Text>
      </Well>
    </View>
  )
}

export default PartnerConsole
