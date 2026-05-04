import React, { useState, useEffect } from 'react'
import {
  Heading, View, Flex, Button, Text, ProgressCircle, Well, Divider,
  StatusLight, ActionButton, Tabs, TabList, TabPanels, Item
} from '@adobe/react-spectrum'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchFileDetail, updateVisibility, updateMetadata } from './actionInvoker'
import { useNotifications } from './NotificationProvider'
import { useApp } from './AppContext'
import useSwrCache from './useSwrCache'
import Edit from '@spectrum-icons/workflow/Edit'
import Copy from '@spectrum-icons/workflow/Copy'

function FileDetail ({ runtime, ims }) {
  const { master } = useParams()
  const navigate = useNavigate()
  const notify = useNotifications()
  const { hasPermission } = useApp()

  // SWR cache per master — show stale instantly, revalidate in background
  const fileSwr = useSwrCache(
    `file-detail-${master}`,
    () => fetchFileDetail(master, ims).then(r => r.file),
    { ttl: 2 * 60 * 1000 }
  )

  const file = fileSwr.data || null
  const loading = fileSwr.loading && !fileSwr.data
  const error = fileSwr.error && !fileSwr.data ? fileSwr.error : null

  async function handleToggleVisibility () {
    try {
      const newVisibility = file.visibility === 'public' ? 'private' : 'public'
      await updateVisibility(master, newVisibility, ims)
      notify.success(`Visibility updated to ${newVisibility}`)
      await fileSwr.refresh()
    } catch (e) {
      notify.error(e.message)
    }
  }

  async function handleToggleCrud () {
    try {
      const newCrud = !file.crudEnabled
      await updateMetadata(master, { crudEnabled: newCrud }, ims)
      notify.success(`CRUD operations ${newCrud ? 'enabled' : 'disabled'}`)
      await fileSwr.refresh()
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
          <Heading level={2}>Master Not Found</Heading>
          <Text>{error || 'The requested master does not exist.'}</Text>
          <Flex gap='size-100' marginTop='size-200'>
            <Button variant='secondary' onPress={() => navigate('/masters')}>Back to Masters</Button>
            {error && <Button variant='primary' onPress={() => fileSwr.refresh()}>Retry</Button>}
          </Flex>
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
            {file.masterName || file.entityName} • {file.recordCount} records
          </Text>
        </View>
        <Flex gap='size-100' wrap>
          <Button variant='secondary' onPress={() => navigate('/masters')}>Back</Button>
          {(hasPermission('masters') || hasPermission('record_management')) && (
            <Button variant='primary' onPress={() => navigate(`/masters/${master}/records`)}>Records</Button>
          )}
          {(hasPermission('masters') || hasPermission('schema_management')) && (
            <Button variant='primary' onPress={() => navigate(`/masters/${master}/schema`)}>Schema</Button>
          )}
          {(hasPermission('masters') || hasPermission('archive_management')) && (
            <Button variant='primary' onPress={() => navigate(`/masters/${master}/archives`)}>Archives</Button>
          )}
        </Flex>
      </Flex>

      {/* Tabbed Content */}
      <Tabs aria-label='Master details'>
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
                    <DetailRow label='Master Name' value={file.masterName || file.entityName} />
                    <DetailRow label='Display Name' value={file.displayName} />
                    <DetailRow label='Description' value={file.description || '—'} />
                    <DetailRow label='Primary Key' value={file.primaryKey} />
                    <DetailRow label='Record Count' value={String(file.recordCount)} />
                    <DetailRow label='Created By' value={file.createdBy || '—'} />
                    <DetailRow label='Created At' value={file.createdAt ? new Date(file.createdAt).toLocaleString() : '—'} />
                    <DetailRow label='Updated At' value={file.updatedAt ? new Date(file.updatedAt).toLocaleString() : '—'} />
                    <DetailRow label='Last Modified By' value={file.lastModifiedBy || file.createdBy || '—'} />
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
                      <Flex alignItems='center' gap='size-100'>
                        <StatusLight variant={file.crudEnabled ? 'positive' : 'neutral'}>
                          {file.crudEnabled ? 'Enabled' : 'Read-only'}
                        </StatusLight>
                        <ActionButton isQuiet onPress={handleToggleCrud}>
                          <Edit size='S' />
                        </ActionButton>
                      </Flex>
                    </Flex>
                    <Divider size='S' />

                    {file.allowedOperations && (
                      <View>
                        <Text UNSAFE_style={{ fontWeight: '600' }} marginBottom='size-100'>Allowed Operations</Text>
                        <Flex wrap gap='size-75'>
                          {Object.entries(file.allowedOperations).map(([op, allowed]) => {
                            const isWriteOp = op !== 'read'
                            const isActive = allowed && (!isWriteOp || file.crudEnabled)
                            return (
                              <StatusLight key={op} variant={isActive ? 'positive' : 'neutral'} size='S'>
                                {op}
                              </StatusLight>
                            )
                          })}
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
                <Button variant='primary' onPress={() => navigate(`/masters/${master}/schema`)}>
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
              {/* ── Queries ── */}
              <View UNSAFE_className='mdm-card' marginBottom='size-200'>
                <Heading level={3} marginBottom='size-200'>API Mesh — Queries</Heading>
                <Text marginBottom='size-200'>
                  Use the API Mesh GraphQL endpoint to query this master's data
                  {file.visibility === 'private' && ' (requires auth header)'}:
                </Text>

                {/* Query All Records */}
                <div className='mdm-code-block' style={{ marginBottom: 12 }}>
                  <div className='mdm-code-block__header'>
                    <span>Query All Records (Paginated)</span>
                    <ActionButton isQuiet onPress={() => copyToClipboard(`query {\n  mdmQuery(master: "${master}", page: 1, pageSize: 25) {\n    master\n    count\n    page\n    pageSize\n    total\n    data\n  }\n}`)}>
                      <Copy size='S' />
                    </ActionButton>
                  </div>
                  <pre className='mdm-code-block__content'>{`query {
  mdmQuery(master: "${master}", page: 1, pageSize: 25) {
    master
    count
    page
    pageSize
    total
    data
  }
}`}</pre>
                </div>

                {/* Query with Filters & Sorting */}
                <div className='mdm-code-block' style={{ marginBottom: 12 }}>
                  <div className='mdm-code-block__header'>
                    <span>Query with Filters & Sorting</span>
                    <ActionButton isQuiet onPress={() => copyToClipboard(`query {\n  mdmQuery(\n    master: "${master}"\n    filters: "field=value"\n    sort: "${file.primaryKey}"\n    order: "asc"\n    page: 1\n    pageSize: 25\n  ) {\n    master\n    count\n    page\n    pageSize\n    total\n    data\n    aggregations {\n      field\n      label\n      values { value count }\n    }\n  }\n}`)}>
                      <Copy size='S' />
                    </ActionButton>
                  </div>
                  <pre className='mdm-code-block__content'>{`query {
  mdmQuery(
    master: "${master}"
    filters: "field=value"
    sort: "${file.primaryKey}"
    order: "asc"
    page: 1
    pageSize: 25
  ) {
    master
    count
    page
    pageSize
    total
    data
    aggregations {
      field
      label
      values { value count }
    }
  }
}`}</pre>
                </div>

                {/* Query with Facets */}
                <div className='mdm-code-block' style={{ marginBottom: 12 }}>
                  <div className='mdm-code-block__header'>
                    <span>Query with Facets</span>
                    <ActionButton isQuiet onPress={() => copyToClipboard(`query {\n  mdmQuery(\n    master: "${master}"\n    facets: "true"\n    page: 1\n    pageSize: 25\n  ) {\n    master\n    count\n    page\n    pageSize\n    total\n    data\n    aggregations {\n      field\n      label\n      type\n      showCount\n      collapsed\n      values { value count selected }\n    }\n  }\n}`)}>
                      <Copy size='S' />
                    </ActionButton>
                  </div>
                  <pre className='mdm-code-block__content'>{`query {
  mdmQuery(
    master: "${master}"
    facets: "true"
    page: 1
    pageSize: 25
  ) {
    master
    count
    page
    pageSize
    total
    data
    aggregations {
      field
      label
      type
      showCount
      collapsed
      values { value count selected }
    }
  }
}`}</pre>
                </div>

                {/* Get Single Record */}
                <div className='mdm-code-block' style={{ marginBottom: 12 }}>
                  <div className='mdm-code-block__header'>
                    <span>Get Single Record</span>
                    <ActionButton isQuiet onPress={() => copyToClipboard(`query {\n  mdmRecord(master: "${master}", id: "1") {\n    master\n    data\n  }\n}`)}>
                      <Copy size='S' />
                    </ActionButton>
                  </div>
                  <pre className='mdm-code-block__content'>{`query {
  mdmRecord(master: "${master}", id: "1") {
    master
    data
  }
}`}</pre>
                </div>

                {/* Bulk Fetch by IDs */}
                <div className='mdm-code-block' style={{ marginBottom: 12 }}>
                  <div className='mdm-code-block__header'>
                    <span>Bulk Fetch by IDs</span>
                    <ActionButton isQuiet onPress={() => copyToClipboard(`query {\n  mdmBulkFetch(master: "${master}", ids: "1,2,3") {\n    master\n    count\n    requested\n    data\n    notFound\n  }\n}`)}>
                      <Copy size='S' />
                    </ActionButton>
                  </div>
                  <pre className='mdm-code-block__content'>{`query {
  mdmBulkFetch(master: "${master}", ids: "1,2,3") {
    master
    count
    requested
    data
    notFound
  }
}`}</pre>
                </div>

                {/* Get Facets Configuration */}
                <div className='mdm-code-block'>
                  <div className='mdm-code-block__header'>
                    <span>Get Facets Configuration</span>
                    <ActionButton isQuiet onPress={() => copyToClipboard(`query {\n  mdmFacets(master: "${master}", values: "true") {\n    master\n    facetsEnabled\n    totalFields\n    facetableFields\n    totalRecords\n    facets {\n      field\n      label\n      type\n      sortBy\n      sortOrder\n      limit\n      showCount\n      collapsed\n      fieldType\n      values { value count }\n      totalValues\n    }\n  }\n}`)}>
                      <Copy size='S' />
                    </ActionButton>
                  </div>
                  <pre className='mdm-code-block__content'>{`query {
  mdmFacets(master: "${master}", values: "true") {
    master
    facetsEnabled
    totalFields
    facetableFields
    totalRecords
    facets {
      field
      label
      type
      sortBy
      sortOrder
      limit
      showCount
      collapsed
      fieldType
      values { value count }
      totalValues
    }
  }
}`}</pre>
                </div>
              </View>

              {/* ── CRUD Mutations ── */}
              {file.visibility === 'public' && file.crudEnabled
                ? (
                  <View UNSAFE_className='mdm-card' marginBottom='size-200'>
                    <Flex justifyContent='space-between' alignItems='center' marginBottom='size-200'>
                      <Heading level={3}>API Mesh — CRUD Mutations</Heading>
                      <StatusLight variant='positive'>Enabled</StatusLight>
                    </Flex>
                    <Text marginBottom='size-100'>
                      These mutations require <code className='mdm-code-inline'>x-partner-id</code> and <code className='mdm-code-inline'>x-partner-key</code> headers.
                      Manage partners in the <a href='#/partners'>Integration Partners</a> console.
                    </Text>
                    <Well marginBottom='size-200'>
                      <Text><strong>Authentication:</strong> Pass <code className='mdm-code-inline'>x-partner-id</code> and <code className='mdm-code-inline'>x-partner-key</code> HTTP headers with every mutation request. Primary keys are auto-generated as sequential integers if not provided.</Text>
                    </Well>

                    {/* Create */}
                    {(!file.allowedOperations || file.allowedOperations.create) && (
                      <View marginBottom='size-200'>
                        <div className='mdm-code-block'>
                          <div className='mdm-code-block__header'>
                            <span>Create Record</span>
                            <ActionButton isQuiet onPress={() => copyToClipboard(`mutation {\n  mdmCreate(\n    master: "${master}"\n    input: { data: "{\\"field\\":\\"value\\"}" }\n  ) {\n    success\n    master\n    operation\n    record\n    error\n  }\n}`)}>
                              <Copy size='S' />
                            </ActionButton>
                          </div>
                          <pre className='mdm-code-block__content'>{`mutation {
  mdmCreate(
    master: "${master}"
    input: { data: "{\\"field\\":\\"value\\"}" }
  ) {
    success
    master
    operation
    record
    error
  }
}`}</pre>
                        </div>
                      </View>
                    )}

                    {/* Update (Full Replace) */}
                    {(!file.allowedOperations || file.allowedOperations.update) && (
                      <View marginBottom='size-200'>
                        <div className='mdm-code-block'>
                          <div className='mdm-code-block__header'>
                            <span>Update Record (Full Replace)</span>
                            <ActionButton isQuiet onPress={() => copyToClipboard(`mutation {\n  mdmUpdate(\n    master: "${master}"\n    id: "RECORD_ID"\n    input: { data: "{\\"field\\":\\"new_value\\"}" }\n  ) {\n    success\n    master\n    operation\n    record\n    error\n  }\n}`)}>
                              <Copy size='S' />
                            </ActionButton>
                          </div>
                          <pre className='mdm-code-block__content'>{`mutation {
  mdmUpdate(
    master: "${master}"
    id: "RECORD_ID"
    input: { data: "{\\"field\\":\\"new_value\\"}" }
  ) {
    success
    master
    operation
    record
    error
  }
}`}</pre>
                        </div>
                      </View>
                    )}

                    {/* Patch (Partial Update) */}
                    {(!file.allowedOperations || file.allowedOperations.update) && (
                      <View marginBottom='size-200'>
                        <div className='mdm-code-block'>
                          <div className='mdm-code-block__header'>
                            <span>Patch Record (Partial Update)</span>
                            <ActionButton isQuiet onPress={() => copyToClipboard(`mutation {\n  mdmPatch(\n    master: "${master}"\n    id: "RECORD_ID"\n    input: { data: "{\\"field\\":\\"patched_value\\"}" }\n  ) {\n    success\n    master\n    operation\n    record\n    error\n  }\n}`)}>
                              <Copy size='S' />
                            </ActionButton>
                          </div>
                          <pre className='mdm-code-block__content'>{`mutation {
  mdmPatch(
    master: "${master}"
    id: "RECORD_ID"
    input: { data: "{\\"field\\":\\"patched_value\\"}" }
  ) {
    success
    master
    operation
    record
    error
  }
}`}</pre>
                        </div>
                      </View>
                    )}

                    {/* Delete */}
                    {(!file.allowedOperations || file.allowedOperations.delete) && (
                      <View marginBottom='size-200'>
                        <div className='mdm-code-block'>
                          <div className='mdm-code-block__header'>
                            <span>Delete Record</span>
                            <ActionButton isQuiet onPress={() => copyToClipboard(`mutation {\n  mdmDelete(\n    master: "${master}"\n    id: "RECORD_ID"\n  ) {\n    success\n    master\n    operation\n    id\n    error\n  }\n}`)}>
                              <Copy size='S' />
                            </ActionButton>
                          </div>
                          <pre className='mdm-code-block__content'>{`mutation {
  mdmDelete(
    master: "${master}"
    id: "RECORD_ID"
  ) {
    success
    master
    operation
    id
    error
  }
}`}</pre>
                        </div>
                      </View>
                    )}
                  </View>
                  )
                : (
                  <View UNSAFE_className='mdm-card' marginBottom='size-200'>
                    <Heading level={3} marginBottom='size-200'>API Mesh — CRUD Mutations</Heading>
                    <Well>
                      <Text>
                        {file.visibility !== 'public'
                          ? 'Public CRUD mutations are only available for masters with public visibility. Change the visibility above to enable.'
                          : 'CRUD operations are currently disabled for this master. Enable them in the Configuration tab.'}
                      </Text>
                    </Well>
                  </View>
                  )}

              {/* ── Bulk Mutations ── */}
              {file.visibility === 'public' && file.crudEnabled
                ? (
                  <View UNSAFE_className='mdm-card' marginBottom='size-200'>
                    <Flex justifyContent='space-between' alignItems='center' marginBottom='size-200'>
                      <Heading level={3}>API Mesh — Bulk Operations</Heading>
                      <StatusLight variant='positive'>Enabled</StatusLight>
                    </Flex>
                    <Text marginBottom='size-200'>
                      Process multiple records in a single API call. All bulk mutations require <code className='mdm-code-inline'>x-partner-id</code> and <code className='mdm-code-inline'>x-partner-key</code> headers.
                    </Text>

                    {/* Bulk Create */}
                    {(!file.allowedOperations || file.allowedOperations.create) && (
                      <View marginBottom='size-200'>
                        <div className='mdm-code-block'>
                          <div className='mdm-code-block__header'>
                            <span>Bulk Create</span>
                            <ActionButton isQuiet onPress={() => copyToClipboard(`mutation {\n  mdmBulkCreate(\n    master: "${master}"\n    input: { data: "[{\\"field\\":\\"value1\\"},{\\"field\\":\\"value2\\"}]" }\n  ) {\n    master\n    operation\n    total\n    succeeded\n    failed\n    results {\n      success\n      id\n      error\n    }\n  }\n}`)}>
                              <Copy size='S' />
                            </ActionButton>
                          </div>
                          <pre className='mdm-code-block__content'>{`mutation {
  mdmBulkCreate(
    master: "${master}"
    input: { data: "[{\\"field\\":\\"value1\\"},{\\"field\\":\\"value2\\"}]" }
  ) {
    master
    operation
    total
    succeeded
    failed
    results {
      success
      id
      error
    }
  }
}`}</pre>
                        </div>
                      </View>
                    )}

                    {/* Bulk Update */}
                    {(!file.allowedOperations || file.allowedOperations.update) && (
                      <View marginBottom='size-200'>
                        <div className='mdm-code-block'>
                          <div className='mdm-code-block__header'>
                            <span>Bulk Update (Full Replace)</span>
                            <ActionButton isQuiet onPress={() => copyToClipboard(`mutation {\n  mdmBulkUpdate(\n    master: "${master}"\n    input: { data: "[{\\"id\\":\\"1\\",\\"data\\":{\\"field\\":\\"updated\\"}},{\\"id\\":\\"2\\",\\"data\\":{\\"field\\":\\"updated\\"}}]" }\n  ) {\n    master\n    operation\n    total\n    succeeded\n    failed\n    results {\n      success\n      id\n      error\n    }\n  }\n}`)}>
                              <Copy size='S' />
                            </ActionButton>
                          </div>
                          <pre className='mdm-code-block__content'>{`mutation {
  mdmBulkUpdate(
    master: "${master}"
    input: { data: "[{\\"id\\":\\"1\\",\\"data\\":{\\"field\\":\\"updated\\"}},{\\"id\\":\\"2\\",\\"data\\":{\\"field\\":\\"updated\\"}}]" }
  ) {
    master
    operation
    total
    succeeded
    failed
    results {
      success
      id
      error
    }
  }
}`}</pre>
                        </div>
                      </View>
                    )}

                    {/* Bulk Patch */}
                    {(!file.allowedOperations || file.allowedOperations.update) && (
                      <View marginBottom='size-200'>
                        <div className='mdm-code-block'>
                          <div className='mdm-code-block__header'>
                            <span>Bulk Patch (Partial Update)</span>
                            <ActionButton isQuiet onPress={() => copyToClipboard(`mutation {\n  mdmBulkPatch(\n    master: "${master}"\n    input: { data: "[{\\"id\\":\\"1\\",\\"data\\":{\\"field\\":\\"patched\\"}}]" }\n  ) {\n    master\n    operation\n    total\n    succeeded\n    failed\n    results {\n      success\n      id\n      error\n    }\n  }\n}`)}>
                              <Copy size='S' />
                            </ActionButton>
                          </div>
                          <pre className='mdm-code-block__content'>{`mutation {
  mdmBulkPatch(
    master: "${master}"
    input: { data: "[{\\"id\\":\\"1\\",\\"data\\":{\\"field\\":\\"patched\\"}}]" }
  ) {
    master
    operation
    total
    succeeded
    failed
    results {
      success
      id
      error
    }
  }
}`}</pre>
                        </div>
                      </View>
                    )}

                    {/* Bulk Delete */}
                    {(!file.allowedOperations || file.allowedOperations.delete) && (
                      <View marginBottom='size-200'>
                        <div className='mdm-code-block'>
                          <div className='mdm-code-block__header'>
                            <span>Bulk Delete</span>
                            <ActionButton isQuiet onPress={() => copyToClipboard(`mutation {\n  mdmBulkDelete(\n    master: "${master}"\n    input: { data: "[\\"1\\",\\"2\\",\\"3\\"]" }\n  ) {\n    master\n    operation\n    total\n    succeeded\n    failed\n    results {\n      success\n      id\n      error\n    }\n  }\n}`)}>
                              <Copy size='S' />
                            </ActionButton>
                          </div>
                          <pre className='mdm-code-block__content'>{`mutation {
  mdmBulkDelete(
    master: "${master}"
    input: { data: "[\\"1\\",\\"2\\",\\"3\\"]" }
  ) {
    master
    operation
    total
    succeeded
    failed
    results {
      success
      id
      error
    }
  }
}`}</pre>
                        </div>
                      </View>
                    )}
                  </View>
                  )
                : (
                  <View UNSAFE_className='mdm-card' marginBottom='size-200'>
                    <Heading level={3} marginBottom='size-200'>API Mesh — Bulk Operations</Heading>
                    <Well>
                      <Text>
                        {file.visibility !== 'public'
                          ? 'Bulk mutations are only available for masters with public visibility and CRUD enabled.'
                          : 'Bulk operations require CRUD to be enabled. Enable CRUD in the Configuration tab.'}
                      </Text>
                    </Well>
                  </View>
                  )}

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
                  <Heading level={3} marginBottom='size-200'>CRUD Operations</Heading>
                  <Text marginBottom='size-200'>
                    {file.crudEnabled
                      ? 'CRUD (Create, Read, Update, Delete) operations are enabled for this master. Partners can mutate records via API Mesh.'
                      : 'CRUD operations are disabled. Only read access is available via API Mesh. Enable to allow partners to create, update, and delete records.'}
                  </Text>
                  <Flex alignItems='center' gap='size-200'>
                    <StatusLight variant={file.crudEnabled ? 'positive' : 'neutral'}>
                      {file.crudEnabled ? 'Enabled' : 'Read-only'}
                    </StatusLight>
                    <Button
                      variant={file.crudEnabled ? 'negative' : 'primary'}
                      style='outline'
                      onPress={handleToggleCrud}
                    >
                      {file.crudEnabled ? 'Disable CRUD' : 'Enable CRUD'}
                    </Button>
                  </Flex>
                </View>

                <View UNSAFE_className='mdm-card'>
                  <Heading level={3} marginBottom='size-200'>Schema</Heading>
                  <div className='mdm-detail-list'>
                    <DetailRow label='Schema Version' value={file.schemaVersionId} />
                  </div>
                </View>

                {/* Partner Integration Info */}
                {file.visibility === 'public' && file.crudEnabled && (
                  <View UNSAFE_className='mdm-card'>
                    <Heading level={3} marginBottom='size-200'>API Integration</Heading>
                    <Text marginBottom='size-200'>
                      CRUD mutations for this master are available via API Mesh.
                      Partners must be onboarded via the Integration Partners console to get credentials.
                    </Text>
                    <Button variant='primary' onPress={() => navigate('/partners')}>
                      Manage Partners
                    </Button>
                  </View>
                )}
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
