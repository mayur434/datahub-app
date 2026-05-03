#!/usr/bin/env node

/**
 * Flush all data from aio-lib-db collections.
 * Usage: npm run flush-db
 */

require('dotenv').config()
const { Core } = require('@adobe/aio-sdk')
const libDb = require('@adobe/aio-lib-db')

// aio-lib-db reads __OW_NAMESPACE from env; .env has AIO_runtime_namespace
if (!process.env.__OW_NAMESPACE && process.env.AIO_runtime_namespace) {
  process.env.__OW_NAMESPACE = process.env.AIO_runtime_namespace
}

const SYSTEM_COLLECTIONS = ['metadata', 'audit', 'settings', 'archives', 'roles', 'partners']
const MDM_COLLECTION_PREFIX = 'mdm_'

async function run () {
  let client
  try {
    // Build the params object that generateAccessToken expects
    const scopes = process.env.IMS_OAUTH_S2S_SCOPES
    const params = {
      client_id: process.env.IMS_OAUTH_S2S_CLIENT_ID,
      client_secret: process.env.IMS_OAUTH_S2S_CLIENT_SECRET,
      org_id: process.env.IMS_OAUTH_S2S_ORG_ID,
      scopes: typeof scopes === 'string' ? JSON.parse(scopes) : (scopes || [])
    }

    const { generateAccessToken } = Core.AuthClient
    const token = await generateAccessToken(params)
    const region = process.env.AIO_DB_REGION || 'apac'
    const db = await libDb.init({ token: token.access_token, region })
    client = await db.connect()

    let totalDeleted = 0

    // --- Phase 1: Discover per-master collections from metadata ---
    const masterCollections = []
    try {
      const metaCol = await client.collection('metadata')
      const allMeta = await metaCol.find({}).toArray()
      for (const m of allMeta) {
        const name = m.masterName || m.entityName
        if (name) {
          masterCollections.push(`${MDM_COLLECTION_PREFIX}${name}`)
        }
      }
      if (masterCollections.length > 0) {
        console.log(`Found ${masterCollections.length} per-master collection(s): ${masterCollections.join(', ')}`)
      }
    } catch (e) {
      console.log('  (no metadata collection or empty — skipping master discovery)')
    }

    // --- Phase 2: Flush per-master data collections first ---
    for (const colName of masterCollections) {
      try {
        const col = await client.collection(colName)
        const docs = await col.find({}).toArray()
        if (docs.length > 0) {
          for (const doc of docs) {
            await col.deleteOne({ _id: doc._id })
          }
          console.log(`  ✓ ${colName}: deleted ${docs.length} documents`)
          totalDeleted += docs.length
        } else {
          console.log(`  - ${colName}: empty`)
        }
      } catch (e) {
        // Collection may not exist yet — that's fine
        console.log(`  - ${colName}: ${e.message}`)
      }
    }

    // --- Phase 3: Flush system collections ---
    for (const name of SYSTEM_COLLECTIONS) {
      try {
        const col = await client.collection(name)
        const docs = await col.find({}).toArray()
        if (docs.length > 0) {
          for (const doc of docs) {
            await col.deleteOne({ _id: doc._id })
          }
          console.log(`  ✓ ${name}: deleted ${docs.length} documents`)
          totalDeleted += docs.length
        } else {
          console.log(`  - ${name}: empty`)
        }
      } catch (e) {
        console.error(`  ✗ ${name}: ${e.message}`)
      }
    }

    // --- Phase 4: Flush legacy 'records' collection if it still exists ---
    try {
      const legacyCol = await client.collection('records')
      const legacyDocs = await legacyCol.find({}).toArray()
      if (legacyDocs.length > 0) {
        for (const doc of legacyDocs) {
          await legacyCol.deleteOne({ _id: doc._id })
        }
        console.log(`  ✓ records (legacy): deleted ${legacyDocs.length} documents`)
        totalDeleted += legacyDocs.length
      }
    } catch (e) {
      // No legacy collection — expected after migration
    }

    console.log(`\nDone. ${totalDeleted} total documents deleted.`)
  } catch (error) {
    console.error('Flush failed:', error.message)
    process.exit(1)
  } finally {
    if (client) await client.close()
  }
}

console.log('Flushing all aio-lib-db collections...\n')
run()
