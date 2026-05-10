import React, { useState, useEffect, useMemo } from 'react'
import {
  Heading, View, Flex, Button, Text, ProgressCircle, Well, Divider,
  TextField, Picker, Item, ActionButton, Tabs, TabList, TabPanels,
  Switch, DialogTrigger, Dialog, Content, Header, ButtonGroup,
  TextArea, StatusLight, SearchField, Checkbox
} from '@adobe/react-spectrum'
import {
  fetchAppUsers, fetchAppRoles, createAppUser, bulkCreateAppUsers,
  updateAppUser, deleteAppUser, createAppRole, updateAppRole, deleteAppRole,
  fetchUsersAndRoles
} from './actionInvoker'
import { useApp } from './AppContext'
import { useNotifications } from './NotificationProvider'
import Add from '@spectrum-icons/workflow/Add'
import Delete from '@spectrum-icons/workflow/Delete'
import Edit from '@spectrum-icons/workflow/Edit'
import UserGroup from '@spectrum-icons/workflow/UserGroup'
import LockClosed from '@spectrum-icons/workflow/LockClosed'
import UploadToCloud from '@spectrum-icons/workflow/UploadToCloud'
import Refresh from '@spectrum-icons/workflow/Refresh'

/**
 * Feature permission labels for the role editor grid.
 */
const FEATURE_LABELS = {
  dashboard: { label: 'Dashboard', description: 'View dashboard metrics and overview' },
  masters: { label: 'Masters', description: 'Browse entities, view records, schemas, and archives. Delete masters and edit metadata.' },
  import_data: { label: 'Import Data', description: 'Upload CSV files and run full/delta/bulk updates' },
  query_console: { label: 'Query Console', description: 'Run ad-hoc API queries against data' },
  activity_log: { label: 'Activity Log', description: 'View audit trail and system logs' },
  partners: { label: 'Partners Console', description: 'Manage integration partners and API keys' },
  admin_console: { label: 'Admin Console', description: 'View infrastructure metrics and storage usage' },
  settings: { label: 'App Settings', description: 'Modify application configuration and guardrails' },
  record_management: { label: 'Record CRUD', description: 'Create, edit, and delete individual records (also grants record browsing)' },
  schema_management: { label: 'Schema Management', description: 'Add, edit, and remove fields from entity schemas' },
  archive_management: { label: 'Archive Management', description: 'Configure archive policies and trigger archive runs' },
  user_management: { label: 'Users & Roles', description: 'Manage app users and custom roles (highest privilege)' }
}

