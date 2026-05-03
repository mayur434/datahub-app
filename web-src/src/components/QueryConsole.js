import React, { useState, useEffect, useMemo } from 'react'
import {
  Heading, View, Flex, Button, TextField, Text,
  Picker, Item
} from '@adobe/react-spectrum'
import { fetchFileList, fetchFileDetail, queryData, invokeAction } from './actionInvoker'
import { useNotifications } from './NotificationProvider'
import Code from '@spectrum-icons/workflow/Code'

/* ─── Constants ─── */
const MESH_ENDPOINT = 'https://graph.adobe.io/api/YOUR_MESH_ID/graphql'
const METHOD_COLORS = {
  GET: '#12805C',
  POST: '#1473E6',
  PUT: '#E68619',
  PATCH: '#7C3AED',
  DELETE: '#D7373F'
}

/* ─── Operation definitions (dynamically populated per master) ─── */
function buildOperations (master, meta) {
  const m = master || 'your-master'
  const pk = meta?.primaryKey || 'id'
  const isPublic = meta?.visibility === 'public'
  const isCrud = meta?.crudEnabled === true

  const queries = [
    {
      id: 'query-all',
      name: 'Query All Records',
      group: 'Queries',
      method: 'POST',
      httpMethod: 'GET',
      description: 'Paginated list of all records with optional filters, sorting, and field selection.',
      graphql: `query {
  mdmQuery(master: "${m}", page: 1, pageSize: 25) {
    master
    count
    page
    pageSize
    total
    data
  }
}`,
      variables: null
    },
    {
      id: 'query-filter',
      name: 'Query with Filters',
      group: 'Queries',
      method: 'POST',
      httpMethod: 'GET',
      description: 'Filter records by field values. Use comma-separated key=value pairs. Filters combine with AND logic.',
      graphql: `query {
  mdmQuery(
    master: "${m}"
    filters: "status=active,brand=Nike"
    sort: "${pk}"
    order: "asc"
    fields: "${pk},name"
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
}`,
      variables: null,
      notes: 'Filters use key=value format, separated by commas. Example: "status=active,brand=Nike"'
    },
    {
      id: 'query-facets',
      name: 'Query with Facets',
      group: 'Queries',
      method: 'POST',
      httpMethod: 'GET',
      description: 'Include aggregation/facet data in the response for faceted navigation.',
      graphql: `query {
  mdmQuery(
    master: "${m}"
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
}`,
      variables: null
    },
    {
      id: 'record-single',
      name: 'Get Single Record',
      group: 'Queries',
      method: 'POST',
      httpMethod: 'GET',
      description: `Fetch a single record by its primary key (${pk}).`,
      graphql: `query {
  mdmRecord(master: "${m}", id: "RECORD_ID") {
    master
    data
  }
}`,
      variables: null
    },
    {
      id: 'bulk-fetch',
      name: 'Bulk Fetch by IDs',
      group: 'Queries',
      method: 'POST',
      httpMethod: 'GET',
      description: 'Fetch multiple records by comma-separated IDs in a single call.',
      graphql: `query {
  mdmBulkFetch(master: "${m}", ids: "ID1,ID2,ID3") {
    master
    count
    requested
    data
    notFound
  }
}`,
      variables: null
    },
    {
      id: 'facets-config',
      name: 'Get Facets Configuration',
      group: 'Queries',
      method: 'POST',
      httpMethod: 'GET',
      description: 'Retrieve facet metadata and optionally live aggregated values for faceted search UIs.',
      graphql: `query {
  mdmFacets(master: "${m}", values: "true") {
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
}`,
      variables: null
    }
  ]

  const mutations = []
  if (isPublic && isCrud) {
    mutations.push(
      {
        id: 'create-record',
        name: 'Create Record',
        group: 'Mutations',
        method: 'POST',
        httpMethod: 'POST',
        description: `Create a new record. Must include the primary key field (${pk}). Requires x-partner-id and x-partner-key headers.`,
        graphql: `mutation {
  mdmCreate(
    master: "${m}"
    data: "{\\"${pk}\\":\\"NEW-001\\",\\"name\\":\\"New Record\\"}"
  ) {
    success
    master
    operation
    record
    error
  }
}`,
        variables: null,
        requiresAuth: true
      },
      {
        id: 'update-record',
        name: 'Update Record (Full)',
        group: 'Mutations',
        method: 'POST',
        httpMethod: 'PUT',
        description: 'Full replacement of an existing record. All fields in data replace the existing record. Requires partner auth headers.',
        graphql: `mutation {
  mdmUpdate(
    master: "${m}"
    id: "RECORD_ID"
    data: "{\\"${pk}\\":\\"RECORD_ID\\",\\"name\\":\\"Updated Record\\"}"
  ) {
    success
    master
    operation
    record
    error
  }
}`,
        variables: null,
        requiresAuth: true
      },
      {
        id: 'patch-record',
        name: 'Patch Record (Partial)',
        group: 'Mutations',
        method: 'POST',
        httpMethod: 'PATCH',
        description: 'Partial update — only provided fields are merged into the existing record. Requires partner auth headers.',
        graphql: `mutation {
  mdmPatch(
    master: "${m}"
    id: "RECORD_ID"
    data: "{\\"name\\":\\"Patched Name\\"}"
  ) {
    success
    master
    operation
    record
    error
  }
}`,
        variables: null,
        requiresAuth: true
      },
      {
        id: 'delete-record',
        name: 'Delete Record',
        group: 'Mutations',
        method: 'POST',
        httpMethod: 'DELETE',
        description: 'Soft-delete a record by primary key. Requires partner auth headers.',
        graphql: `mutation {
  mdmDelete(master: "${m}", id: "RECORD_ID") {
    success
    master
    operation
    id
    error
  }
}`,
        variables: null,
        requiresAuth: true
      }
    )
  }

  const bulkOps = []
  if (isPublic && isCrud) {
    bulkOps.push(
      {
        id: 'bulk-create',
        name: 'Bulk Create',
        group: 'Bulk Operations',
        method: 'POST',
        httpMethod: 'POST',
        description: 'Create multiple records in a single call. Send a JSON array of record objects. Requires partner auth headers.',
        graphql: `mutation {
  mdmBulkCreate(
    master: "${m}"
    data: "[{\\"${pk}\\":\\"B1\\",\\"name\\":\\"Rec 1\\"},{\\"${pk}\\":\\"B2\\",\\"name\\":\\"Rec 2\\"}]"
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
}`,
        variables: null,
        requiresAuth: true
      },
      {
        id: 'bulk-update',
        name: 'Bulk Update',
        group: 'Bulk Operations',
        method: 'POST',
        httpMethod: 'PUT',
        description: 'Full replacement of multiple records. Each item must have "id" and "data" fields. Requires partner auth headers.',
        graphql: `mutation {
  mdmBulkUpdate(
    master: "${m}"
    data: "[{\\"id\\":\\"REC1\\",\\"data\\":{\\"name\\":\\"Updated 1\\"}},{\\"id\\":\\"REC2\\",\\"data\\":{\\"name\\":\\"Updated 2\\"}}]"
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
}`,
        variables: null,
        requiresAuth: true
      },
      {
        id: 'bulk-patch',
        name: 'Bulk Patch',
        group: 'Bulk Operations',
        method: 'POST',
        httpMethod: 'PATCH',
        description: 'Partial update of multiple records. Each item must have "id" and "data" fields. Only provided fields are merged. Requires partner auth headers.',
        graphql: `mutation {
  mdmBulkPatch(
    master: "${m}"
    data: "[{\\"id\\":\\"REC1\\",\\"data\\":{\\"name\\":\\"Patched 1\\"}}]"
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
}`,
        variables: null,
        requiresAuth: true
      },
      {
        id: 'bulk-delete',
        name: 'Bulk Delete',
        group: 'Bulk Operations',
        method: 'POST',
        httpMethod: 'DELETE',
        description: 'Delete multiple records by IDs. Send a JSON array of ID strings. Requires partner auth headers.',
        graphql: `mutation {
  mdmBulkDelete(
    master: "${m}"
    data: "[\\"REC1\\",\\"REC2\\"]"
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
}`,
        variables: null,
        requiresAuth: true
      }
    )
  }

  return [...queries, ...mutations, ...bulkOps]
}

