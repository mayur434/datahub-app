---
title: "MDM Utilities & Shared Infrastructure"
sidebar_position: 2
description: "Technical documentation for the MDM Utilities & Shared Infrastructure feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/datahub-app/blob/main/actions/mdm-utils.js
---

> Centralized module providing database connectivity, caching, RBAC enforcement, audit logging, storage guardrails, and all shared business logic for the DataHub MDM platform.

## Overview

The MDM Utilities module (`actions/mdm-utils.js`) is the backbone of the DataHub platform. It provides the shared infrastructure layer that all MDM actions depend on, including:

- **Database connectivity** via `@adobe/aio-lib-db` (MongoDB-compatible document store)
- **Caching layer** via `@adobe/aio-lib-state` (key-value store with TTL)
- **Role-Based Access Control (RBAC)** with granular feature permissions
- **Audit logging** for all mutation operations
- **Storage guardrails** to enforce configurable limits
- **CSV parsing and validation** for data import operations
- **Event publishing** for mutation notifications

This module is imported by virtually every action in the system and establishes the core patterns that define the platform's behavior.

## Technical Specification

### Module Location
| Property | Value |
|----------|-------|
| **File** | `actions/mdm-utils.js` |
| **Type** | CommonJS module |
| **Primary Dependencies** | `@adobe/aio-lib-db`, `@adobe/aio-lib-state`, `@adobe/aio-sdk` |
| **Consumers** | All MDM action `index.js` files |

### Collection Constants

```javascript
const COLLECTIONS = {
  metadata: 'metadata',           // Master metadata & schema definitions
  audit: 'audit',                 // Audit log entries
  audit_archives: 'audit_archives', // Archived audit log references
  settings: 'settings',           // Application configuration
  archives: 'archives',           // Data archive metadata
  roles: 'roles',                 // DEPRECATED: legacy roles
  partners: 'partners',           // Integration partner credentials
  user_sessions: 'user_sessions', // Active session tracking
  app_users: 'app_users',         // Application user records
  app_roles: 'app_roles',         // Custom role definitions
  counters: 'counters'            // Atomic sequence counters
}
```

**System vs User Collections:**
- System collections: All named in `COLLECTIONS` + `SYSTEM_COLLECTION_NAMES` array
- User data collections: `mdm_<masterName>` (dynamically created per master)

### RBAC System

#### Feature Permissions (`APP_FEATURES`)

```javascript
const APP_FEATURES = {
  dashboard: 'dashboard',
  masters: 'masters',
  import_data: 'import_data',
  query_console: 'query_console',
  activity_log: 'activity_log',
  partners: 'partners',
  admin_console: 'admin_console',
  settings: 'settings',
  record_management: 'record_management',
  schema_management: 'schema_management',
  archive_management: 'archive_management',
  user_management: 'user_management'
}
```

#### Action → Feature Mapping (`ACTION_FEATURE_MAP`)

Each backend action maps to one or more features. Access is granted if the user has ANY of the mapped features (OR logic):

| Action | Required Feature(s) |
|--------|-------------------|
| `dashboard` | `dashboard` |
| `file-list` | `masters`, `import_data`, `record_management`, `schema_management`, `archive_management` |
| `file-upload` | `import_data` |
| `file-detail` | `masters`, `import_data`, `record_management`, `schema_management`, `archive_management` |
| `file-delete` | `masters` |
| `query-data` | `masters`, `query_console`, `record_management` |
| `record-crud` | `record_management` |
| `schema-update` | `schema_management` |
| `full-update` | `import_data` |
| `delta-update` | `import_data` |
| `bulk-update` | `import_data`, `record_management` |
| `visibility-update` | `masters` |
| `metadata-update` | `masters` |
| `audit-list` | `activity_log` |
| `audit-cleanup` | `admin_console` |
| `archive-config` | `archive_management` |
| `archive-list` | `archive_management` |
| `archive-run` | `archive_management` |
| `partner-management` | `partners` |
| `user-management` | `user_management` |
| `app-settings` | `settings` |
| `infra-metrics` | `admin_console` |

#### System Roles

```javascript
const SYSTEM_ROLES = {
  'Super Admin': buildDefaultPermissions(true),   // All features enabled
  'Viewer': {
    dashboard: true,
    masters: true,
    query_console: true,
    // All others: false
  }
}
```

## Code Walkthrough

### Database Connectivity

#### `getDbClient(params)`

Initializes and returns a connected database client using Adobe I/O lib-db.

