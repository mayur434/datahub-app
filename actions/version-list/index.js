/**
 * MDM Version List Action
 * Lists all versions for a master from the versions collection.
 */

const { getDbClient, safeFindOne, COLLECTIONS, createResponse, createErrorResponse, validateIMSToken, getEnvConfig, getCachedSettings } = require('../mdm-utils')

async function main (params) {
  if (params.__ow_method === 'options') return createResponse({})

  const auth = validateIMSToken(params)
  if (!auth.valid) return createErrorResponse(auth.error, 401)

  let client
  try {
    const master = params.master || params.entity
    if (!master) return createErrorResponse('Missing required parameter: master')

    client = await getDbClient(params)
    const metaCol = await client.collection(COLLECTIONS.METADATA)
    const versionCol = await client.collection(COLLECTIONS.VERSIONS)

    const metadata = await safeFindOne(metaCol, { masterName: master })
    if (!metadata || metadata.status === 'deleted') {
      return createErrorResponse(`Master '${master}' not found`, 404)
    }

    // Load settings for pagination
    const settingsDoc = await getCachedSettings(client)
    const env = getEnvConfig(params)
    const apiSettings = settingsDoc?.api || {}
    const maxPageSize = apiSettings.maxPageSize || env.maxPageSize
    const defaultPageSize = apiSettings.defaultPageSize || env.defaultPageSize

    const page = Math.max(1, parseInt(params.page) || 1)
    const pageSize = Math.min(maxPageSize, Math.max(1, parseInt(params.pageSize) || defaultPageSize))

    const total = await versionCol.countDocuments({ masterName: master })
    const versions = await versionCol.find({ masterName: master })
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray()

    return createResponse({
      master,
      activeVersionId: metadata.activeVersionId,
      versions,
      total,
      page,
      pageSize
    })
  } catch (error) {
    console.error('Version list error:', error)
    return createErrorResponse(`Failed to list versions: ${error.message}`, 500)
  } finally {
    if (client) await client.close()
  }
}

exports.main = main
