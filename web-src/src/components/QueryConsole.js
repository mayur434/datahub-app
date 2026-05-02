import React, { useState, useEffect } from 'react'
import {
  Heading, View, Flex, Button, TextField, Text, ProgressCircle,
  Picker, Item, Divider
} from '@adobe/react-spectrum'
import { useNavigate } from 'react-router-dom'
import { fetchFileList, queryData, invokeAction } from './actionInvoker'
import { useNotifications } from './NotificationProvider'
import Code from '@spectrum-icons/workflow/Code'

function QueryConsole ({ runtime, ims }) {
  const navigate = useNavigate()
  const notify = useNotifications()
  const [masters, setMasters] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Query params
  const [selectedMaster, setSelectedMaster] = useState('')
  const [filterStr, setFilterStr] = useState('')
  const [sortField, setSortField] = useState('')
  const [sortOrder, setSortOrder] = useState('asc')
  const [fields, setFields] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [recordId, setRecordId] = useState('')

  // Result
  const [result, setResult] = useState(null)

  useEffect(() => {
    loadMasters()
    // Load default page size from settings
    ;(async () => {
      try {
        const r = await invokeAction('app-settings', {}, ims, 'GET')
        const defaultPs = r?.settings?.api?.defaultPageSize
        if (defaultPs) setPageSize(defaultPs)
      } catch (_) { /* keep default */ }
    })()
  }, [])

  async function loadMasters () {
    try {
      const res = await fetchFileList(ims)
      setMasters(res.files || [])
    } catch (e) {
      console.error('Failed to load masters', e)
    }
  }

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

  function copyToClipboard (text) {
    navigator.clipboard.writeText(text)
    notify.info('Copied to clipboard')
  }

  return (
    <View UNSAFE_className='mdm-page'>
      <Flex justifyContent='space-between' alignItems='center' marginBottom='size-300'>
        <View>
          <Heading level={1} UNSAFE_className='mdm-page__title'>Query Console</Heading>
          <Text UNSAFE_className='mdm-page__subtitle'>Test and preview data queries before integrating with API Mesh</Text>
        </View>
      </Flex>

      {/* Query Builder */}
      <View UNSAFE_className='mdm-card' marginBottom='size-300'>
        <Heading level={3} marginBottom='size-200'>Query Builder</Heading>
        <div className='mdm-form-grid'>
          <Picker label='Master' selectedKey={selectedMaster} onSelectionChange={setSelectedMaster} isRequired width='100%'
            placeholder='Select a master...'>
            {masters.map(e => <Item key={e.masterName || e.entityName}>{e.displayName || e.masterName || e.entityName}</Item>)}
          </Picker>

          <TextField label='Record ID (single)' value={recordId} onChange={setRecordId}
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
            <TextField label='Page Size' value={String(pageSize)} onChange={v => setPageSize(Number(v) || 20)} width='size-1200' />
          </Flex>
        </div>

        <Flex marginTop='size-300' gap='size-100'>
          <Button variant='cta' onPress={handleQuery} isDisabled={!selectedMaster || loading}>
            <Code size='S' /><Text>{loading ? 'Running...' : 'Execute Query'}</Text>
          </Button>
          {result && (
            <Button variant='secondary' isQuiet onPress={() => { setResult(null); setError(null) }}>
              <Text>Clear Results</Text>
            </Button>
          )}
        </Flex>
      </View>

      {error && (
        <Well marginBottom='size-300' UNSAFE_className='mdm-alert mdm-alert--error'>
          <Text><strong>Query Error:</strong> {error}</Text>
        </Well>
      )}

      {/* Result */}
      {result && (
        <View UNSAFE_className='mdm-card' marginBottom='size-300'>
          <Flex justifyContent='space-between' alignItems='center' marginBottom='size-200'>
            <Heading level={3}>Results</Heading>
            <Flex gap='size-100' alignItems='center'>
              <Text UNSAFE_className='mdm-text-muted'>
                {result.count !== undefined && `${result.count} records`}
                {result.total !== undefined && ` of ${result.total} total`}
                {result.page !== undefined && ` \u2022 Page ${result.page}`}
              </Text>
              <Button variant='secondary' isQuiet onPress={() => copyToClipboard(JSON.stringify(result, null, 2))}>
                Copy JSON
              </Button>
            </Flex>
          </Flex>

          <div className='mdm-code-block'>
            <div className='mdm-code-block__header'>
              <span>Response</span>
              <span>{JSON.stringify(result).length} bytes</span>
            </div>
            <pre className='mdm-code-block__content'>{JSON.stringify(result, null, 2)}</pre>
          </div>
        </View>
      )}

      <Divider size='S' marginY='size-300' />

      {/* API Documentation */}
      <View UNSAFE_className='mdm-card'>
        <Heading level={3} marginBottom='size-200'>API Mesh Endpoint Reference</Heading>
        <Text UNSAFE_className='mdm-text-muted' marginBottom='size-200'>
          Master data is publicly available via API Mesh (no auth required for public masters).
        </Text>

        <div className='mdm-code-block' style={{ marginBottom: 16 }}>
          <pre>POST https://graph.adobe.io/api/YOUR_MESH_ID/graphql</pre>
        </div>

        <Heading level={4} marginTop='size-300' marginBottom='size-100'>Query All Records</Heading>
        <div className='mdm-code-block'>
          <pre>{`query {
  mdmQuery(master: "products", page: 1, pageSize: 20) {
    master
    count
    total
    data
  }
}`}</pre>
        </div>

        <Heading level={4} marginTop='size-300' marginBottom='size-100'>Query with Filters</Heading>
        <div className='mdm-code-block'>
          <pre>{`query {
  mdmQuery(
    master: "products"
    filter: "category=electronics&brand=sony"
    sort: "price"
    order: "desc"
    fields: "name,price,sku"
    page: 1
    pageSize: 50
  ) {
    master count total data
  }
}`}</pre>
        </div>

        <Heading level={4} marginTop='size-300' marginBottom='size-100'>Get Single Record</Heading>
        <div className='mdm-code-block'>
          <pre>{`query {
  mdmRecord(master: "products", id: "SKU-001") {
    master
    record
  }
}`}</pre>
        </div>
      </View>
    </View>
  )
}

export default QueryConsole
