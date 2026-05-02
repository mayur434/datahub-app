import React, { useState, useEffect } from 'react'
import {
  Heading, View, Flex, Button, TextField, Text, ProgressCircle, Well,
  Picker, Item, Checkbox, Divider, StatusLight, ActionButton
} from '@adobe/react-spectrum'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchFileDetail, updateSchema } from './actionInvoker'
import { useNotifications } from './NotificationProvider'

function SchemaManager ({ runtime, ims }) {
  const { master } = useParams()
  const navigate = useNavigate()
  const notify = useNotifications()
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Add field form
  const [showAddForm, setShowAddForm] = useState(false)
  const [newFieldName, setNewFieldName] = useState('')
  const [newFieldType, setNewFieldType] = useState('string')
  const [newFieldRequired, setNewFieldRequired] = useState(false)
  const [newFieldQueryable, setNewFieldQueryable] = useState(false)
  const [newFieldFacetable, setNewFieldFacetable] = useState(false)
  const [newFieldEditable, setNewFieldEditable] = useState(true)
  const [newFieldDefault, setNewFieldDefault] = useState('')

  // Rename field
  const [renamingField, setRenamingField] = useState(null)
  const [renameNewName, setRenameNewName] = useState('')

  useEffect(() => {
    loadFile()
  }, [master])

  async function loadFile () {
    try {
      setLoading(true)
      const result = await fetchFileDetail(master, ims)
      setFile(result.file)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleAddField () {
    try {
      setLoading(true)
      setError(null)
      await updateSchema(master, 'add', {
        name: newFieldName,
        type: newFieldType,
        required: newFieldRequired,
        queryable: newFieldQueryable,
        facetable: newFieldFacetable,
        editable: newFieldEditable,
        defaultValue: newFieldDefault || null
      }, ims)
      notify.success(`Field '${newFieldName}' added successfully`)
      setShowAddForm(false)
      setNewFieldName('')
      setNewFieldType('string')
      setNewFieldRequired(false)
      setNewFieldQueryable(false)
      setNewFieldFacetable(false)
      setNewFieldEditable(true)
      setNewFieldDefault('')
      await loadFile()
    } catch (e) {
      setError(e.message)
      notify.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdateField (fieldName, updates) {
    try {
      setLoading(true)
      setError(null)
      await updateSchema(master, 'update', { name: fieldName, ...updates }, ims)
      notify.success(`Field '${fieldName}' updated`)
      await loadFile()
    } catch (e) {
      setError(e.message)
      notify.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRemoveField (fieldName) {
    if (!window.confirm(`Remove field '${fieldName}' from schema? This does not delete data from existing records.`)) return
    try {
      setLoading(true)
      setError(null)
      await updateSchema(master, 'remove', { name: fieldName }, ims)
      notify.success(`Field '${fieldName}' removed`)
      await loadFile()
    } catch (e) {
      setError(e.message)
      notify.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRenameField (fieldName) {
    if (!renameNewName) return
    try {
      setLoading(true)
      setError(null)
      await updateSchema(master, 'rename', { name: fieldName, newName: renameNewName }, ims)
      notify.success(`Field '${fieldName}' renamed to '${renameNewName}'`)
      setRenamingField(null)
      setRenameNewName('')
      await loadFile()
    } catch (e) {
      setError(e.message)
      notify.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading && !file) {
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
          <Heading level={1} UNSAFE_className='mdm-page__title'>Schema: {file?.displayName || master}</Heading>
          <Text UNSAFE_className='mdm-page__subtitle'>Version: {file?.schemaVersionId} • {file?.schema?.length || 0} fields</Text>
        </View>
        <Flex gap='size-100'>
          <Button variant='secondary' onPress={() => navigate(`/masters/${master}`)}>Back</Button>
          <Button variant='accent' onPress={() => setShowAddForm(!showAddForm)}>Add Field</Button>
        </Flex>
      </Flex>

      {error && (
        <Well marginBottom='size-200' UNSAFE_className='mdm-alert mdm-alert--error'>
          <Text>{error}</Text>
        </Well>
      )}

      {/* Add Field Form */}
      {showAddForm && (
        <Well marginBottom='size-300'>
          <Heading level={3} marginBottom='size-200'>Add New Field</Heading>
          <Flex direction='column' gap='size-150'>
            <TextField label='Field Name' value={newFieldName} onChange={setNewFieldName} isRequired
              description='Lowercase, no spaces (e.g., brand-name or price)' />
            <Picker label='Data Type' selectedKey={newFieldType} onSelectionChange={setNewFieldType}>
              <Item key='string'>String</Item>
              <Item key='number'>Number</Item>
              <Item key='boolean'>Boolean</Item>
              <Item key='date'>Date</Item>
            </Picker>
            <Checkbox isSelected={newFieldRequired} onChange={setNewFieldRequired}>Required</Checkbox>
            <Checkbox isSelected={newFieldQueryable} onChange={setNewFieldQueryable}>Queryable (API filter)</Checkbox>
            <Checkbox isSelected={newFieldFacetable} onChange={setNewFieldFacetable}>Facetable (Aggregation)</Checkbox>
            <Checkbox isSelected={newFieldEditable} onChange={setNewFieldEditable}>Editable</Checkbox>
            <TextField label='Default Value (optional)' value={newFieldDefault} onChange={setNewFieldDefault} />
            <Flex gap='size-100'>
              <Button variant='cta' onPress={handleAddField} isDisabled={!newFieldName || loading}>Add Field</Button>
              <Button variant='secondary' onPress={() => setShowAddForm(false)}>Cancel</Button>
            </Flex>
          </Flex>
        </Well>
      )}

      {/* Schema Table */}
      <div className='mdm-table-container'>
        <table className='mdm-table mdm-table--hoverable'>
          <thead>
            <tr>
              <th>Field Name</th>
              <th>Type</th>
              <th>Required</th>
              <th>Queryable</th>
              <th>Facetable</th>
              <th>Editable</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {file?.schema?.map(field => (
              <tr key={field.name}>
                <td>
                  <strong>{field.name}</strong>
                  {field.name === file.primaryKey && <span className='mdm-badge-pk'>PK</span>}
                  {renamingField === field.name && (
                    <Flex gap='size-50' marginTop='size-50'>
                      <TextField value={renameNewName} onChange={setRenameNewName} placeholder='New name' aria-label='New name' />
                      <Button variant='primary' isQuiet onPress={() => handleRenameField(field.name)}>Save</Button>
                      <Button variant='secondary' isQuiet onPress={() => setRenamingField(null)}>Cancel</Button>
                    </Flex>
                  )}
                </td>
                <td><code className='mdm-code-inline'>{field.type}</code></td>
                <td>
                  <Checkbox isSelected={field.required}
                    onChange={(val) => handleUpdateField(field.name, { required: val })}
                    isDisabled={field.name === file.primaryKey}
                    aria-label='Required' />
                </td>
                <td>
                  <Checkbox isSelected={field.queryable}
                    onChange={(val) => handleUpdateField(field.name, { queryable: val })}
                    aria-label='Queryable' />
                </td>
                <td>
                  <Checkbox isSelected={field.facetable || false}
                    onChange={(val) => handleUpdateField(field.name, { facetable: val })}
                    aria-label='Facetable' />
                </td>
                <td>
                  <Checkbox isSelected={field.editable}
                    onChange={(val) => handleUpdateField(field.name, { editable: val })}
                    isDisabled={field.name === file.primaryKey}
                    aria-label='Editable' />
                </td>
                <td>
                  <Flex gap='size-50'>
                    {field.name !== file.primaryKey && (
                      <>
                        <ActionButton isQuiet onPress={() => { setRenamingField(field.name); setRenameNewName('') }}>
                          Rename
                        </ActionButton>
                        <ActionButton isQuiet UNSAFE_className='mdm-btn-danger' onPress={() => handleRemoveField(field.name)}>
                          Remove
                        </ActionButton>
                      </>
                    )}
                  </Flex>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Facets Configuration Summary */}
      {file?.facets && file.facets.enabled && (
        <View marginTop='size-400'>
          <Heading level={2} marginBottom='size-200'>Facets / Aggregation Configuration</Heading>
          <Text UNSAFE_className='mdm-page__subtitle' marginBottom='size-200'>
            Fields marked as "Facetable" above will return aggregation counts in API Mesh query responses.
            Use the <code>mdmFacets</code> query to retrieve facet metadata and live values.
          </Text>
          <Well>
            <Flex direction='column' gap='size-100'>
              <Text><strong>Facets Enabled:</strong> {file.facets.enabled ? 'Yes' : 'No'}</Text>
              <Text><strong>Return With Query:</strong> {file.facets.returnWithQuery ? 'Yes' : 'No'}</Text>
              <Text><strong>Max Values Per Facet:</strong> {file.facets.maxValuesPerFacet || 100}</Text>
              <Divider marginY='size-100' />
              <Heading level={4}>Configured Facets:</Heading>
              {file.facets.fields && file.facets.fields.map(f => (
                <Flex key={f.field} alignItems='center' gap='size-200'>
                  <StatusLight variant='positive'>{f.field}</StatusLight>
                  <Text UNSAFE_className='mdm-text-muted'>
                    Label: "{f.label}" • Type: {f.type} • Sort: {f.sortBy} ({f.sortOrder}) • Limit: {f.limit}
                  </Text>
                </Flex>
              ))}
            </Flex>
          </Well>
        </View>
      )}
    </View>
  )
}

export default SchemaManager