/* ─── Code generators ─── */
function toCurl (op) {
  const headers = [
    '-H "Content-Type: application/json"'
  ]
  if (op.requiresAuth) {
    headers.push('-H "x-partner-id: YOUR_PARTNER_ID"')
    headers.push('-H "x-partner-key: YOUR_PARTNER_KEY"')
  }
  const body = JSON.stringify({ query: op.graphql })
  return `curl -X POST '${MESH_ENDPOINT}' \\
  ${headers.join(' \\\n  ')} \\
  -d '${body}'`
}

function toFetchJs (op) {
  const headersObj = { 'Content-Type': 'application/json' }
  if (op.requiresAuth) {
    headersObj['x-partner-id'] = 'YOUR_PARTNER_ID'
    headersObj['x-partner-key'] = 'YOUR_PARTNER_KEY'
  }
  // Double-escape backslashes so template literal preserves \"  for GraphQL
  const safeGraphql = op.graphql.replace(/\\/g, '\\\\')
  return `const response = await fetch('${MESH_ENDPOINT}', {
  method: 'POST',
  headers: ${JSON.stringify(headersObj, null, 4)},
  body: JSON.stringify({
    query: \`${safeGraphql}\`
  })
});

const data = await response.json();
console.log(data);`
}

function toPythonReq (op) {
  const headers = { 'Content-Type': 'application/json' }
  if (op.requiresAuth) {
    headers['x-partner-id'] = 'YOUR_PARTNER_ID'
    headers['x-partner-key'] = 'YOUR_PARTNER_KEY'
  }
  // Double-escape backslashes so Python triple-quotes preserve \" for GraphQL
  const safeGraphql = op.graphql.replace(/\\/g, '\\\\')
  return `import requests

url = "${MESH_ENDPOINT}"
headers = ${JSON.stringify(headers, null, 4)}

query = """${safeGraphql}"""

response = requests.post(url, json={"query": query}, headers=headers)
print(response.json())`
}

