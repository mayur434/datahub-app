import React, { useState, useEffect } from 'react'
import {
  Heading, View, Flex, Button, Text, ProgressCircle, Well, Divider,
  StatusLight, ActionButton, Tabs, TabList, TabPanels, Item
} from '@adobe/react-spectrum'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchFileDetail, updateVisibility, updateMetadata } from './actionInvoker'
import { useNotifications } from './NotificationProvider'
import Edit from '@spectrum-icons/workflow/Edit'
import Copy from '@spectrum-icons/workflow/Copy'

function FileDetail ({ runtime, ims }) {
  const { entity } = useParams()
  const navigate = useNavigate()
  const notify = useNotifications()
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadFileDetail()
  }, [entity])

  async function loadFileDetail () {
    try {
      setLoading(true)
      const result = await fetchFileDetail(entity, ims)
      setFile(result.file)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleVisibility () {
    try {
      const newVisibility = file.visibility === 'public' ? 'private' : 'public'
      await updateVisibility(entity, newVisibility, ims)
      notify.success(`Visibility updated to ${newVisibility}`)
      await loadFileDetail()
    } catch (e) {
      notify.error(e.message)
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

  if (error || !file) {
    return (
      <View UNSAFE_className='mdm-page'>
        <div className='mdm-empty-state'>
          <div className='mdm-empty-state__icon'>⚠</div>
          <Heading level={2}>Entity Not Found</Heading>
          <Text>{error || 'The requested entity does not exist.'}</Text>
          <Button variant='secondary' marginTop='size-200' onPress={() => navigate('/files')}>Back to Entities</Button>
        </div>
      </View>
    )
  }

  return (
    <View UNSAFE_className='mdm-page'>
      {/* Page Header */}
      <Flex justifyContent='space-between' alignItems='start' marginBottom='size-300'>
        <View>
          <Flex alignItems='center' gap='size-150'>
            <Heading level={1} UNSAFE_className='mdm-page__title'>{file.displayName}</Heading>
            <StatusLight variant={file.visibility === 'public' ? 'positive' : 'neutral'}>
              {file.visibility}
            </StatusLight>
          </Flex>
          <Text UNSAFE_className='mdm-page__subtitle'>
            {file.entityName} • {file.recordCount} records • Version {file.activeVersionId}
          </Text>
        </View>
        <Flex gap='size-100' wrap>
          <Button variant='secondary' onPress={() => navigate('/files')}>Back</Button>
          <Button variant='primary' onPress={() => navigate(`/files/${entity}/records`)}>Records</Button>
          <Button variant='primary' onPress={() => navigate(`/files/${entity}/schema`)}>Schema</Button>
          <Button variant='primary' onPress={() => navigate(`/files/${entity}/versions`)}>Versions</Button>
          <Button variant='primary' onPress={() => navigate(`/files/${entity}/archives`)}>Archives</Button>
        </Flex>
      </Flex>

      {/* Tabbed Content */}
      <Tabs aria-label='Entity details'>
        <TabList>
          <Item key='overview'>Overview</Item>
          <Item key='schema'>Schema</Item>
          <Item key='api'>API Endpoints</Item>
          <Item key='config'>Configuration</Item>
        </TabList>
        <TabPanels>
          {/* Overview Tab */}
          <Item key='overview'>
            <View paddingTop='size-300'>
              <div className='mdm-detail-grid'>
                <View UNSAFE_className='mdm-card'>
                  <Heading level={3} marginBottom='size-200'>Metadata</Heading>
                  <div className='mdm-detail-list'>
                    <DetailRow label='Entity Name' value={file.entityName} />
                    <DetailRow label='Display Name' value={file.displayName} />
                    <DetailRow label='Description' value={file.description || '—'} />
                    <DetailRow label='Primary Key' value={file.primaryKey} />
                    <DetailRow label='Record Count' value={String(file.recordCount)} />
                    <DetailRow label='Created By' value={file.createdBy || '—'} />
                    <DetailRow label='Created At' value={file.createdAt ? new Date(file.createdAt).toLocaleString() : '—'} />
                    <DetailRow label='Updated At' value={file.updatedAt ? new Date(file.updatedAt).toLocaleString() : '—'} />
                  </div>
                </View>

                <View UNSAFE_className='mdm-card'>
                  <Heading level={3} marginBottom='size-200'>Status & Operations</Heading>
                  <Flex direction='column' gap='size-150'>
                    <Flex justifyContent='space-between' alignItems='center'>
                      <Text>Visibility</Text>
                      <Flex alignItems='center' gap='size-100'>
                        <StatusLight variant={file.visibility === 'public' ? 'positive' : 'neutral'}>
                          {file.visibility}
                        </StatusLight>
                        <ActionButton isQuiet onPress={handleToggleVisibility}>
                          <Edit size='S' />
                        </ActionButton>
                      </Flex>
                    </Flex>
                    <Divider size='S' />
                    <Flex justifyContent='space-between' alignItems='center'>
                      <Text>CRUD Operations</Text>
                      <StatusLight variant={file.crudEnabled ? 'positive' : 'neutral'}>
                        {file.crudEnabled ? 'Enabled' : 'Read-only'}
                      </StatusLight>
                    </Flex>
                    <Divider size='S' />

                    {file.allowedOperations && (
                      <View>
                        <Text UNSAFE_style={{ fontWeight: '600' }} marginBottom='size-100'>Allowed Operations</Text>
                        <Flex wrap gap='size-75'>
                          {Object.entries(file.allowedOperations).map(([op, allowed]) => (
                            <StatusLight key={op} variant={allowed ? 'positive' : 'neutral'} size='S'>
                              {op}
                            </StatusLight>
                          ))}
                        </Flex>
                      </View>
                    )}
                  </Flex>
                </View>
              </div>
            </View>
          </Item>

          {/* Schema Tab */}
          <Item key='schema'>
            <View paddingTop='size-300'>
              <Flex justifyContent='space-between' alignItems='center' marginBottom='size-200'>
                <Text>Schema Version: <strong>{file.schemaVersionId}</strong></Text>
                <Button variant='primary' onPress={() => navigate(`/files/${entity}/schema`)}>
                  Edit Schema
                </Button>
              </Flex>
              <table className='mdm-table'>
                <thead>
                  <tr>
                    <th>Field Name</th>
                    <th>Type</th>
                    <th>Required</th>
                    <th>Queryable</th>
                    <th>Editable</th>
                    <th>Primary Key</th>
                  </tr>
                </thead>
                <tbody>
                  {file.schema && file.schema.map(field => (
                    <tr key={field.name}>
                      <td><strong>{field.name}</strong></td>
                      <td><code className='mdm-code-inline'>{field.type}</code></td>
                      <td><StatusLight variant={field.required ? 'positive' : 'neutral'}>{field.required ? 'Yes' : 'No'}</StatusLight></td>
                      <td><StatusLight variant={field.queryable ? 'positive' : 'neutral'}>{field.queryable ? 'Yes' : 'No'}</StatusLight></td>
                      <td><StatusLight variant={field.editable ? 'positive' : 'neutral'}>{field.editable ? 'Yes' : 'No'}</StatusLight></td>
                      <td>{field.name === file.primaryKey ? '✓' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </View>
          </Item>

          {/* API Tab */}
          <Item key='api'>
            <View paddingTop='size-300'>
              <View UNSAFE_className='mdm-card' marginBottom='size-200'>
                <Heading level={3} marginBottom='size-200'>API Mesh (Public)</Heading>
                <Text marginBottom='size-200'>
                  Use the API Mesh GraphQL endpoint to query this entity's data publicly
                  {file.visibility === 'private' && ' (requires auth header)'}:
                </Text>
                <div className='mdm-code-block'>
                  <div className='mdm-code-block__header'>
                    <span>GraphQL Query</span>
                    <ActionButton isQuiet onPress={() => copyToClipboard(`query {\n  mdmQuery(entity: "${entity}") {\n    entity count total data\n  }\n}`)}>
                      <Copy size='S' />
                    </ActionButton>
                  </div>
                  <pre className='mdm-code-block__content'>{`query {
  mdmQuery(entity: "${entity}", page: 1, pageSize: 20) {
    entity
    count
    total
    data
  }
}`}</pre>
                </div>
              </View>

              <View UNSAFE_className='mdm-card' marginBottom='size-200'>
                <Heading level={3} marginBottom='size-200'>Admin Actions</Heading>
                <Text marginBottom='size-200'>These endpoints are IMS-secured and used by the admin UI:</Text>
                <table className='mdm-table mdm-table--compact'>
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td><code>query-data</code></td><td>Preview records (admin only)</td></tr>
                    <tr><td><code>record-crud</code></td><td>Create/Update/Patch/Delete single record</td></tr>
                    <tr><td><code>full-update</code></td><td>Replace all records with new CSV</td></tr>
                    <tr><td><code>delta-update</code></td><td>Incremental update (upsert/insert/update/mixed)</td></tr>
                    <tr><td><code>bulk-update</code></td><td>Bulk operations with dry-run support</td></tr>
                    <tr><td><code>schema-update</code></td><td>Add/remove/rename/update schema fields</td></tr>
                    <tr><td><code>version-rollback</code></td><td>Rollback to previous version</td></tr>
                  </tbody>
                </table>
              </View>

              {file.schema && (
                <View UNSAFE_className='mdm-card'>
                  <Heading level={3} marginBottom='size-200'>Queryable Fields</Heading>
                  <Text marginBottom='size-100'>These fields can be used as filter parameters in API queries:</Text>
                  <Flex wrap gap='size-100'>
                    {file.schema.filter(f => f.queryable).map(f => (
                      <code key={f.name} className='mdm-code-badge'>{f.name}</code>
                    ))}
                  </Flex>
                </View>
              )}
            </View>
          </Item>

          {/* Config Tab */}
          <Item key='config'>
            <View paddingTop='size-300'>
              <Flex direction='column' gap='size-200'>
                <View UNSAFE_className='mdm-card'>
                  <Heading level={3} marginBottom='size-200'>Versioning</Heading>
                  <div className='mdm-detail-list'>
                    <DetailRow label='Active Version' value={file.activeVersionId} />
                    <DetailRow label='Schema Version' value={file.schemaVersionId} />
                  </div>
                  <Button variant='secondary' marginTop='size-200' onPress={() => navigate(`/files/${entity}/versions`)}>
                    View Version History
                  </Button>
                </View>
              </Flex>
            </View>
          </Item>
        </TabPanels>
      </Tabs>
    </View>
  )
}

function DetailRow ({ label, value }) {
  return (
    <div className='mdm-detail-list__row'>
      <span className='mdm-detail-list__label'>{label}</span>
      <span className='mdm-detail-list__value'>{value}</span>
    </div>
  )
}

export default FileDetail
