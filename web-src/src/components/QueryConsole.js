import React, { useState, useEffect } from 'react'
import {
  Heading, View, Flex, Button, TextField, Text, ProgressCircle,
  Picker, Item, Divider
} from '@adobe/react-spectrum'
import { useNavigate } from 'react-router-dom'
import { fetchFileList, queryData } from './actionInvoker'
import { useNotifications } from './NotificationProvider'
import Code from '@spectrum-icons/workflow/Code'

function QueryConsole ({ runtime, ims }) {
  const navigate = useNavigate()
  const notify = useNotifications()
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Query params
  const [selectedEntity, setSelectedEntity] = useState('')
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
    loadEntities()
  }, [])

  async function loadEntities () {
    try {
      const res = await fetchFileList(ims)
      setEntities(res.files || [])
    } catch (e) {
      console.error('Failed to load entities', e)
    }
  }

  async function handleQuery () {
    if (!selectedEntity) return
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

      const res = await queryData(selectedEntity, queryParams, ims)
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
          <Text UNSAFE_className='mdm-page__subtitle'>Test data queries and explore API Mesh endpoints</Text>
        </View>
      </Flex>

      {/* Query Builder */}
      <View UNSAFE_className='mdm-card' marginBottom='size-300'>
        <Heading level={3} marginBottom='size-200'>Query Builder</Heading>
        <div className='mdm-form-grid'>
          <Picker label='Entity' selectedKey={selectedEntity} onSelectionChange={setSelectedEntity} isRequired width='100%'>
            {entities.map(e => <Item key={e.entityName}>{e.displayName || e.entityName}</Item>)}
          </Picker>

          <TextField label='Record ID (single)' value={recordId} onChange={setRecordId}
            placeholder='Leave empty for collection query' width='100%' />

          <TextField label='Filters' value={filterStr} onChange={setFilterStr}
            placeholder='field=value&field2=value2' width='100%' />

          <Flex gap='size-200' width='100%'>
            <TextField label='Sort Field' value={sortField} onChange={setSortField} flex={1} />
            <Picker label='Order' selectedKey={sortOrder} onSelectionChange={setSortOrder} width='size-1600'>
              <Item key='asc'>Ascending</Item>
              <Item key='desc'>Descending</Item>
            </Picker>
          </Flex>

          <TextField label='Fields (comma-separated)' value={fields} onChange={setFields}
            placeholder='name,code,price' width='100%' />

          <Flex gap='size-200' width='100%'>
            <TextField label='Page' value={String(page)} onChange={v => setPage(Number(v) || 1)} width='size-1200' />
            <TextField label='Page Size' value={String(pageSize)} onChange={v => setPageSize(Number(v) || 20)} width='size-1200' />
          </Flex>
        </div>

        <Flex marginTop='size-200'>
          <Button variant='cta' onPress={handleQuery} isDisabled={!selectedEntity || loading}>
            <Code size='S' /><Text>{loading ? 'Querying...' : 'Execute Query'}</Text>
          </Button>
        </Flex>
      </View>

      {error && (
        <div className='mdm-alert mdm-alert--error' style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 6 }}>
          <Text>{error}</Text>
        </div>
      )}

      {/* Result */}
      {result && (
        <View UNSAFE_className='mdm-card' marginBottom='size-300'>
          <Flex justifyContent='space-between' alignItems='center' marginBottom='size-200'>
            <Heading level={3}>Result</Heading>
            <Flex gap='size-100' alignItems='center'>
              <Text UNSAFE_className='mdm-text-muted'>
                {result.count !== undefined && `${result.count} records`}
                {result.total !== undefined && ` / ${result.total} total`}
                {result.page !== undefined && ` • Page ${result.page}`}
              </Text>
              <Button variant='secondary' isQuiet onPress={() => copyToClipboard(JSON.stringify(result, null, 2))}>
                Copy
              </Button>
            </Flex>
          </Flex>

          <div className='mdm-code-block'>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </div>
        </View>
      )}

      <Divider size='S' marginY='size-300' />

      {/* API Documentation */}
      <View UNSAFE_className='mdm-card'>
        <Heading level={3} marginBottom='size-200'>API Mesh Endpoint Reference</Heading>
        <Text UNSAFE_className='mdm-text-muted' marginBottom='size-200'>
          Master data is publicly available via API Mesh (no auth required for public entities).
        </Text>

        <div className='mdm-code-block' style={{ marginBottom: 16 }}>
          <pre>POST https://graph.adobe.io/api/YOUR_MESH_ID/graphql</pre>
        </div>

        <Heading level={4} marginTop='size-300' marginBottom='size-100'>Query All Records</Heading>
        <div className='mdm-code-block'>
          <pre>{`query {
  mdmQuery(entity: "products", page: 1, pageSize: 20) {
    entity
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
    entity: "products"
    filter: "category=electronics&brand=sony"
    sort: "price"
    order: "desc"
    fields: "name,price,sku"
    page: 1
    pageSize: 50
  ) {
    entity count total data
  }
}`}</pre>
        </div>

        <Heading level={4} marginTop='size-300' marginBottom='size-100'>Get Single Record</Heading>
        <div className='mdm-code-block'>
          <pre>{`query {
  mdmRecord(entity: "products", id: "SKU-001") {
    entity
    record
  }
}`}</pre>
        </div>
      </View>
    </View>
  )
}

export default QueryConsole