```javascript
const client = await getDbClient(params)
try {
  const collection = client.collection('metadata')
  // ... operations
} finally {
  await client.close() // CRITICAL: Always close in finally block
}
```

**Important:** Every action MUST close the client in a `finally` block to prevent connection leaks. The database region is configured via `DB_REGION` environment variable.

#### `safeFindOne(collection, filter)`

Wrapper around `collection.findOne()` that returns `null` instead of throwing when no document matches.

```javascript
const doc = await safeFindOne(metaCol, { masterName: 'products' })
if (!doc) {
  return createErrorResponse('Master not found', 404)
}
```

#### `getMasterCollectionName(masterName)` / `getMasterCollection(client, masterName)`

Converts a master name to its database collection name and retrieves the collection handle.

```javascript
getMasterCollectionName('products')  // → 'mdm_products'
const col = getMasterCollection(client, 'products')  // → collection handle for 'mdm_products'
```

### Caching Layer

#### `getStateClient(params)`

Returns an initialized `@adobe/aio-lib-state` client for key-value caching with TTL.

```javascript
const state = await getStateClient(params)
await state.put('dashboard-cache', JSON.stringify(data), { ttl: 900 }) // 15 min
const cached = await state.get('dashboard-cache')
```

**Use Cases:**
- Dashboard data (15-min TTL)
- User permission resolution (2-min TTL)
- Infrastructure metrics (configurable TTL)
- System role seeding flag (1-hour TTL)
- Rate limiting counters

### RBAC Enforcement

#### `seedSystemRoles(client, params)`

Ensures system roles exist in the database. Uses state cache to avoid repeated DB checks (1-hour TTL on seed flag).

```javascript
await seedSystemRoles(client, params) // Idempotent — no-op if already seeded
```

#### `resolveAppUser(client, params)`

Resolves the current user's identity, role, and computed permissions. Results are cached in `aio-lib-state` for 2 minutes.

```javascript
const user = await resolveAppUser(client, params)
// Returns: { email, firstName, lastName, role, permissions: { dashboard: true, ... } }
```

**Resolution Flow:**
1. Extract email from IMS token
2. Check state cache for `user-resolve-<email>`
3. If miss: query `app_users` collection → fetch role from `app_roles` → compute permissions
4. Cache result with 2-min TTL
5. Return user object

#### `enforceAppPermission(client, params, actionName)`

The primary RBAC gate called at the start of every protected action.

```javascript
await enforceAppPermission(client, params, 'record-crud')
// Throws 403 if user lacks permission
// Returns silently if authorized
```

