import React, { useState, useCallback, useRef } from 'react'
import {
  Heading, View, Flex, Button, TextField, TextArea, Checkbox, CheckboxGroup,
  Picker, Item, Well, Text, ProgressCircle, Divider, Switch, NumberField
} from '@adobe/react-spectrum'
import { useNavigate } from 'react-router-dom'
import { uploadFile } from './actionInvoker'
import { useNotifications } from './NotificationProvider'

function FileUpload ({ runtime, ims }) {
  const navigate = useNavigate()
  const notify = useNotifications()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  // Step 1: CSV content
  const [csvContent, setCsvContent] = useState('')
  const [fileName, setFileName] = useState('')

  // Step 2: Preview data
  const [headers, setHeaders] = useState([])
  const [previewRows, setPreviewRows] = useState([])

  // Step 3: Entity config
  const [entityName, setEntityName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [primaryKey, setPrimaryKey] = useState('')
  const [visibility, setVisibility] = useState('private')
  const [crudEnabled, setCrudEnabled] = useState(true)

  // Step 4: Schema config
  const [queryableFields, setQueryableFields] = useState([])
  const [requiredFields, setRequiredFields] = useState([])
  const [facetableFields, setFacetableFields] = useState([])

  // Drag and drop
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)

  function handleFileSelect (e) {
    const file = e.target.files[0]
    if (!file) return
    processFile(file)
  }

  function processFile (file) {
    if (!file.name.endsWith('.csv')) {
      notify.error('Only .csv files are allowed')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      notify.error('File size exceeds 10MB limit')
      return
    }

    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target.result
      setCsvContent(content)
      parsePreview(content)
      setError(null)
      setStep(2)
    }
    reader.readAsText(file)
  }

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [])

  function parsePreview (content) {
    const lines = content.trim().split('\n')
    if (lines.length < 2) {
      setError('CSV must have at least a header row and one data row')
      return
    }

    const headerRow = parseCSVLine(lines[0]).map(h => h.trim())
    setHeaders(headerRow)

    const rows = []
    for (let i = 1; i < Math.min(lines.length, 6); i++) {
      const values = parseCSVLine(lines[i])
      const row = {}
      headerRow.forEach((h, idx) => {
        row[h] = values[idx] ? values[idx].trim() : ''
      })
      rows.push(row)
    }
    setPreviewRows(rows)

    // Auto-suggest entity name from file name
    const baseName = fileName.replace('.csv', '').toLowerCase().replace(/[^a-z0-9-]/g, '-')
    if (!entityName) setEntityName(baseName)
    if (!displayName) setDisplayName(fileName.replace('.csv', ''))
  }

  function parseCSVLine (line) {
    const result = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current)
        current = ''
      } else {
        current += char
      }
    }
    result.push(current)
    return result
  }

  async function handleSubmit () {
    try {
      setLoading(true)
      setError(null)

      const params = {
        csvContent,
        entityName,
        displayName,
        description,
        primaryKey,
        visibility,
        crudEnabled,
        queryableFields,
        requiredFields,
        facetableFields
      }

      const res = await uploadFile(params, ims)
      setResult(res)
      setStep(7)
      notify.success(`Entity "${displayName}" published successfully with ${res.recordCount || 0} records`)
    } catch (e) {
      setError(e.message)
      notify.error(`Upload failed: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  function renderStepIndicator () {
    const steps = ['Upload', 'Preview', 'Configure', 'Schema', 'Facets', 'Review', 'Done']
    return (
      <div className='mdm-stepper'>
        {steps.map((s, idx) => (
          <div
            key={idx}
            className={`mdm-stepper__step ${idx + 1 === step ? 'mdm-stepper__step--active' : ''} ${idx + 1 < step ? 'mdm-stepper__step--complete' : ''}`}
          >
            <div className='mdm-stepper__number'>{idx + 1 < step ? '✓' : idx + 1}</div>
            <span className='mdm-stepper__label'>{s}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <View UNSAFE_className='mdm-page'>
      <Heading level={1} UNSAFE_className='mdm-page__title' marginBottom='size-100'>Upload CSV</Heading>
      <Text UNSAFE_className='mdm-page__subtitle' marginBottom='size-300'>
        Import master data from a CSV file with automatic schema detection
      </Text>
      {renderStepIndicator()}

      {error && (
        <Well marginBottom='size-200' UNSAFE_className='mdm-alert mdm-alert--error'>
          <Text>{error}</Text>
        </Well>
      )}

      {/* Step 1: Upload CSV with Drag & Drop */}
      {step === 1 && (
        <View>
          <div
            className={`mdm-dropzone ${isDragging ? 'mdm-dropzone--active' : ''} ${csvContent ? 'mdm-dropzone--has-file' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
          >
            <input
              ref={fileInputRef}
              type='file'
              accept='.csv'
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            {csvContent ? (
              <div className='mdm-dropzone__success'>
                <div className='mdm-dropzone__icon'>✓</div>
                <Text><strong>{fileName}</strong></Text>
                <Text UNSAFE_className='mdm-text-muted'>
                  {csvContent.split('\n').length - 1} rows detected
                </Text>
                <Button variant='secondary' marginTop='size-100' onPress={(e) => { e.stopPropagation(); setCsvContent(''); setFileName('') }}>
                  Replace File
                </Button>
              </div>
            ) : (
              <div className='mdm-dropzone__prompt'>
                <div className='mdm-dropzone__icon'>📄</div>
                <Text><strong>Drop CSV file here</strong></Text>
                <Text UNSAFE_className='mdm-text-muted'>or click to browse • Max 10MB</Text>
              </div>
            )}
          </div>
          <Flex justifyContent='end' marginTop='size-200'>
            <Button variant='accent' isDisabled={!csvContent} onPress={() => setStep(2)}>
              Next: Preview Data
            </Button>
          </Flex>
        </View>
      )}

      {/* Step 2: Preview */}
      {step === 2 && (
        <View>
          <Heading level={3} marginBottom='size-200'>Step 2: Preview Data</Heading>
          <Well>
            <Text marginBottom='size-100'><strong>Columns detected:</strong> {headers.length}</Text>
            <Text marginBottom='size-200'><strong>Headers:</strong> {headers.join(', ')}</Text>
            <Divider marginBottom='size-200' />
            <div style={{ overflowX: 'auto' }}>
              <table className='mdm-table'>
                <thead>
                  <tr>
                    {headers.map(h => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, idx) => (
                    <tr key={idx}>
                      {headers.map(h => <td key={h}>{row[h]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Well>
          <Flex justifyContent='space-between' marginTop='size-200'>
            <Button variant='secondary' onPress={() => setStep(1)}>Back</Button>
            <Button variant='cta' onPress={() => setStep(3)}>Next: Configure Entity</Button>
          </Flex>
        </View>
      )}

      {/* Step 3: Entity Configuration */}
      {step === 3 && (
        <View>
          <Heading level={3} marginBottom='size-200'>Step 3: Configure Entity</Heading>
          <Well>
            <Flex direction='column' gap='size-200'>
              <TextField label='Entity Name' value={entityName} onChange={setEntityName}
                description='Lowercase, alphanumeric with hyphens or underscores (e.g., product-master)' isRequired />
              <TextField label='Display Name' value={displayName} onChange={setDisplayName} isRequired />
              <TextArea label='Description' value={description} onChange={setDescription} />
              <Picker label='Primary Key Column (optional)' selectedKey={primaryKey} onSelectionChange={setPrimaryKey}
                description='If not selected, an auto-generated entity_id will be used'>
                <Item key=''>None (auto-generate entity_id)</Item>
                {headers.map(h => <Item key={h}>{h}</Item>)}
              </Picker>
              <Picker label='Visibility' selectedKey={visibility} onSelectionChange={setVisibility}>
                <Item key='public'>Public (Read without auth)</Item>
                <Item key='private'>Private (Auth required)</Item>
              </Picker>
              <Checkbox isSelected={crudEnabled} onChange={setCrudEnabled}>
                Enable CRUD Operations
              </Checkbox>
            </Flex>
          </Well>
          <Flex justifyContent='space-between' marginTop='size-200'>
            <Button variant='secondary' onPress={() => setStep(2)}>Back</Button>
            <Button variant='cta' isDisabled={!entityName} onPress={() => setStep(4)}>
              Next: Define Schema
            </Button>
          </Flex>
        </View>
      )}

      {/* Step 4: Schema Configuration */}
      {step === 4 && (
        <View>
          <Heading level={3} marginBottom='size-200'>Step 4: Define Schema</Heading>
          <Well>
            <CheckboxGroup label='Queryable Fields (can be used as API query params)' value={queryableFields} onChange={setQueryableFields}>
              {headers.map(h => <Checkbox key={h} value={h}>{h}</Checkbox>)}
            </CheckboxGroup>
            <Divider marginY='size-200' />
            <CheckboxGroup label='Required Fields' value={requiredFields} onChange={setRequiredFields}>
              {headers.map(h => <Checkbox key={h} value={h}>{h}</Checkbox>)}
            </CheckboxGroup>
          </Well>
          <Flex justifyContent='space-between' marginTop='size-200'>
            <Button variant='secondary' onPress={() => setStep(3)}>Back</Button>
            <Button variant='cta' onPress={() => setStep(5)}>Next: Configure Facets</Button>
          </Flex>
        </View>
      )}

      {/* Step 5: Facets / Aggregation Configuration */}
      {step === 5 && (
        <View>
          <Heading level={3} marginBottom='size-200'>Step 5: Configure Facets / Aggregations</Heading>
          <Text marginBottom='size-200'>
            Select fields that should be available as facets (filterable aggregations) when querying via API Mesh.
            Facets provide count-based filtering similar to Adobe Commerce layered navigation.
          </Text>
          <Well>
            <CheckboxGroup label='Facetable Fields (will generate aggregation counts in API responses)' value={facetableFields} onChange={setFacetableFields}>
              {headers.map(h => <Checkbox key={h} value={h}>{h}</Checkbox>)}
            </CheckboxGroup>
            {facetableFields.length > 0 && (
              <View marginTop='size-200'>
                <Divider marginBottom='size-200' />
                <Text UNSAFE_className='mdm-text-muted'>
                  <strong>{facetableFields.length} field(s) selected.</strong> These will return aggregated value counts
                  in query responses and be available via the <code>mdmFacets</code> API Mesh query.
                  You can configure sort order, limits, and display settings later from the Schema editor.
                </Text>
              </View>
            )}
          </Well>
          <Flex justifyContent='space-between' marginTop='size-200'>
            <Button variant='secondary' onPress={() => setStep(4)}>Back</Button>
            <Button variant='cta' onPress={() => setStep(6)}>Next: Review</Button>
          </Flex>
        </View>
      )}

      {/* Step 6: Review */}
      {step === 6 && (
        <View>
          <Heading level={3} marginBottom='size-200'>Step 6: Review & Publish</Heading>
          <Well>
            <Flex direction='column' gap='size-100'>
              <Text><strong>Entity Name:</strong> {entityName}</Text>
              <Text><strong>Display Name:</strong> {displayName}</Text>
              <Text><strong>Description:</strong> {description || '(none)'}</Text>
              <Text><strong>Primary Key:</strong> {primaryKey || 'entity_id (auto-generated)'}</Text>
              <Text><strong>Visibility:</strong> {visibility}</Text>
              <Text><strong>CRUD Enabled:</strong> {crudEnabled ? 'Yes' : 'No'}</Text>
              <Text><strong>Queryable Fields:</strong> {queryableFields.join(', ') || '(none)'}</Text>\n              <Text><strong>Required Fields:</strong> {requiredFields.join(', ') || '(none)'}</Text>
              <Text><strong>Facetable Fields:</strong> {facetableFields.join(', ') || '(none)'}</Text>
              <Text><strong>Total Columns:</strong> {headers.length}</Text>
              <Text><strong>Preview Rows:</strong> {previewRows.length}</Text>
              <Divider marginY='size-200' />
              <Heading level={4}>Generated API Endpoints:</Heading>
              <Text><code>GET /api/mdm/{entityName}</code></Text>
              <Text><code>GET /api/mdm/{entityName}/:id</code></Text>
              {crudEnabled && (
                <>
                  <Text><code>POST /api/mdm/{entityName}</code></Text>
                  <Text><code>PUT /api/mdm/{entityName}/:id</code></Text>
                  <Text><code>PATCH /api/mdm/{entityName}/:id</code></Text>
                  <Text><code>DELETE /api/mdm/{entityName}/:id</code></Text>
                  <Text><code>POST /api/mdm/{entityName}/bulk</code></Text>
                  <Text><code>POST /api/mdm/{entityName}/full-update</code></Text>
                  <Text><code>POST /api/mdm/{entityName}/delta-update</code></Text>
                </>
              )}
            </Flex>
          </Well>
          <Flex justifyContent='space-between' marginTop='size-200'>
            <Button variant='secondary' onPress={() => setStep(5)}>Back</Button>
            <Button variant='cta' onPress={handleSubmit} isDisabled={loading}>
              {loading ? <ProgressCircle aria-label='Publishing...' isIndeterminate size='S' /> : 'Publish'}
            </Button>
          </Flex>
        </View>
      )}

      {/* Step 7: Success */}
      {step === 7 && result && (
        <View>
          <div className='mdm-success-state'>
            <div className='mdm-success-state__icon'>✓</div>
            <Heading level={2}>Entity Published Successfully</Heading>
            <Text UNSAFE_className='mdm-text-muted' marginBottom='size-200'>
              Your master data is now available via the API Mesh
            </Text>
          </div>
          <View UNSAFE_className='mdm-card'>
            <div className='mdm-detail-list'>
              <div className='mdm-detail-list__row'>
                <span className='mdm-detail-list__label'>Entity</span>
                <span className='mdm-detail-list__value'>{result.entity}</span>
              </div>
              <div className='mdm-detail-list__row'>
                <span className='mdm-detail-list__label'>Version</span>
                <span className='mdm-detail-list__value'>{result.versionId}</span>
              </div>
              <div className='mdm-detail-list__row'>
                <span className='mdm-detail-list__label'>Records Imported</span>
                <span className='mdm-detail-list__value'>{result.recordCount}</span>
              </div>
              <div className='mdm-detail-list__row'>
                <span className='mdm-detail-list__label'>Status</span>
                <span className='mdm-detail-list__value'>{result.status}</span>
              </div>
            </div>
          </View>
          <Flex gap='size-200' marginTop='size-300' justifyContent='center'>
            <Button variant='accent' onPress={() => navigate(`/files/${result.entity}`)}>View Entity</Button>
            <Button variant='secondary' onPress={() => navigate(`/files/${result.entity}/records`)}>View Records</Button>
            <Button variant='secondary' onPress={() => navigate('/files')}>All Entities</Button>
            <Button variant='secondary' onPress={() => { setStep(1); setCsvContent(''); setResult(null) }}>Upload Another</Button>
          </Flex>
        </View>
      )}
    </View>
  )
}

export default FileUpload