/* ─── MethodBadge ─── */
function MethodBadge ({ method }) {
  return (
    <span className='qc-method-badge' style={{ background: METHOD_COLORS[method] || '#666' }}>
      {method}
    </span>
  )
}

/* ─── CopyButton ─── */
function CopyBtn ({ text, notify }) {
  const [copied, setCopied] = useState(false)
  function handleCopy () {
    navigator.clipboard.writeText(text)
    setCopied(true)
    notify.info('Copied to clipboard')
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button className='qc-copy-btn' onClick={handleCopy} title='Copy to clipboard'>
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

/* ─── Tab component ─── */
function CodeTabs ({ tabs, notify }) {
  const [active, setActive] = useState(tabs[0]?.key || '')
  const current = tabs.find(t => t.key === active) || tabs[0]
  return (
    <div className='qc-code-tabs'>
      <div className='qc-code-tabs__bar'>
        <div className='qc-code-tabs__labels'>
          {tabs.map(t => (
            <button key={t.key} className={`qc-code-tabs__tab ${active === t.key ? 'qc-code-tabs__tab--active' : ''}`}
              onClick={() => setActive(t.key)}>
              {t.icon && <span className='qc-code-tabs__icon'>{t.icon}</span>}
              {t.label}
            </button>
          ))}
        </div>
        <CopyBtn text={current?.code || ''} notify={notify} />
      </div>
      <pre className='qc-code-tabs__content'>{current?.code || ''}</pre>
    </div>
  )
}

/* ─── Main component ─── */
function QueryConsole ({ runtime, ims }) {
  const notify = useNotifications()
  const [masters, setMasters] = useState([])
  const [mastersLoading, setMastersLoading] = useState(true)
  const [masterMeta, setMasterMeta] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Query params
  const [selectedMaster, setSelectedMaster] = useState('')
  const [filterStr, setFilterStr] = useState('')
  const [sortField, setSortField] = useState('')
  const [sortOrder, setSortOrder] = useState('asc')
  const [fields, setFields] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [recordId, setRecordId] = useState('')

  // Operation selection
  const [activeOp, setActiveOp] = useState('query-all')
  const [collapsedGroups, setCollapsedGroups] = useState({})

  // Result
  const [result, setResult] = useState(null)

  useEffect(() => {
    loadMasters()
    ;(async () => {
      try {
        const r = await invokeAction('app-settings', {}, ims, 'GET')
        const defaultPs = r?.settings?.api?.defaultPageSize
        if (defaultPs) setPageSize(defaultPs)
      } catch (_) { /* keep default */ }
    })()
  }, [])

  useEffect(() => {
    if (selectedMaster) {
      loadMasterDetail(selectedMaster)
    } else {
      setMasterMeta(null)
    }
  }, [selectedMaster])

  async function loadMasters () {
    try {
      setMastersLoading(true)
      const res = await fetchFileList(ims)
      setMasters(res.files || [])
    } catch (e) {
      console.error('Failed to load masters', e)
    } finally {
      setMastersLoading(false)
    }
  }

  async function loadMasterDetail (master) {
    try {
      const res = await fetchFileDetail(master, ims)
      setMasterMeta(res.file || null)
    } catch (e) {
      console.error('Failed to load master detail', e)
      // Build minimal meta from list data
      const found = masters.find(m => (m.masterName || m.entityName) === master)
      setMasterMeta(found || null)
    }
  }

  const operations = useMemo(() => {
    if (!selectedMaster) return []
    return buildOperations(selectedMaster, masterMeta)
  }, [selectedMaster, masterMeta])

  const currentOp = useMemo(() => operations.find(o => o.id === activeOp) || operations[0], [operations, activeOp])

  const operationGroups = useMemo(() => {
    const groups = {}
    operations.forEach(op => {
      if (!groups[op.group]) groups[op.group] = []
      groups[op.group].push(op)
    })
    return groups
  }, [operations])

  // When master changes, reset to first operation
  useEffect(() => {
    if (operations.length > 0 && !operations.find(o => o.id === activeOp)) {
      setActiveOp(operations[0].id)
    }
  }, [operations])

  async function handleQuery () {
    if (!selectedMaster) return
    try {
      setLoading(true)
      setError(null)
      const queryParams = {}
      if (recordId) queryParams.id = recordId
      if (filterStr) queryParams.filter = filterStr
      if (sortField) queryParams.sort = sortField
      if (sortOrder) queryParams.order = sortOrder
      if (fields) queryParams.fields = fields
      if (page) queryParams.page = page
      if (pageSize) queryParams.pageSize = pageSize

      const res = await queryData(selectedMaster, queryParams, ims)
      setResult(res)
      notify.success(`Query returned ${res.count || 0} records`)
    } catch (e) {
      setError(e.message)
      setResult(null)
      notify.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  function toggleGroup (group) {
    setCollapsedGroups(prev => ({ ...prev, [group]: !prev[group] }))
  }

  const groupIcons = {
    Queries: '🔍',
    Mutations: '✏️',
    'Bulk Operations': '📦'
  }

  return (
    <View UNSAFE_className='mdm-page'>
      <Flex justifyContent='space-between' alignItems='center' marginBottom='size-300'>
        <View>
          <Heading level={1} UNSAFE_className='mdm-page__title'>Query Console</Heading>
          <Text UNSAFE_className='mdm-page__subtitle'>Explore, test, and generate API Mesh integration code for any master</Text>
        </View>
      </Flex>

      {/* Master Selector */}
      <View UNSAFE_className='mdm-card' marginBottom='size-300'>
        <Flex gap='size-200' alignItems='end' wrap>
          <Picker label='Select Master' selectedKey={selectedMaster} onSelectionChange={k => { setSelectedMaster(k); setResult(null); setError(null) }}
            isRequired width='size-3600' placeholder='Choose a master...'>
            {masters.map(e => <Item key={e.masterName || e.entityName}>{e.displayName || e.masterName || e.entityName}</Item>)}
          </Picker>
          {masterMeta && (
            <Flex gap='size-150' alignItems='center' UNSAFE_style={{ paddingBottom: 4 }}>
              <span className='qc-meta-chip'>
                <span className='qc-meta-chip__label'>Primary Key</span>
                <span className='qc-meta-chip__value'>{masterMeta.primaryKey || '—'}</span>
              </span>
              <span className={`qc-meta-chip ${masterMeta.visibility === 'public' ? 'qc-meta-chip--green' : 'qc-meta-chip--orange'}`}>
                {masterMeta.visibility || 'private'}
              </span>
              {masterMeta.crudEnabled && (
                <span className='qc-meta-chip qc-meta-chip--blue'>CRUD Enabled</span>
              )}
              {masterMeta.recordCount !== undefined && (
                <span className='qc-meta-chip'>
                  <span className='qc-meta-chip__label'>Records</span>
                  <span className='qc-meta-chip__value'>{Number(masterMeta.recordCount).toLocaleString()}</span>
                </span>
              )}
            </Flex>
          )}
        </Flex>
      </View>

      {selectedMaster && (
        <div className='qc-workspace'>
          {/* Left: Operation Collection */}
          <div className='qc-sidebar'>
            <div className='qc-sidebar__header'>
              <span className='qc-sidebar__title'>API Operations</span>
              <span className='qc-sidebar__count'>{operations.length}</span>
            </div>
            <div className='qc-sidebar__list'>
              {Object.entries(operationGroups).map(([group, ops]) => (
                <div key={group} className='qc-sidebar__group'>
                  <button className='qc-sidebar__group-header' onClick={() => toggleGroup(group)}>
                    <span className='qc-sidebar__group-icon'>{groupIcons[group] || '📁'}</span>
                    <span className='qc-sidebar__group-name'>{group}</span>
                    <span className='qc-sidebar__group-count'>{ops.length}</span>
                    <span className={`qc-sidebar__chevron ${collapsedGroups[group] ? '' : 'qc-sidebar__chevron--open'}`}>›</span>
                  </button>
                  {!collapsedGroups[group] && ops.map(op => (
                    <button key={op.id} className={`qc-sidebar__item ${activeOp === op.id ? 'qc-sidebar__item--active' : ''}`}
                      onClick={() => setActiveOp(op.id)}>
                      <MethodBadge method={op.httpMethod} />
                      <span className='qc-sidebar__item-name'>{op.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Right: Operation Detail */}
          <div className='qc-detail'>
            {currentOp && (
              <>
                {/* Operation Header */}
                <div className='qc-detail__header'>
                  <div className='qc-detail__header-top'>
                    <MethodBadge method={currentOp.httpMethod} />
                    <h3 className='qc-detail__title'>{currentOp.name}</h3>
                  </div>
                  <p className='qc-detail__desc'>{currentOp.description}</p>
                  {currentOp.notes && (
                    <div className='qc-info-notice'>
                      <span className='qc-info-notice__icon'>💡</span>
                      <span>{currentOp.notes}</span>
                    </div>
                  )}
                  {currentOp.requiresAuth && (
                    <div className='qc-auth-notice'>
                      <span className='qc-auth-notice__icon'>🔐</span>
                      <span>Requires <code>x-partner-id</code> and <code>x-partner-key</code> headers for authentication</span>
                    </div>
                  )}
                </div>

                {/* Endpoint */}
                <div className='qc-endpoint-bar'>
                  <span className='qc-endpoint-bar__method'>POST</span>
                  <span className='qc-endpoint-bar__url'>{MESH_ENDPOINT}</span>
                  <CopyBtn text={MESH_ENDPOINT} notify={notify} />
                </div>

                {/* Code Tabs */}
                <CodeTabs notify={notify} tabs={[
                  { key: 'graphql', label: 'GraphQL', icon: '◆', code: currentOp.graphql },
                  { key: 'curl', label: 'cURL', icon: '⌘', code: toCurl(currentOp) },
                  { key: 'javascript', label: 'JavaScript', icon: 'JS', code: toFetchJs(currentOp) },
                  { key: 'python', label: 'Python', icon: '🐍', code: toPythonReq(currentOp) }
                ]} />

                {/* Live Query Builder — only for query-all and query-filter */}
                {(currentOp.id === 'query-all' || currentOp.id === 'query-filter') && (
                  <div className='qc-live-builder'>
                    <div className='qc-live-builder__header'>
                      <h4 className='qc-live-builder__title'>Live Query Builder</h4>
                      <span className='qc-live-builder__hint'>Configure parameters and execute against the live backend</span>
                    </div>
                    <div className='qc-live-builder__form'>
                      <TextField label='Record ID' value={recordId} onChange={setRecordId}
                        placeholder='Leave empty for collection query' width='100%'
                        description='Fetch a specific record by its primary key value' />

                      <TextField label='Filters' value={filterStr} onChange={setFilterStr}
                        placeholder='sku=ABC123&brand=Nike' width='100%'
                        description='Format: field=value. Multiple filters joined with &' />

                      <Flex gap='size-200' width='100%'>
                        <TextField label='Sort Field' value={sortField} onChange={setSortField} flex={1}
                          placeholder='e.g. name, price, createdAt' />
                        <Picker label='Order' selectedKey={sortOrder} onSelectionChange={setSortOrder} width='size-1600'>
                          <Item key='asc'>Ascending</Item>
                          <Item key='desc'>Descending</Item>
                        </Picker>
                      </Flex>

                      <TextField label='Fields (comma-separated)' value={fields} onChange={setFields}
                        placeholder='name,sku,price' width='100%'
                        description='Leave empty to return all fields' />

                      <Flex gap='size-200' width='100%'>
                        <TextField label='Page' value={String(page)} onChange={v => setPage(Number(v) || 1)} width='size-1200' />
                        <TextField label='Page Size' value={String(pageSize)} onChange={v => setPageSize(Number(v) || 25)} width='size-1200' />
                      </Flex>
                    </div>

                    <Flex marginTop='size-200' gap='size-100'>
                      <Button variant='cta' onPress={handleQuery} isDisabled={!selectedMaster || loading}>
                        <Code size='S' /><Text>{loading ? 'Executing...' : 'Execute Query'}</Text>
                      </Button>
                      {result && (
                        <Button variant='secondary' isQuiet onPress={() => { setResult(null); setError(null) }}>
                          <Text>Clear</Text>
                        </Button>
                      )}
                    </Flex>
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className='qc-error-bar'>
                    <span className='qc-error-bar__icon'>⚠</span>
                    <span>{error}</span>
                  </div>
                )}

                {/* Response */}
                {result && (
                  <div className='qc-response'>
                    <div className='qc-response__header'>
                      <div className='qc-response__header-left'>
                        <span className='qc-response__status qc-response__status--ok'>200 OK</span>
                        <span className='qc-response__meta'>
                          {result.count !== undefined && `${result.count} records`}
                          {result.total !== undefined && ` of ${result.total} total`}
                          {result.page !== undefined && ` · Page ${result.page}`}
                        </span>
                      </div>
                      <div className='qc-response__header-right'>
                        <span className='qc-response__size'>{(JSON.stringify(result).length / 1024).toFixed(1)} KB</span>
                        <CopyBtn text={JSON.stringify(result, null, 2)} notify={notify} />
                      </div>
                    </div>
                    <pre className='qc-response__body'>{JSON.stringify(result, null, 2)}</pre>
                  </div>
                )}
              </>
            )}

            {!currentOp && (
              <div className='qc-empty'>
                <span className='qc-empty__icon'>📋</span>
                <p>Select an operation from the sidebar to view its details and code snippets</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state when no master selected */}
      {!selectedMaster && (
        <View UNSAFE_className='mdm-card'>
          <div className='qc-empty'>
            <span className='qc-empty__icon'>🚀</span>
            <h3>Select a Master to Get Started</h3>
            <p className='qc-empty__text'>Choose a master from the picker above to explore all available API Mesh operations with ready-to-use code snippets in GraphQL, cURL, JavaScript, and Python.</p>
            <div className='qc-feature-grid'>
              <div className='qc-feature-card'>
                <span className='qc-feature-card__icon'>🔍</span>
                <span className='qc-feature-card__label'>Query & Filter</span>
                <span className='qc-feature-card__desc'>Paginated queries with filters, sorting, and field selection</span>
              </div>
              <div className='qc-feature-card'>
                <span className='qc-feature-card__icon'>✏️</span>
                <span className='qc-feature-card__label'>CRUD Mutations</span>
                <span className='qc-feature-card__desc'>Create, update, patch, and delete records via GraphQL</span>
              </div>
              <div className='qc-feature-card'>
                <span className='qc-feature-card__icon'>📦</span>
                <span className='qc-feature-card__label'>Bulk Operations</span>
                <span className='qc-feature-card__desc'>Process multiple records in a single API call</span>
              </div>
              <div className='qc-feature-card'>
                <span className='qc-feature-card__icon'>📋</span>
                <span className='qc-feature-card__label'>Copy & Integrate</span>
                <span className='qc-feature-card__desc'>One-click copy for GraphQL, cURL, JS, and Python</span>
              </div>
            </div>
          </div>
        </View>
      )}
    </View>
  )
}

export default QueryConsole