function UserManagement ({ runtime, ims }) {
  const { refetchUser } = useApp()
  const notify = useNotifications()
  const [activeTab, setActiveTab] = useState('users')
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [features, setFeatures] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  async function loadData (showRefresh) {
    try {
      if (showRefresh) setRefreshing(true)
      else setLoading(true)
      const res = await fetchUsersAndRoles(ims)
      setUsers(res.users || [])
      setRoles(res.roles || [])
      setFeatures(res.features || [])
    } catch (e) {
      notify.error('Failed to load user management data: ' + e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { loadData(false) }, [])

  const roleMap = useMemo(() => {
    const map = {}
    for (const r of roles) map[r.roleId] = r
    return map
  }, [roles])

  if (loading) {
    return (
      <View UNSAFE_className='mdm-page' padding='size-400'>
        <Flex justifyContent='center' alignItems='center' height='size-3000'>
          <ProgressCircle aria-label='Loading...' isIndeterminate size='L' />
        </Flex>
      </View>
    )
  }

  return (
    <View UNSAFE_className='mdm-page' padding='size-400'>
      <Flex justifyContent='space-between' alignItems='center' marginBottom='size-300'>
        <Flex alignItems='center' gap='size-150'>
          <LockClosed size='M' />
          <Heading level={2} margin={0}>Users & Roles Management</Heading>
        </Flex>
        <ActionButton isQuiet onPress={() => loadData(true)} isDisabled={refreshing}>
          <Refresh />
          <Text>{refreshing ? 'Refreshing...' : 'Refresh'}</Text>
        </ActionButton>
      </Flex>

      <Tabs selectedKey={activeTab} onSelectionChange={setActiveTab}>
        <TabList>
          <Item key='users'><UserGroup size='S' /><Text>Users ({users.length})</Text></Item>
          <Item key='roles'><LockClosed size='S' /><Text>Roles ({roles.length})</Text></Item>
        </TabList>
        <TabPanels>
          <Item key='users'>
            <UsersTab
              users={users}
              roles={roles}
              roleMap={roleMap}
              ims={ims}
              notify={notify}
              onRefresh={() => loadData(true)}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              refetchUser={refetchUser}
            />
          </Item>
          <Item key='roles'>
            <RolesTab
              roles={roles}
              features={features}
              ims={ims}
              notify={notify}
              onRefresh={() => loadData(true)}
            />
          </Item>
        </TabPanels>
      </Tabs>
    </View>
  )
}

// ============ Users Tab ============

function UsersTab ({ users, roles, roleMap, ims, notify, onRefresh, searchQuery, setSearchQuery, refetchUser }) {
  const [showAddUser, setShowAddUser] = useState(false)
  const [showBulkAdd, setShowBulkAdd] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)

  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users
    const q = searchQuery.toLowerCase()
    return users.filter(u =>
      u.email.toLowerCase().includes(q) ||
      u.firstName.toLowerCase().includes(q) ||
      u.lastName.toLowerCase().includes(q) ||
      (u.roleName || '').toLowerCase().includes(q)
    )
  }, [users, searchQuery])

  async function handleDeactivateUser (email) {
    if (!window.confirm(`Deactivate user "${email}"? They will lose access to the application.`)) return
    try {
      setActionLoading(true)
      await deleteAppUser(email, ims)
      notify.success(`User ${email} deactivated`)
      onRefresh()
    } catch (e) {
      notify.error(e.message || 'Failed to deactivate user')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleReactivateUser (email) {
    try {
      setActionLoading(true)
      await updateAppUser({ email, status: 'active' }, ims)
      notify.success(`User ${email} reactivated`)
      onRefresh()
    } catch (e) {
      notify.error(e.message || 'Failed to reactivate user')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <View marginTop='size-200'>
      <Flex justifyContent='space-between' alignItems='end' marginBottom='size-200' wrap gap='size-100'>
        <SearchField
          label='Search users'
          value={searchQuery}
          onChange={setSearchQuery}
          width='size-3600'
        />
        <Flex gap='size-100'>
          <DialogTrigger>
            <ActionButton>
              <UploadToCloud size='S' />
              <Text>Bulk Add</Text>
            </ActionButton>
            {(close) => <BulkAddUsersDialog roles={roles} ims={ims} notify={notify} onDone={() => { close(); onRefresh() }} />}
          </DialogTrigger>
          <DialogTrigger>
            <Button variant='accent'>
              <Add size='S' />
              <Text>Add User</Text>
            </Button>
            {(close) => <AddUserDialog roles={roles} ims={ims} notify={notify} onDone={() => { close(); onRefresh() }} />}
          </DialogTrigger>
        </Flex>
      </Flex>

      {filteredUsers.length === 0
        ? (
          <Well>
            <Text>No users found{searchQuery ? ' matching your search' : ''}.</Text>
          </Well>
          )
        : (
          <div className='mdm-table-wrapper'>
            <table className='mdm-table'>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(u => (
                  <tr key={u.email}>
                    <td><Text UNSAFE_style={{ fontFamily: 'monospace', fontSize: '13px' }}>{u.email}</Text></td>
                    <td>{u.firstName} {u.lastName}</td>
                    <td>
                      <StatusLight variant={roleMap[u.roleId]?.isSystem ? 'positive' : 'info'}>
                        {u.roleName || u.roleId}
                      </StatusLight>
                    </td>
                    <td>
                      <StatusLight variant={u.status === 'active' ? 'positive' : 'negative'}>
                        {u.status}
                      </StatusLight>
                    </td>
                    <td><Text UNSAFE_style={{ fontSize: '12px', color: '#6e6e6e' }}>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</Text></td>
                    <td>
                      <Flex gap='size-50'>
                        <DialogTrigger>
                          <ActionButton isQuiet aria-label='Edit user'>
                            <Edit size='S' />
                          </ActionButton>
                          {(close) => (
                            <EditUserDialog
                              user={u}
                              roles={roles}
                              ims={ims}
                              notify={notify}
                              onDone={() => { close(); onRefresh(); refetchUser() }}
                            />
                          )}
                        </DialogTrigger>
                        {u.status === 'active'
                          ? (
                            <ActionButton isQuiet aria-label='Deactivate user' onPress={() => handleDeactivateUser(u.email)} isDisabled={actionLoading}>
                              <Delete size='S' />
                            </ActionButton>
                            )
                          : (
                            <Button variant='secondary' isQuiet onPress={() => handleReactivateUser(u.email)} isDisabled={actionLoading}>
                              <Text>Reactivate</Text>
                            </Button>
                            )}
                      </Flex>
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

// ============ Add User Dialog ============

function AddUserDialog ({ roles, ims, notify, onDone }) {
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [roleId, setRoleId] = useState(roles.length > 0 ? roles.find(r => r.roleId === 'role_viewer')?.roleId || roles[0].roleId : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave () {
    setError('')
    if (!email.trim() || !firstName.trim() || !lastName.trim() || !roleId) {
      setError('All fields are required')
      return
    }
    try {
      setSaving(true)
      await createAppUser({ email: email.trim(), firstName: firstName.trim(), lastName: lastName.trim(), roleId }, ims)
      notify.success(`User ${email.trim()} created`)
      onDone()
    } catch (e) {
      setError(e.message || 'Failed to create user')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog>
      <Heading>Add User</Heading>
      <Divider />
      <Content>
        <Flex direction='column' gap='size-200'>
          {error && <Well UNSAFE_style={{ background: '#ffebe6', borderColor: '#ff4d4f' }}><Text UNSAFE_style={{ color: '#cf1322' }}>{error}</Text></Well>}
          <TextField label='Email' value={email} onChange={setEmail} type='email' isRequired autoFocus />
          <Flex gap='size-200'>
            <TextField label='First Name' value={firstName} onChange={setFirstName} isRequired flex={1} />
            <TextField label='Last Name' value={lastName} onChange={setLastName} isRequired flex={1} />
          </Flex>
          <Picker label='Role' selectedKey={roleId} onSelectionChange={setRoleId} isRequired width='100%'>
            {roles.map(r => (
              <Item key={r.roleId}>{r.name}{r.isSystem ? ' (System)' : ''}</Item>
            ))}
          </Picker>
        </Flex>
      </Content>
      <ButtonGroup>
        <Button variant='secondary' onPress={onDone}>Cancel</Button>
        <Button variant='accent' onPress={handleSave} isDisabled={saving}>
          {saving ? <ProgressCircle size='S' isIndeterminate aria-label='Saving...' /> : 'Add User'}
        </Button>
      </ButtonGroup>
    </Dialog>
  )
}

// ============ Edit User Dialog ============

function EditUserDialog ({ user, roles, ims, notify, onDone }) {
  const [roleId, setRoleId] = useState(user.roleId)
  const [firstName, setFirstName] = useState(user.firstName)
  const [lastName, setLastName] = useState(user.lastName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave () {
    setError('')
    const updates = { email: user.email }
    if (roleId !== user.roleId) updates.roleId = roleId
    if (firstName !== user.firstName) updates.firstName = firstName.trim()
    if (lastName !== user.lastName) updates.lastName = lastName.trim()
    if (Object.keys(updates).length <= 1) {
      setError('No changes to save')
      return
    }
    try {
      setSaving(true)
      await updateAppUser(updates, ims)
      notify.success(`User ${user.email} updated`)
      onDone()
    } catch (e) {
      setError(e.message || 'Failed to update user')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog>
      <Heading>Edit User: {user.email}</Heading>
      <Divider />
      <Content>
        <Flex direction='column' gap='size-200'>
          {error && <Well UNSAFE_style={{ background: '#ffebe6', borderColor: '#ff4d4f' }}><Text UNSAFE_style={{ color: '#cf1322' }}>{error}</Text></Well>}
          <Flex gap='size-200'>
            <TextField label='First Name' value={firstName} onChange={setFirstName} isRequired flex={1} />
            <TextField label='Last Name' value={lastName} onChange={setLastName} isRequired flex={1} />
          </Flex>
          <Picker label='Role' selectedKey={roleId} onSelectionChange={setRoleId} isRequired width='100%'>
            {roles.map(r => (
              <Item key={r.roleId}>{r.name}{r.isSystem ? ' (System)' : ''}</Item>
            ))}
          </Picker>
        </Flex>
      </Content>
      <ButtonGroup>
        <Button variant='secondary' onPress={onDone}>Cancel</Button>
        <Button variant='accent' onPress={handleSave} isDisabled={saving}>
          {saving ? <ProgressCircle size='S' isIndeterminate aria-label='Saving...' /> : 'Save Changes'}
        </Button>
      </ButtonGroup>
    </Dialog>
  )
}

// ============ Bulk Add Users Dialog ============

function BulkAddUsersDialog ({ roles, ims, notify, onDone }) {
  const [csvText, setCsvText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  function parseBulkCsv (text) {
    const lines = text.trim().split('\n').filter(l => l.trim())
    if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row')
    const header = lines[0].split(',').map(h => h.trim().toLowerCase())
    const required = ['email', 'firstname', 'lastname', 'roleid']
    const missing = required.filter(r => !header.includes(r))
    if (missing.length > 0) throw new Error(`Missing CSV columns: ${missing.join(', ')}. Required: email,firstName,lastName,roleId`)

    const users = []
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim())
      if (values.length < header.length) continue
      const row = {}
      header.forEach((h, idx) => { row[h] = values[idx] })
      users.push({
        email: row.email,
        firstName: row.firstname,
        lastName: row.lastname,
        roleId: row.roleid
      })
    }
    return users
  }

  async function handleBulkAdd () {
    setError('')
    setResult(null)
    try {
      const users = parseBulkCsv(csvText)
      if (users.length === 0) {
        setError('No valid users found in CSV')
        return
      }
      setSaving(true)
      const res = await bulkCreateAppUsers(users, ims)
      setResult(res)
      if (res.summary && res.summary.created > 0) {
        notify.success(`${res.summary.created} user(s) created successfully`)
      }
    } catch (e) {
      setError(e.message || 'Failed to process bulk users')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog size='L'>
      <Heading>Bulk Add Users</Heading>
      <Divider />
      <Content>
        <Flex direction='column' gap='size-200'>
          {error && <Well UNSAFE_style={{ background: '#ffebe6', borderColor: '#ff4d4f' }}><Text UNSAFE_style={{ color: '#cf1322' }}>{error}</Text></Well>}

          <Text>Paste CSV data with columns: <strong>email, firstName, lastName, roleId</strong></Text>
          <Text UNSAFE_style={{ fontSize: '12px', color: '#6e6e6e' }}>
            Available role IDs: {roles.map(r => `${r.roleId} (${r.name})`).join(', ')}
          </Text>

          <TextArea
            label='CSV Data'
            value={csvText}
            onChange={setCsvText}
            height='size-2400'
            placeholder={'email,firstName,lastName,roleId\njohn@company.com,John,Doe,role_viewer\njane@company.com,Jane,Smith,role_super_admin'}
          />

          {result && (
            <Well>
              <Heading level={4} margin={0} marginBottom='size-100'>Result</Heading>
              <Text>Created: {result.summary?.created || 0} | Skipped: {result.summary?.skipped || 0} | Failed: {result.summary?.failed || 0}</Text>
              {result.skipped && result.skipped.length > 0 && (
                <View marginTop='size-100'>
                  <Text UNSAFE_style={{ fontSize: '12px', color: '#b7791f' }}>
                    Skipped: {result.skipped.map(s => `${s.email} (${s.reason})`).join(', ')}
                  </Text>
                </View>
              )}
              {result.errors && result.errors.length > 0 && (
                <View marginTop='size-100'>
                  <Text UNSAFE_style={{ fontSize: '12px', color: '#cf1322' }}>
                    Errors: {result.errors.map(e => `${e.email}: ${e.error}`).join(', ')}
                  </Text>
                </View>
              )}
            </Well>
          )}
        </Flex>
      </Content>
      <ButtonGroup>
        <Button variant='secondary' onPress={onDone}>{result ? 'Done' : 'Cancel'}</Button>
        {!result && (
          <Button variant='accent' onPress={handleBulkAdd} isDisabled={saving || !csvText.trim()}>
            {saving ? <ProgressCircle size='S' isIndeterminate aria-label='Processing...' /> : 'Import Users'}
          </Button>
        )}
      </ButtonGroup>
    </Dialog>
  )
}

// ============ Roles Tab ============

function RolesTab ({ roles, features, ims, notify, onRefresh }) {
  const [showCreateRole, setShowCreateRole] = useState(false)

  return (
    <View marginTop='size-200'>
      <Flex justifyContent='space-between' alignItems='center' marginBottom='size-200'>
        <Text UNSAFE_style={{ color: '#6e6e6e' }}>Define custom roles with granular feature permissions.</Text>
        <DialogTrigger>
          <Button variant='accent'>
            <Add size='S' />
            <Text>Create Role</Text>
          </Button>
          {(close) => <RoleEditorDialog features={features} ims={ims} notify={notify} onDone={() => { close(); onRefresh() }} />}
        </DialogTrigger>
      </Flex>

      {roles.length === 0
        ? <Well><Text>No roles configured.</Text></Well>
        : (
          <Flex direction='column' gap='size-200'>
            {roles.map(role => (
              <RoleCard key={role.roleId} role={role} features={features} ims={ims} notify={notify} onRefresh={onRefresh} />
            ))}
          </Flex>
          )}
    </View>
  )
}

// ============ Role Card ============

function RoleCard ({ role, features, ims, notify, onRefresh }) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const enabledCount = Object.values(role.permissions || {}).filter(v => v === true).length
  const totalFeatures = Object.keys(FEATURE_LABELS).length

  async function handleDelete () {
    if (!window.confirm(`Delete role "${role.name}"? This cannot be undone.`)) return
    try {
      setDeleting(true)
      await deleteAppRole(role.roleId, ims)
      notify.success(`Role "${role.name}" deleted`)
      onRefresh()
    } catch (e) {
      notify.error(e.message || 'Failed to delete role')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Well UNSAFE_style={{ padding: '16px', borderRadius: '8px' }}>
      <Flex justifyContent='space-between' alignItems='start'>
        <Flex direction='column' gap='size-50' flex={1}>
          <Flex alignItems='center' gap='size-100'>
            <Heading level={4} margin={0}>{role.name}</Heading>
            {role.isSystem && (
              <span style={{ background: '#e6f7ff', color: '#0070b3', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                SYSTEM
              </span>
            )}
            <Text UNSAFE_style={{ fontSize: '12px', color: '#6e6e6e', marginLeft: '8px' }}>
              {enabledCount}/{totalFeatures} features enabled | {role.userCount || 0} user(s)
            </Text>
          </Flex>
          {role.description && <Text UNSAFE_style={{ fontSize: '13px', color: '#6e6e6e' }}>{role.description}</Text>}
        </Flex>
        <Flex gap='size-50'>
          <ActionButton isQuiet onPress={() => setExpanded(!expanded)}>
            <Text>{expanded ? 'Collapse' : 'View Permissions'}</Text>
          </ActionButton>
          {!role.isSystem && (
            <>
              <DialogTrigger>
                <ActionButton isQuiet aria-label='Edit role'>
                  <Edit size='S' />
                </ActionButton>
                {(close) => (
                  <RoleEditorDialog
                    role={role}
                    features={features}
                    ims={ims}
                    notify={notify}
                    onDone={() => { close(); onRefresh() }}
                  />
                )}
              </DialogTrigger>
              <ActionButton isQuiet aria-label='Delete role' onPress={handleDelete} isDisabled={deleting || (role.userCount || 0) > 0}>
                <Delete size='S' />
              </ActionButton>
            </>
          )}
        </Flex>
      </Flex>

      {expanded && (
        <View marginTop='size-200'>
          <Divider size='S' />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px', marginTop: '12px' }}>
            {Object.entries(FEATURE_LABELS).map(([key, meta]) => (
              <Flex key={key} alignItems='center' gap='size-100' UNSAFE_style={{ padding: '4px 8px', borderRadius: '4px', background: role.permissions?.[key] ? '#e6f7e6' : '#f5f5f5' }}>
                <StatusLight variant={role.permissions?.[key] ? 'positive' : 'neutral'} />
                <Flex direction='column'>
                  <Text UNSAFE_style={{ fontSize: '13px', fontWeight: 500 }}>{meta.label}</Text>
                  <Text UNSAFE_style={{ fontSize: '11px', color: '#6e6e6e' }}>{meta.description}</Text>
                </Flex>
              </Flex>
            ))}
          </div>
        </View>
      )}
    </Well>
  )
}

// ============ Role Editor Dialog (Create / Edit) ============

function RoleEditorDialog ({ role, features, ims, notify, onDone }) {
  const isEdit = !!role
  const [name, setName] = useState(role ? role.name : '')
  const [description, setDescription] = useState(role ? role.description || '' : '')
  const [permissions, setPermissions] = useState(() => {
    if (role && role.permissions) return { ...role.permissions }
    // Default: only dashboard enabled for new roles
    const defaults = {}
    for (const key of Object.keys(FEATURE_LABELS)) {
      defaults[key] = key === 'dashboard'
    }
    return defaults
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function togglePermission (key) {
    setPermissions(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function toggleAll (value) {
    const updated = {}
    for (const key of Object.keys(FEATURE_LABELS)) {
      updated[key] = value
    }
    setPermissions(updated)
  }

  async function handleSave () {
    setError('')
    if (!name.trim()) {
      setError('Role name is required')
      return
    }
    try {
      setSaving(true)
      if (isEdit) {
        await updateAppRole({ roleId: role.roleId, name: name.trim(), description: description.trim(), permissions }, ims)
        notify.success(`Role "${name.trim()}" updated`)
      } else {
        await createAppRole({ name: name.trim(), description: description.trim(), permissions }, ims)
        notify.success(`Role "${name.trim()}" created`)
      }
      onDone()
    } catch (e) {
      setError(e.message || 'Failed to save role')
    } finally {
      setSaving(false)
    }
  }

  const enabledCount = Object.values(permissions).filter(v => v).length

  return (
    <Dialog size='L'>
      <Heading>{isEdit ? `Edit Role: ${role.name}` : 'Create New Role'}</Heading>
      <Divider />
      <Content>
        <Flex direction='column' gap='size-200'>
          {error && <Well UNSAFE_style={{ background: '#ffebe6', borderColor: '#ff4d4f' }}><Text UNSAFE_style={{ color: '#cf1322' }}>{error}</Text></Well>}

          <TextField label='Role Name' value={name} onChange={setName} isRequired maxLength={60} autoFocus />
          <TextField label='Description' value={description} onChange={setDescription} maxLength={200} />

          <Divider size='S' />

          <Flex justifyContent='space-between' alignItems='center'>
            <Text><strong>Feature Permissions</strong> ({enabledCount}/{Object.keys(FEATURE_LABELS).length} enabled)</Text>
            <Flex gap='size-100'>
              <ActionButton isQuiet onPress={() => toggleAll(true)}>
                <Text>Enable All</Text>
              </ActionButton>
              <ActionButton isQuiet onPress={() => toggleAll(false)}>
                <Text>Disable All</Text>
              </ActionButton>
            </Flex>
          </Flex>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
            {Object.entries(FEATURE_LABELS).map(([key, meta]) => (
              <Flex
                key={key}
                alignItems='center'
                justifyContent='space-between'
                UNSAFE_style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  background: permissions[key] ? '#e6f7e6' : '#fafafa',
                  border: permissions[key] ? '1px solid #b7eb8f' : '1px solid #e8e8e8',
                  cursor: 'pointer'
                }}
                onClick={() => togglePermission(key)}
              >
                <Flex direction='column' gap='size-25'>
                  <Text UNSAFE_style={{ fontWeight: 500, fontSize: '13px' }}>{meta.label}</Text>
                  <Text UNSAFE_style={{ fontSize: '11px', color: '#6e6e6e' }}>{meta.description}</Text>
                </Flex>
                <Switch
                  isSelected={permissions[key] || false}
                  onChange={() => togglePermission(key)}
                  aria-label={meta.label}
                  isEmphasized
                />
              </Flex>
            ))}
          </div>

          {permissions.user_management && (
            <Well UNSAFE_style={{ background: '#fff7e6', borderColor: '#ffd591' }}>
              <Text UNSAFE_style={{ color: '#ad6800', fontSize: '13px' }}>
                Warning: This role grants access to Users & Roles management. Users with this role can create/modify other users and roles.
              </Text>
            </Well>
          )}
        </Flex>
      </Content>
      <ButtonGroup>
        <Button variant='secondary' onPress={onDone}>Cancel</Button>
        <Button variant='accent' onPress={handleSave} isDisabled={saving}>
          {saving ? <ProgressCircle size='S' isIndeterminate aria-label='Saving...' /> : (isEdit ? 'Save Changes' : 'Create Role')}
        </Button>
      </ButtonGroup>
    </Dialog>
  )
}

export default UserManagement
