import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Heading, View, Flex, Button, TextField, Text,
  Picker, Item, TextArea
} from '@adobe/react-spectrum'
import { fetchFileList, fetchFileDetail, invokeAction } from './actionInvoker'
import { useNotifications } from './NotificationProvider'
import Code from '@spectrum-icons/workflow/Code'
import Play from '@spectrum-icons/workflow/Play'

/* ─── Constants ─── */
const DEFAULT_MESH_ENDPOINT = 'https://graph.adobe.io/api/YOUR_MESH_ID/graphql'
const METHOD_COLORS = {
  GET: '#12805C',
  POST: '#1473E6',
  PUT: '#E68619',
  PATCH: '#7C3AED',
  DELETE: '#D7373F'
}

/* ─── Operation templates (dynamically populated per master) ─── */
function buildOperations (master, meta) {
  const m = master || 'your-master'
  const pk = meta?.primaryKey || 'id'
  const isPublic = meta?.visibility === 'public'
  const isCrud = meta?.crudEnabled === true

  const schemaFields = (meta?.schema || []).filter(f => f.name !== pk)
  const editableFields = schemaFields.filter(f => f.editable !== false)
  const queryableFields = schemaFields.filter(f => f.queryable)

  function buildSampleJson (fieldList, prefix) {
    if (!fieldList || fieldList.length === 0) return '{\\"field1\\":\\"value1\\"}'
    return '{' + fieldList.map(f => {
      const val = prefix ? `${prefix} ${f.name}` : `sample_${f.name}`
      if (f.type === 'number' || f.type === 'integer') return `\\"${f.name}\\":0`
      if (f.type === 'boolean') return `\\"${f.name}\\":true`
      return `\\"${f.name}\\":\\"${val}\\"`
    }).join(',') + '}'
  }

  const filterSample = queryableFields.length > 0
    ? queryableFields.slice(0, 2).map(f => `${f.name}=value`).join(',')
    : 'status=active'

  const queries = [
    {
      id: 'query-all', name: 'Query All Records', group: 'Queries', method: 'GET',
      graphql: `query {\n  mdmQuery(master: "${m}", page: 1, pageSize: 25) {\n    master\n    count\n    page\n    pageSize\n    total\n    data\n  }\n}`
    },
    {
      id: 'query-filter', name: 'Query with Filters', group: 'Queries', method: 'GET',
      graphql: `query {\n  mdmQuery(\n    master: "${m}"\n    filters: "${filterSample}"\n    sort: "${pk}"\n    order: "asc"\n    page: 1\n    pageSize: 25\n  ) {\n    master\n    count\n    page\n    pageSize\n    total\n    data\n    aggregations {\n      field\n      label\n      values { value count }\n    }\n  }\n}`
    },
    {
      id: 'query-facets', name: 'Query with Facets', group: 'Queries', method: 'GET',
      graphql: `query {\n  mdmQuery(\n    master: "${m}"\n    facets: "true"\n    page: 1\n    pageSize: 25\n  ) {\n    master\n    count\n    page\n    pageSize\n    total\n    data\n    aggregations {\n      field\n      label\n      type\n      showCount\n      collapsed\n      values { value count selected }\n    }\n  }\n}`
    },
    {
      id: 'record-single', name: 'Get Single Record', group: 'Queries', method: 'GET',
      graphql: `query {\n  mdmRecord(master: "${m}", id: "1") {\n    master\n    data\n  }\n}`
    },
    {
      id: 'bulk-fetch', name: 'Bulk Fetch by IDs', group: 'Queries', method: 'GET',
      graphql: `query {\n  mdmBulkFetch(master: "${m}", ids: "1,2,3") {\n    master\n    count\n    requested\n    data\n    notFound\n  }\n}`
    },
    {
      id: 'facets-config', name: 'Get Facets Configuration', group: 'Queries', method: 'GET',
      graphql: `query {\n  mdmFacets(master: "${m}", values: "true") {\n    master\n    facetsEnabled\n    totalFields\n    facetableFields\n    totalRecords\n    facets {\n      field\n      label\n      type\n      sortBy\n      sortOrder\n      limit\n      showCount\n      collapsed\n      fieldType\n      values { value count }\n      totalValues\n    }\n  }\n}`
    }
  ]

  const mutations = []
  if (isPublic && isCrud) {
    const createSample = buildSampleJson(editableFields.slice(0, 5), '')
    const updateSample = buildSampleJson(editableFields.slice(0, 5), 'Updated')
    const patchSample = editableFields.length > 0 ? buildSampleJson(editableFields.slice(0, 2), 'Patched') : '{\\"name\\":\\"Patched Name\\"}'

    mutations.push(
      {
        id: 'create-record', name: 'Create Record', group: 'Mutations', method: 'POST', requiresAuth: true,
        graphql: `mutation {\n  mdmCreate(\n    master: "${m}"\n    input: { data: "${createSample}" }\n  ) {\n    success\n    master\n    operation\n    record\n    error\n  }\n}`
      },
      {
        id: 'update-record', name: 'Update Record (Full)', group: 'Mutations', method: 'POST', requiresAuth: true,
        graphql: `mutation {\n  mdmUpdate(\n    master: "${m}"\n    id: "RECORD_ID"\n    input: { data: "${updateSample}" }\n  ) {\n    success\n    master\n    operation\n    record\n    error\n  }\n}`
      },
      {
        id: 'patch-record', name: 'Patch Record (Partial)', group: 'Mutations', method: 'POST', requiresAuth: true,
        graphql: `mutation {\n  mdmPatch(\n    master: "${m}"\n    id: "RECORD_ID"\n    input: { data: "${patchSample}" }\n  ) {\n    success\n    master\n    operation\n    record\n    error\n  }\n}`
      },
      {
        id: 'delete-record', name: 'Delete Record', group: 'Mutations', method: 'POST', requiresAuth: true,
        graphql: `mutation {\n  mdmDelete(master: "${m}", id: "RECORD_ID") {\n    success\n    master\n    operation\n    id\n    error\n  }\n}`
      }
    )
  }

  const bulkOps = []
  if (isPublic && isCrud) {
    const bulkSample1 = buildSampleJson(editableFields.slice(0, 3), 'Rec1')
    const bulkSample2 = buildSampleJson(editableFields.slice(0, 3), 'Rec2')
    const bulkField = editableFields.length > 0 ? editableFields[0].name : 'name'

    bulkOps.push(
      {
        id: 'bulk-create', name: 'Bulk Create', group: 'Bulk Operations', method: 'POST', requiresAuth: true,
        graphql: `mutation {\n  mdmBulkCreate(\n    master: "${m}"\n    input: { data: "[${bulkSample1},${bulkSample2}]" }\n  ) {\n    master\n    operation\n    total\n    succeeded\n    failed\n    results {\n      success\n      id\n      error\n    }\n  }\n}`
      },
      {
        id: 'bulk-update', name: 'Bulk Update', group: 'Bulk Operations', method: 'POST', requiresAuth: true,
        graphql: `mutation {\n  mdmBulkUpdate(\n    master: "${m}"\n    input: { data: "[{\\"id\\":\\"1\\",\\"data\\":{\\"${bulkField}\\":\\"Updated 1\\"}},{\\"id\\":\\"2\\",\\"data\\":{\\"${bulkField}\\":\\"Updated 2\\"}}]" }\n  ) {\n    master\n    operation\n    total\n    succeeded\n    failed\n    results {\n      success\n      id\n      error\n    }\n  }\n}`
      },
      {
        id: 'bulk-patch', name: 'Bulk Patch', group: 'Bulk Operations', method: 'POST', requiresAuth: true,
        graphql: `mutation {\n  mdmBulkPatch(\n    master: "${m}"\n    input: { data: "[{\\"id\\":\\"1\\",\\"data\\":{\\"${bulkField}\\":\\"Patched 1\\"}}]" }\n  ) {\n    master\n    operation\n    total\n    succeeded\n    failed\n    results {\n      success\n      id\n      error\n    }\n  }\n}`
      },
      {
        id: 'bulk-delete', name: 'Bulk Delete', group: 'Bulk Operations', method: 'POST', requiresAuth: true,
        graphql: `mutation {\n  mdmBulkDelete(\n    master: "${m}"\n    input: { data: "[\\"1\\",\\"2\\"]" }\n  ) {\n    master\n    operation\n    total\n    succeeded\n    failed\n    results {\n      success\n      id\n      error\n    }\n  }\n}`
      }
    )
  }

  return [...queries, ...mutations, ...bulkOps]
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
function CopyBtn ({ text, label, notify }) {
  const [copied, setCopied] = useState(false)
  function handleCopy () {
    navigator.clipboard.writeText(text)
    setCopied(true)
    if (notify) notify.info('Copied to clipboard')
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button className='qc-copy-btn' onClick={handleCopy} title='Copy to clipboard'>
      {copied ? '✓ Copied' : (label || 'Copy')}
    </button>
  )
}

/* ─── Header row (key/value editable pair) ─── */
function HeaderRow ({ header, onChange, onRemove }) {
  return (
    <div className='qc-header-row'>
      <input className='qc-header-row__key' value={header.key} placeholder='Header name'
        onChange={e => onChange({ ...header, key: e.target.value })} />
      <input className='qc-header-row__value' value={header.value} placeholder='Value'
        onChange={e => onChange({ ...header, value: e.target.value })} />
      <button className='qc-header-row__remove' onClick={onRemove} title='Remove header'>×</button>
    </div>
  )
}

/* ─── Main component ─── */
function QueryConsole ({ runtime, ims }) {
  const notify = useNotifications()
  const [masters, setMasters] = useState([])
  const [mastersLoading, setMastersLoading] = useState(true)
  const [masterMeta, setMasterMeta] = useState(null)

  // Master selection
  const [selectedMaster, setSelectedMaster] = useState('')

  // Operation sidebar
  const [activeOp, setActiveOp] = useState('query-all')
  const [collapsedGroups, setCollapsedGroups] = useState({})

  // Request editor state
  const [endpoint, setEndpoint] = useState(() => localStorage.getItem('qc_endpoint') || DEFAULT_MESH_ENDPOINT)
  const [headers, setHeaders] = useState(() => {
    try {
      const saved = localStorage.getItem('qc_headers')
      if (saved) return JSON.parse(saved)
    } catch (_) {}
    return [
      { key: 'Content-Type', value: 'application/json' },
      { key: 'x-partner-id', value: '' },
      { key: 'x-partner-key', value: '' }
    ]
  })
  const [graphqlBody, setGraphqlBody] = useState('')
  const [variablesBody, setVariablesBody] = useState('')

  // Tabs
  const [requestTab, setRequestTab] = useState('query') // query | headers | variables

  // Execution state
  const [sending, setSending] = useState(false)
  const [response, setResponse] = useState(null) // { status, statusText, time, size, headers, body }
  const [responseTab, setResponseTab] = useState('body') // body | headers

  // Persist endpoint + headers
  useEffect(() => { localStorage.setItem('qc_endpoint', endpoint) }, [endpoint])
  useEffect(() => { localStorage.setItem('qc_headers', JSON.stringify(headers)) }, [headers])

  // Load masters
  useEffect(() => {
    ;(async () => {
      try {
        setMastersLoading(true)
        const res = await fetchFileList(ims)
        setMasters(res.files || [])
      } catch (e) {
        console.error('Failed to load masters', e)
      } finally {
        setMastersLoading(false)
      }
    })()
  }, [])

  // Load master detail on selection change
  useEffect(() => {
    if (selectedMaster) {
      ;(async () => {
        try {
          const res = await fetchFileDetail(selectedMaster, ims)
          setMasterMeta(res.file || null)
        } catch (e) {
          console.error('Failed to load master detail', e)
          const found = masters.find(m => (m.masterName || m.entityName) === selectedMaster)
          setMasterMeta(found || null)
        }
      })()
    } else {
      setMasterMeta(null)
    }
  }, [selectedMaster])

  // Build operations list
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

  // When operations change, select the first and populate the editor
  useEffect(() => {
    if (operations.length > 0 && !operations.find(o => o.id === activeOp)) {
      const first = operations[0]
      setActiveOp(first.id)
      setGraphqlBody(first.graphql)
      setVariablesBody('')
    }
  }, [operations])

  // When user clicks a different operation, populate the editor
  function selectOperation (opId) {
    setActiveOp(opId)
    const op = operations.find(o => o.id === opId)
    if (op) {
      setGraphqlBody(op.graphql)
      setVariablesBody('')
      setResponse(null)
    }
  }

  // --- Send GraphQL request ---
  const handleSend = useCallback(async () => {
    if (!endpoint || !graphqlBody.trim()) {
      notify.error('Endpoint and query are required')
      return
    }
    setSending(true)
    setResponse(null)

    const reqHeaders = {}
    headers.forEach(h => {
      if (h.key && h.value) reqHeaders[h.key] = h.value
    })

    let bodyObj
    try {
      bodyObj = { query: graphqlBody }
      if (variablesBody.trim()) {
        bodyObj.variables = JSON.parse(variablesBody)
      }
    } catch (e) {
      notify.error('Invalid JSON in variables: ' + e.message)
      setSending(false)
      return
    }

    const start = performance.now()
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(bodyObj)
      })
      const elapsed = Math.round(performance.now() - start)
      const text = await res.text()
      let parsed
      try { parsed = JSON.parse(text) } catch (_) { parsed = null }

      const respHeaders = {}
      res.headers.forEach((v, k) => { respHeaders[k] = v })

      setResponse({
        status: res.status,
        statusText: res.statusText,
        time: elapsed,
        size: text.length,
        headers: respHeaders,
        body: parsed ? JSON.stringify(parsed, null, 2) : text,
        isError: res.status >= 400
      })

      if (res.ok) {
        notify.success(`${res.status} ${res.statusText} — ${elapsed}ms`)
      } else {
        notify.error(`${res.status} ${res.statusText}`)
      }
    } catch (e) {
      const elapsed = Math.round(performance.now() - start)
      setResponse({
        status: 0,
        statusText: 'Network Error',
        time: elapsed,
        size: 0,
        headers: {},
        body: e.message || 'Failed to connect to endpoint',
        isError: true
      })
      notify.error('Request failed: ' + e.message)
    } finally {
      setSending(false)
    }
  }, [endpoint, graphqlBody, variablesBody, headers, notify])

  // Header management
  function updateHeader (index, header) {
    setHeaders(prev => prev.map((h, i) => i === index ? header : h))
  }
  function removeHeader (index) {
    setHeaders(prev => prev.filter((_, i) => i !== index))
  }
  function addHeader () {
    setHeaders(prev => [...prev, { key: '', value: '' }])
  }

  function toggleGroup (group) {
    setCollapsedGroups(prev => ({ ...prev, [group]: !prev[group] }))
  }

  const groupIcons = { Queries: '🔍', Mutations: '✏️', 'Bulk Operations': '📦' }

  // Keyboard shortcut: Ctrl/Cmd + Enter to send
  useEffect(() => {
    function handleKeyDown (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        handleSend()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSend])

  const activeHeaderCount = headers.filter(h => h.key && h.value).length

  return (
    <View UNSAFE_className='mdm-page'>
      <Flex justifyContent='space-between' alignItems='center' marginBottom='size-300'>
        <View>
          <Heading level={1} UNSAFE_className='mdm-page__title'>API Client</Heading>
          <Text UNSAFE_className='mdm-page__subtitle'>Send GraphQL queries and mutations to your API Mesh endpoint</Text>
        </View>
      </Flex>

      {/* Master Selector + Schema */}
      <View UNSAFE_className='mdm-card' marginBottom='size-300'>
        <Flex gap='size-200' alignItems='end' wrap>
          <Picker label='Select Master' selectedKey={selectedMaster}
            onSelectionChange={k => { setSelectedMaster(k); setResponse(null) }}
            isRequired width='size-3600' placeholder='Choose a master...'
            isLoading={mastersLoading}>
            {masters.map(e => <Item key={e.masterName || e.entityName}>{e.displayName || e.masterName || e.entityName}</Item>)}
          </Picker>
          {masterMeta && (
            <Flex gap='size-150' alignItems='center' UNSAFE_style={{ paddingBottom: 4 }} wrap>
              <span className='qc-meta-chip'>
                <span className='qc-meta-chip__label'>Primary Key</span>
                <span className='qc-meta-chip__value'>{masterMeta.primaryKey || '—'}</span>
              </span>
              <span className={`qc-meta-chip ${masterMeta.visibility === 'public' ? 'qc-meta-chip--green' : 'qc-meta-chip--orange'}`}>
                {masterMeta.visibility || 'private'}
              </span>
              {masterMeta.crudEnabled && <span className='qc-meta-chip qc-meta-chip--blue'>CRUD Enabled</span>}
              {masterMeta.recordCount !== undefined && (
                <span className='qc-meta-chip'>
                  <span className='qc-meta-chip__label'>Records</span>
                  <span className='qc-meta-chip__value'>{Number(masterMeta.recordCount).toLocaleString()}</span>
                </span>
              )}
              {masterMeta.schema && (
                <span className='qc-meta-chip'>
                  <span className='qc-meta-chip__label'>Fields</span>
                  <span className='qc-meta-chip__value'>{masterMeta.schema.length}</span>
                </span>
              )}
            </Flex>
          )}
        </Flex>
        {masterMeta?.schema && masterMeta.schema.length > 0 && (
          <View marginTop='size-150'>
            <Text UNSAFE_style={{ fontSize: '12px', color: 'var(--spectrum-global-color-gray-600)' }}>
              <strong>Schema:</strong>{' '}
              {masterMeta.schema.map((f, i) => (
                <span key={f.name}>
                  <code style={{ fontSize: '11px', background: 'var(--spectrum-global-color-gray-100)', padding: '1px 4px', borderRadius: '3px' }}>
                    {f.name}
                  </code>
                  {f.name === masterMeta.primaryKey && <span style={{ fontSize: '9px', color: '#B7791F', fontWeight: 700, marginLeft: 2 }}>PK</span>}
                  {f.required && <span style={{ fontSize: '9px', color: '#C53030', marginLeft: 2 }}>*</span>}
                  {f.queryable && <span style={{ fontSize: '9px', color: '#2B6CB0', fontWeight: 700, marginLeft: 2 }}>Q</span>}
                  {i < masterMeta.schema.length - 1 ? ' ' : ''}
                </span>
              ))}
            </Text>
          </View>
        )}
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
                      onClick={() => selectOperation(op.id)}>
                      <MethodBadge method={op.method} />
                      <span className='qc-sidebar__item-name'>{op.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Right: Request + Response */}
          <div className='qc-detail'>
            {/* Endpoint Bar (editable) */}
            <div className='qc-endpoint-bar'>
              <span className='qc-endpoint-bar__method'>POST</span>
              <input className='qc-endpoint-bar__input' value={endpoint}
                onChange={e => setEndpoint(e.target.value)}
                placeholder='https://graph.adobe.io/api/YOUR_MESH_ID/graphql'
                spellCheck={false} />
              <button className={`qc-send-btn ${sending ? 'qc-send-btn--sending' : ''}`}
                onClick={handleSend} disabled={sending}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>

            {/* Request section: tabs for Query / Headers / Variables */}
            <div className='qc-request-panel'>
              <div className='qc-request-panel__tabs'>
                <button className={`qc-request-panel__tab ${requestTab === 'query' ? 'qc-request-panel__tab--active' : ''}`}
                  onClick={() => setRequestTab('query')}>
                  Query
                </button>
                <button className={`qc-request-panel__tab ${requestTab === 'headers' ? 'qc-request-panel__tab--active' : ''}`}
                  onClick={() => setRequestTab('headers')}>
                  Headers {activeHeaderCount > 0 && <span className='qc-request-panel__badge'>{activeHeaderCount}</span>}
                </button>
                <button className={`qc-request-panel__tab ${requestTab === 'variables' ? 'qc-request-panel__tab--active' : ''}`}
                  onClick={() => setRequestTab('variables')}>
                  Variables
                </button>
                <div className='qc-request-panel__spacer' />
                <span className='qc-request-panel__hint'>⌘ Enter to send</span>
              </div>

              <div className='qc-request-panel__body'>
                {requestTab === 'query' && (
                  <textarea className='qc-editor' value={graphqlBody}
                    onChange={e => setGraphqlBody(e.target.value)}
                    placeholder='Enter your GraphQL query or mutation here…'
                    spellCheck={false} />
                )}
                {requestTab === 'headers' && (
                  <div className='qc-headers-editor'>
                    {headers.map((h, i) => (
                      <HeaderRow key={i} header={h} onChange={hdr => updateHeader(i, hdr)}
                        onRemove={() => removeHeader(i)} />
                    ))}
                    <button className='qc-headers-editor__add' onClick={addHeader}>
                      + Add Header
                    </button>
                  </div>
                )}
                {requestTab === 'variables' && (
                  <textarea className='qc-editor qc-editor--short' value={variablesBody}
                    onChange={e => setVariablesBody(e.target.value)}
                    placeholder='{\n  "variableName": "value"\n}'
                    spellCheck={false} />
                )}
              </div>
            </div>

            {/* Response section */}
            {response && (
              <div className='qc-response'>
                <div className='qc-response__header'>
                  <div className='qc-response__header-left'>
                    <span className={`qc-response__status ${response.isError ? 'qc-response__status--error' : 'qc-response__status--ok'}`}>
                      {response.status === 0 ? 'ERR' : response.status} {response.statusText}
                    </span>
                    <span className='qc-response__meta'>{response.time}ms</span>
                    <span className='qc-response__meta'>
                      {response.size > 1024 ? `${(response.size / 1024).toFixed(1)} KB` : `${response.size} B`}
                    </span>
                  </div>
                  <div className='qc-response__header-right'>
                    <button className={`qc-response__tab ${responseTab === 'body' ? 'qc-response__tab--active' : ''}`}
                      onClick={() => setResponseTab('body')}>Body</button>
                    <button className={`qc-response__tab ${responseTab === 'headers' ? 'qc-response__tab--active' : ''}`}
                      onClick={() => setResponseTab('headers')}>Headers</button>
                    <CopyBtn text={response.body} notify={notify} />
                  </div>
                </div>
                <pre className='qc-response__body'>
                  {responseTab === 'body'
                    ? response.body
                    : JSON.stringify(response.headers, null, 2)}
                </pre>
              </div>
            )}

            {!response && !sending && (
              <div className='qc-response-placeholder'>
                <span className='qc-response-placeholder__icon'>⚡</span>
                <p>Click <strong>Send</strong> or press <strong>⌘ Enter</strong> to execute the request</p>
              </div>
            )}

            {sending && (
              <div className='qc-response-placeholder'>
                <span className='qc-response-placeholder__icon qc-response-placeholder__icon--spin'>⏳</span>
                <p>Sending request…</p>
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
            <p className='qc-empty__text'>Choose a master from the picker above to explore all available API operations. Select a template from the sidebar, edit the query, configure headers, and send live requests to your API Mesh endpoint.</p>
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
                <span className='qc-feature-card__icon'>📡</span>
                <span className='qc-feature-card__label'>Send Requests</span>
                <span className='qc-feature-card__desc'>Execute live GraphQL requests with custom headers and endpoint</span>
              </div>
            </div>
          </div>
        </View>
      )}
    </View>
  )
}

export default QueryConsole