**Logic:**
1. Look up `ACTION_FEATURE_MAP[actionName]` → array of feature keys
2. Call `resolveAppUser()` to get user's permissions
3. Check if user has ANY of the required features (OR logic)
4. If no match → throw error (caught by action's try/catch → 403 response)

### Audit Logging

#### `createAuditLog(client, logData)`

Creates an immutable audit trail entry for any significant operation.

```javascript
await createAuditLog(client, {
  masterName: 'products',
  operation: 'bulk-update',
  actor: 'user@company.com',
  status: 'success',
  affectedRecords: 150,
  details: { mode: 'upsert', errors: 0 }
})
```

**Stored Fields:**
- `masterName` — affected entity
- `operation` — action performed
- `actor` — user email (extracted from token)
- `status` — `'success'` or `'failure'`
- `affectedRecords` — count of affected documents
- `details` — operation-specific metadata
- `timestamp` — timezone-aware timestamp
- `_id` — auto-generated unique ID

### Storage Guardrails

#### `checkStorageGuardrails(client, params, additionalDocs)`

Validates that the operation won't exceed configured storage limits.

```javascript
const violation = await checkStorageGuardrails(client, params, newRecordCount)
if (violation) {
  return createErrorResponse(violation.message, 507)
}
```

**Checked Limits (from settings/env):**
- `MDM_MAX_STORAGE_MB` — total database size
- Max documents per collection
- Max total collections
- Max document size

### CSV Processing

#### `parseCSV(csvContent)`

Parses CSV content (string) into an array of objects using the header row as keys.

#### `validateCSV(records, schema)`

Validates parsed CSV records against a master's schema definition.

```javascript
const records = parseCSV(csvContent)
const errors = validateCSV(records, masterSchema)
if (errors.length > 0) {
  return createErrorResponse(`Validation failed: ${errors.join(', ')}`, 422)
}
```

#### `decompressCsvContent(content)`

Handles gzip-compressed CSV content (for large file uploads).

### Event Publishing

#### `publishMutationEvent(params, eventData)`

Publishes a CloudEvent via Adobe I/O Events when data is mutated.

```javascript
await publishMutationEvent(params, {
  master: 'products',
  operation: 'create',
  recordId: 'prod_001',
  actor: 'user@company.com'
})
```

### Response Helpers

#### `createResponse(body, statusCode)`

Creates a standardized success response with CORS headers.

```javascript
return createResponse({ status: 'success', data: results }, 200)
// Returns: { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', ... }, body: {...} }
```

#### `createErrorResponse(message, statusCode)`

Creates a standardized error response.

```javascript
return createErrorResponse('Master not found', 404)
// Returns: { statusCode: 404, headers: {...}, body: { error: 'Master not found' } }
```

### Utility Functions

| Function | Purpose |
|----------|---------|
| `getTimezoneDate()` | Returns current timestamp in configured timezone |
| `getEnvConfig(params)` | Extracts environment configuration from action params |
| `getCachedSettings(client, params)` | Returns app settings (from cache or DB) |
| `escapeRegex(string)` | Escapes special regex characters for safe DB queries |
| `estimateFileSizeMB(records)` | Estimates storage size of a record set |
| `getNextSequenceId(client, name, count)` | Atomic counter for auto-ID generation |
| `getUserEmailFromToken(params)` | Extracts email claim from IMS JWT |
| `invalidateResolveCache(params, email)` | Clears cached user resolution |
| `invalidateSettingsCache(params)` | Clears cached settings |
| `validatePartner(client, partnerId, partnerKey)` | Validates partner credentials |
| `checkRateLimit(state, partnerId, limit)` | Rate limit check for public API |
| `registerUserSession(client, params)` | Tracks active user sessions |
| `deregisterUserSession(client, params)` | Removes active session |

## Architecture & Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Action Entry Point                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐     ┌──────────────────┐     ┌─────────────┐ │
│  │  getDbClient │────▶│ enforceAppPermission│────▶│  Business   │ │
│  │              │     │  (RBAC Gate)       │     │  Logic      │ │
│  └──────────────┘     └──────────────────┘     └─────────────┘ │
│         │                      │                       │         │
│         ▼                      ▼                       ▼         │
│  ┌──────────────┐     ┌──────────────────┐     ┌─────────────┐ │
│  │  aio-lib-db  │     │  resolveAppUser  │     │ createAudit │ │
│  │  (MongoDB)   │     │  (+ State Cache) │     │    Log      │ │
│  └──────────────┘     └──────────────────┘     └─────────────┘ │
│                                                                   │
│  ┌──────────────┐     ┌──────────────────┐     ┌─────────────┐ │
│  │ aio-lib-state│     │  getCachedSettings│     │ createResp  │ │
│  │  (KV Cache)  │     │  (Merged Config) │     │ (CORS + JSON│ │
│  └──────────────┘     └──────────────────┘     └─────────────┘ │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Security Considerations

- **Connection Management**: Every DB connection MUST be closed in `finally` blocks
- **Token Validation**: `resolveAppUser` validates IMS tokens via Adobe SDK
- **Permission Caching**: 2-minute TTL balances performance with permission update propagation
- **Partner Key Storage**: Partner keys are hashed; raw keys shown only at creation time
- **Rate Limiting**: State-based sliding window rate limiter for public API
- **Storage Guardrails**: Prevents resource exhaustion attacks via unbounded uploads

## Configuration

| Environment Variable | Default | Purpose |
|---------------------|---------|---------|
| `DB_REGION` | `apac` | Database region |
| `APP_TIMEZONE` | `UTC` | Timestamp timezone |
| `MDM_MAX_STORAGE_MB` | `500` | Max total storage |
| `RATE_LIMIT_PER_MINUTE` | `60` | Public API rate limit |
| `MAX_SCHEMA_FIELDS` | `100` | Max fields per schema |
| `BULK_BATCH_SIZE` | `1000` | Bulk operation batch size |
| `INITIAL_ADMIN_EMAIL` | — | First Super Admin email |

## Related Features

- [Core Utilities](./core-utils.md) — Basic request/response helpers
- [Record CRUD](../data-management/record-crud.md) — Uses RBAC, audit, guardrails
- [User Management](../administration/user-management.md) — Manages the RBAC data this module enforces
- [App Settings](../administration/app-settings.md) — Configures guardrails and limits

---
*Last updated: 2025-05-08*
*Source: `actions/mdm-utils.js`*
