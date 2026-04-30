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

const COLLECTIONS = ['metadata', 'records', 'versions', 'audit', 'settings', 'archives']

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
    for (const name of COLLECTIONS) {
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
