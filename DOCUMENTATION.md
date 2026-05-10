# DataHub Platform — Technical Documentation

> Comprehensive technical reference for all DataHub MDM platform features, APIs, and internal architecture.

**Generated:** 2026-05-08  
**Version:** Auto-generated from `docs/features/*.md`  
**Source of Truth:** Individual feature files in `docs/features/` — edit there, then run `npm run build:docs`

---

## Table of Contents

### Core Infrastructure

- [Core Utilities](#feature-core-utilities)
- [MDM Utilities & Shared Infrastructure](#feature-mdm-utilities-shared-infrastructure)

### Data Management

- [Record CRUD](#feature-record-crud)
- [Query Data](#feature-query-data)
- [Bulk Update](#feature-bulk-update)
- [Schema Update](#feature-schema-update)
- [File Upload (Master Creation)](#feature-file-upload-master-creation)
- [Full Update](#feature-full-update)
- [Delta Update](#feature-delta-update)
- [Visibility Update](#feature-visibility-update)
- [Metadata Update](#feature-metadata-update)
- [File Operations (List, Detail, Delete)](#feature-file-operations-list-detail-delete)

### Public API

- [MDM Data (Public API)](#feature-mdm-data-public-api)
- [MDM Facets (Public API)](#feature-mdm-facets-public-api)

### Infrastructure & Operations

- [Dashboard](#feature-dashboard)
- [Archive Config](#feature-archive-config)
- [Archive Run](#feature-archive-run)
- [Archive List](#feature-archive-list)
- [Infrastructure Metrics](#feature-infrastructure-metrics)
- [Publish Events](#feature-publish-events)

### Administration

- [User Management](#feature-user-management)
- [Partner Management](#feature-partner-management)
- [Audit List](#feature-audit-list)
- [Audit Cleanup](#feature-audit-cleanup)
- [App Settings](#feature-app-settings)

---

## Platform Overview

DataHub is an **Adobe App Builder** application providing a **Master Data Management (MDM)** platform built on Adobe I/O Runtime (serverless). It manages master data collections with:

- **Full Admin UI** — React + Adobe Spectrum dashboard
- **Public APIs** — Via Adobe API Mesh for external consumption
- **RBAC** — Granular feature-level permissions with custom roles
- **Data Lifecycle** — Import, query, mutate, archive, audit
- **Event-Driven** — CloudEvents published on all mutations
- **Multi-Tenant** — Partner-scoped access with rate limiting

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Adobe I/O Runtime (Node.js 22, serverless) |
| Database | `@adobe/aio-lib-db` (MongoDB-compatible document store) |
| Caching | `@adobe/aio-lib-state` (KV store with TTL) |
| File Storage | `@adobe/aio-lib-files` (blob storage) |
| Frontend | React 16 + Adobe React Spectrum + React Router 6 |
| Auth | Adobe IMS (JWT) + custom partner keys |
| Events | Adobe I/O Events (CloudEvents) |
| API Gateway | Adobe API Mesh (GraphQL → REST) |

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Admin UI (React SPA)                       │
│  Dashboard │ Masters │ Records │ Schema │ Query │ Audit │ Admin  │
└───────────────────────────────────┬─────────────────────────────┘
                                    │ HTTPS (IMS Token)
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Adobe I/O Runtime Actions                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │record-   │ │query-    │ │bulk-     │ │ user-management  │   │
│  │crud      │ │data      │ │update    │ │ partner-mgmt     │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │file-     │ │schema-   │ │dashboard │ │ infra-metrics    │   │
│  │upload    │ │update    │ │          │ │ app-settings     │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                      Shared: mdm-utils.js                        │
│  DB Client │ RBAC │ Audit │ Caching │ Guardrails │ Events       │
└──────────┬─────────────┬────────────────┬───────────────────────┘
           │             │                │
           ▼             ▼                ▼
    ┌────────────┐ ┌──────────┐   ┌─────────────┐
    │ aio-lib-db │ │aio-state │   │aio-lib-files│
    │ (MongoDB)  │ │(KV Cache)│   │(Blob Store) │
    └────────────┘ └──────────┘   └─────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    Adobe API Mesh (Public)                        │
│              GraphQL Gateway → mdm-data, mdm-facets              │
└───────────────────────────────────┬─────────────────────────────┘
                                    │
                                    ▼
                        External Partners / CDN
```

---

## Core Infrastructure

> Shared utilities, database connectivity, RBAC, and foundational modules.

# Feature: Core Utilities

> Shared utility functions providing standardized request validation, error handling, and response formatting across all DataHub actions.

## Overview

The Core Utilities module (`actions/utils.js`) provides foundational helper functions that every action in the DataHub platform depends on. It establishes consistent patterns for parameter validation, authentication token extraction, error response formatting, and secure logging.

This module is intentionally dependency-free (pure JavaScript) to minimize cold-start times and ensure reliability. Every serverless action imports these utilities as the first step in its execution pipeline.

## Technical Specification

### Module Location
| Property | Value |
|----------|-------|
| **File** | `actions/utils.js` |
| **Type** | CommonJS module |
| **Dependencies** | None (pure utility) |
| **Consumers** | All action `index.js` files |

### Exported Functions

| Function | Signature | Purpose |
|----------|-----------|---------|
| `stringParameters` | `(params) → string` | Sanitizes parameters for safe logging |
| `getMissingKeys` | `(obj, required) → string[]` | Validates presence of required keys |
| `checkMissingRequestInputs` | `(params, requiredParams, requiredHeaders) → string|null` | Full request validation |
| `getBearerToken` | `(params) → string` | Extracts Bearer token from headers |
| `errorResponse` | `(statusCode, message, logger) → object` | Creates standardized error response |

## Code Walkthrough

### `stringParameters(params)`

Converts action parameters to a loggable string while redacting sensitive values.

**Redacted fields:**
- `client_secret` — replaced with `<hidden>`
- `authorization` — replaced with `<hidden>`

```javascript
// Usage in any action:
logger.info(stringParameters(params))
// Output: "param1: value1, authorization: <hidden>, ..."
```

**Security Note:** This function prevents accidental token/secret leakage in logs. All actions MUST use this instead of `JSON.stringify(params)` for logging.

### `getMissingKeys(obj, required)`

Validates that an object contains all required keys. Supports **dot-notation** for nested key validation.

```javascript
// Flat keys
getMissingKeys({ name: 'test' }, ['name', 'email'])
// Returns: ['email']

// Nested keys (dot notation)
getMissingKeys({ __ow_headers: { authorization: 'Bearer ...' } }, ['__ow_headers.authorization'])
// Returns: [] (key exists)
```

**Implementation:** Splits dot-notation keys and traverses the object tree. Returns the full dot-path for any missing key.

### `checkMissingRequestInputs(params, requiredParams, requiredHeaders)`

High-level request validation combining parameter and header checks.

```javascript
const errorMessage = checkMissingRequestInputs(params, ['master', 'operation'], ['authorization'])
if (errorMessage) {
  return errorResponse(400, errorMessage, logger)
}
```

**Behavior:**
1. Checks `requiredParams` against top-level `params` keys
2. Checks `requiredHeaders` against `params.__ow_headers` (lowercased)
3. Returns formatted error string: `"missing parameter(s) 'master,operation' and missing header(s) 'authorization'"`
4. Returns `null` if all validations pass

### `getBearerToken(params)`

Extracts the raw JWT/access token from the Authorization header.

```javascript
const token = getBearerToken(params)
// From header "Bearer eyJhbG..." → returns "eyJhbG..."
```

**Implementation:** Reads `params.__ow_headers.authorization`, strips the `"Bearer "` prefix.

### `errorResponse(statusCode, message, logger)`

Creates the standard error response object used across all actions.

```javascript
return errorResponse(500, 'Database connection failed', logger)
// Returns:
// {
//   error: {
//     statusCode: 500,
//     body: { error: 'Database connection failed' }
//   }
// }
```

**Behavior:** Logs the error message at `info` level (for audit trail), then returns the structured error object that Adobe I/O Runtime translates into an HTTP response.

## Architecture & Data Flow

```
┌─────────────────────────────────────────────────────┐
│                   Action Entry Point                  │
│                     main(params)                      │
├─────────────────────────────────────────────────────┤
│  1. stringParameters(params)     → Safe logging      │
│  2. checkMissingRequestInputs()  → Validate request  │
│  3. getBearerToken(params)       → Extract auth      │
│  4. ... business logic ...                           │
│  5. errorResponse(code, msg)     → On failure        │
└─────────────────────────────────────────────────────┘
```

## Security Considerations

- **Token Redaction**: `stringParameters` ensures tokens never appear in logs
- **Header Case Normalization**: All header checks use lowercased keys (HTTP headers are case-insensitive)
- **No Token Validation**: This module only extracts tokens; validation is handled by `mdm-utils.js`

## Related Features

- [MDM Utilities](./mdm-utils.md) — Extended utilities for database, auth, and RBAC
- All action features depend on this module

---
*Last updated: 2025-05-08*
*Source: `actions/utils.js`*


---

# Feature: MDM Utilities & Shared Infrastructure

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
- [Record CRUD](./record-crud.md) — Uses RBAC, audit, guardrails
- [User Management](./user-management.md) — Manages the RBAC data this module enforces
- [App Settings](./app-settings.md) — Configures guardrails and limits

---
*Last updated: 2025-05-08*
*Source: `actions/mdm-utils.js`*


---

## Data Management

> Master data lifecycle — creation, querying, mutations, schema, and visibility.

# Feature: Record CRUD

> Individual record Create, Read, Update, Patch, and Delete operations on master data collections with full audit trail and schema validation.

## Overview

The Record CRUD action provides granular single-record operations for managing data within master collections. It is the primary interface for the Record Manager UI and supports four operations: **create**, **update** (full replace), **patch** (partial merge), and **delete** (soft-delete).

Every mutation operation validates against the master's schema, enforces storage guardrails, injects audit metadata (timestamps, actor), maintains record counts, and publishes mutation events for downstream consumers.

This action enforces both **application-level RBAC** (feature permission: `record_management`) and **data-level RBAC** (master-specific access restrictions based on partner/user allowedMasters).

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `record-crud` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `record_management` |
| **HTTP Methods** | POST, OPTIONS |
| **Max Payload** | Runtime default (5MB) |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` | string | Yes | Target master collection name |
| `operation` | string | Yes | One of: `create`, `update`, `patch`, `delete` |
| `id` | string | Conditional | Record primary key value (required for update/patch/delete) |
| `data` | object/string | Conditional | Record data (required for create/update/patch). Accepts JSON object or JSON string |

### Response Structure

**Success (Create):**
```json
{
  "status": "success",
  "operation": "create",
  "master": "products",
  "record": {
    "product_id": "PROD-00001",
    "name": "Widget A",
    "price": 29.99,
    "_createdAt": "2025-05-08T10:30:00+05:30",
    "_createdBy": "user@company.com",
    "_updatedAt": "2025-05-08T10:30:00+05:30",
    "_updatedBy": "user@company.com"
  }
}
```

**Success (Update/Patch):**
```json
{
  "status": "success",
  "operation": "update",
  "master": "products",
  "record": { "...updated fields..." },
  "previousValues": { "...changed fields only..." }
}
```

**Success (Delete):**
```json
{
  "status": "success",
  "operation": "delete",
  "master": "products",
  "id": "PROD-00001",
  "message": "Record soft-deleted successfully"
}
```

### Error Codes

| Code | Condition | Response |
|------|-----------|----------|
| 400 | Missing required params (`master`, `operation`) | `{ error: "Missing required parameter: master" }` |
| 400 | Invalid operation value | `{ error: "Invalid operation. Must be: create, update, patch, delete" }` |
| 400 | Missing `id` for update/patch/delete | `{ error: "Record ID required for update operation" }` |
| 400 | Missing `data` for create/update/patch | `{ error: "Record data required for create operation" }` |
| 403 | User lacks `record_management` permission | `{ error: "Access denied" }` |
| 404 | Master not found in metadata | `{ error: "Master 'xyz' not found" }` |
| 404 | Record not found (update/patch/delete) | `{ error: "Record not found with id: PROD-001" }` |
| 409 | Duplicate primary key on create | `{ error: "Record with id 'PROD-001' already exists" }` |
| 422 | Schema validation failure | `{ error: "Validation failed: field 'price' must be number" }` |
| 507 | Storage guardrail exceeded | `{ error: "Storage limit exceeded. Current: 480MB / 500MB" }` |

## Architecture & Data Flow

### Create Operation Flow

```
Client Request (POST)
    │
    ▼
┌─────────────────────────┐
│ 1. CORS Preflight Check │ → OPTIONS returns empty 200
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 2. Parse Request Body   │ → Handle base64, string, object
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 3. Validate IMS Token   │ → 401 if invalid
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 4. Enforce RBAC         │ → 403 if no permission
│    (record_management)  │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 5. Fetch Master Metadata│ → 404 if not found
│    (schema, config)     │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 6. Validate Against     │ → 422 if schema violation
│    Schema (types, req)  │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 7. Check Storage        │ → 507 if limit exceeded
│    Guardrails           │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 8. Generate PK (if auto)│ → getNextSequenceId()
│    Check Duplicates     │ → 409 if exists
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 9. Inject Audit Fields  │ → _createdAt, _createdBy
│    Insert Document      │    _updatedAt, _updatedBy
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 10. Update Metadata     │ → Increment recordCount
│     (recordCount++)     │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 11. Create Audit Log    │ → Immutable audit entry
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 12. Publish Mutation    │ → CloudEvent to I/O Events
│     Event (async)       │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 13. Return Response     │ → 201 + created record
└─────────────────────────┘
```

### Database Operations

| Operation | Collection | Method | Purpose |
|-----------|-----------|--------|---------|
| Read metadata | `metadata` | `safeFindOne` | Fetch schema & config |
| Check duplicate | `mdm_<master>` | `safeFindOne` | PK uniqueness (create) |
| Insert record | `mdm_<master>` | `insertOne` | Create operation |
| Replace record | `mdm_<master>` | `updateOne` (full) | Update operation |
| Merge record | `mdm_<master>` | `updateOne` ($set) | Patch operation |
| Soft-delete | `mdm_<master>` | `updateOne` | Set `_deleted: true` |
| Update count | `metadata` | `updateOne` | Adjust recordCount |
| Audit log | `audit` | `insertOne` | Audit trail |
| Get sequence | `counters` | `findOneAndUpdate` | Auto-PK generation |

### Dependencies

| Module | Purpose |
|--------|---------|
| `../mdm-utils` | DB client, RBAC, audit, guardrails, event publishing |
| `../utils` | Error response formatting |

## Code Walkthrough

### Core Logic (Simplified)

```javascript
async function main(params) {
  // 1. CORS preflight
  if (params.__ow_method === 'options') return createResponse({})
  
  // 2. Parse body (handles base64, string, object)
  const body = parseRequestBody(params)
  const { master, operation, id, data } = body
  
  // 3. Validate IMS token
  await validateIMSToken(params)
  
  // 4. Connect to DB
  const client = await getDbClient(params)
  
  try {
    // 5. RBAC check
    await enforceAppPermission(client, params, 'record-crud')
    
    // 6. Route to operation handler
    switch (operation) {
      case 'create': return await handleCreate(client, params, master, data)
      case 'update': return await handleUpdate(client, params, master, id, data)
      case 'patch':  return await handlePatch(client, params, master, id, data)
      case 'delete': return await handleDelete(client, params, master, id)
    }
  } finally {
    await client.close()
  }
}
```

### Key Functions

**`handleCreate(client, params, master, data)`**
1. Fetches master metadata and schema
2. Validates `data` against schema (types, required fields)
3. Checks storage guardrails
4. If master has auto-PK: generates sequential ID via `getNextSequenceId()`
5. Checks for duplicate PK
6. Injects `_createdAt`, `_createdBy`, `_updatedAt`, `_updatedBy`
7. Inserts document
8. Increments metadata `recordCount`
9. Creates audit log
10. Publishes mutation event

**`handleUpdate(client, params, master, id, data)`**
1. Fetches existing record (404 if not found)
2. Validates new data against schema
3. Preserves `_createdAt`, `_createdBy` from original
4. Updates `_updatedAt`, `_updatedBy`
5. Full document replacement (except system fields)
6. Creates audit log with `previousValues` diff

**`handlePatch(client, params, master, id, data)`**
1. Fetches existing record
2. Validates only the provided fields against schema
3. Uses `$set` operator for partial update
4. Updates `_updatedAt`, `_updatedBy`
5. Creates audit log

**`handleDelete(client, params, master, id)`**
1. Fetches existing record
2. Sets `_deleted: true`, `_deletedAt`, `_deletedBy`
3. Decrements metadata `recordCount`
4. Creates audit log

## Security Considerations

- **Double RBAC**: App-level (`record_management` feature) + data-level (master access)
- **Schema Validation**: All input data validated against stored schema before persistence
- **Injection Prevention**: Primary keys are validated; no raw user input in query operators
- **Soft Delete**: Records are never physically removed (audit trail preservation)
- **Audit Trail**: Every mutation creates an immutable audit log entry
- **Auto-PK**: Sequential IDs use atomic `findOneAndUpdate` (no race conditions)

## Configuration

| Setting | Source | Default | Impact |
|---------|--------|---------|--------|
| Storage limit | `MDM_MAX_STORAGE_MB` | 500 | Create blocked at limit |
| Max schema fields | `MAX_SCHEMA_FIELDS` | 100 | Field count validation |
| Record audit | Per-master `recordAudit` | true | Controls `_createdAt` etc. |
| CRUD enabled | Per-master `crudEnabled` | true | Master-level toggle |
| Allowed operations | Per-master `allowedOperations` | all | Restrict to specific ops |

## Related Features

- [Bulk Update](./bulk-update.md) — Batch version of record operations
- [Query Data](./query-data.md) — Reading records with pagination
- [Schema Update](./schema-update.md) — Modifying the schema records validate against
- [Full Update](./full-update.md) — Complete dataset replacement
- [MDM Data (Public API)](./mdm-data.md) — External CRUD via partner credentials

---
*Last updated: 2025-05-08*
*Source: `actions/record-crud/index.js`*


---

# Feature: Query Data

> Real-time database query engine for the Admin UI providing paginated record browsing with filtering, sorting, field projection, and single-record lookups.

## Overview

The Query Data action serves as the primary read interface for the Admin UI's record browsing capabilities. Unlike the public API (`mdm-data`) which includes caching and partner authentication, this action provides **real-time, uncached** access directly from the database — essential for admin workflows where data freshness is critical.

It supports paginated listing with database-level filtering (regex-based case-insensitive search), multi-field sorting, field projection (selecting specific columns), and single-record fetch by ID.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `query-data` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `masters` OR `query_console` OR `record_management` |
| **HTTP Methods** | GET, POST, OPTIONS |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` | string | Yes | Target master collection name |
| `id` | string | No | Fetch single record by primary key |
| `page` | number | No | Page number (default: 1) |
| `pageSize` | number | No | Records per page (default: from settings, max: from settings) |
| `sort` | string | No | Field name to sort by |
| `order` | string | No | Sort direction: `asc` or `desc` (default: `desc`) |
| `fields` | string | No | Comma-separated field names to return (projection) |
| `filter` | string | No | Simple filter: `fieldName=value` |
| `filters` | string/object | No | Complex filters: JSON object `{ field: value, ... }` |
| `includeMeta` | boolean | No | Include master metadata in response |

### Response Structure

**Paginated List:**
```json
{
  "master": "products",
  "count": 25,
  "page": 1,
  "pageSize": 25,
  "total": 1250,
  "data": [
    {
      "product_id": "PROD-00001",
      "name": "Widget A",
      "price": 29.99,
      "_createdAt": "2025-05-08T10:30:00+05:30"
    }
  ],
  "file": { "...master metadata if includeMeta=true..." }
}
```

**Single Record:**
```json
{
  "master": "products",
  "record": {
    "product_id": "PROD-00001",
    "name": "Widget A",
    "price": 29.99,
    "category": "Hardware",
    "_createdAt": "2025-05-08T10:30:00+05:30",
    "_updatedAt": "2025-05-08T10:30:00+05:30"
  }
}
```

### Error Codes

| Code | Condition | Response |
|------|-----------|----------|
| 400 | Missing `master` parameter | `{ error: "Missing required parameter: master" }` |
| 403 | User lacks required permission | `{ error: "Access denied" }` |
| 404 | Master not found | `{ error: "Master 'xyz' not found" }` |
| 404 | Record not found (single fetch) | `{ error: "Record not found" }` |

## Architecture & Data Flow

### Query Execution Pipeline

```
Request Parameters
    │
    ▼
┌──────────────────────────┐
│ Parse & Normalize Params │
│ • page/pageSize defaults │
│ • Parse filters JSON     │
│ • Validate sort field    │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│ Build MongoDB Query      │
│ • Exclude system params  │
│ • Build $regex filters   │
│ • Case-insensitive match │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│ Execute in Parallel:     │
│ • countDocuments(filter) │
│ • find().sort().skip()   │
│   .limit()               │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│ Post-Process Results     │
│ • Apply field projection │
│ • Strip system fields    │
│ • Build pagination meta  │
└──────────────────────────┘
```

### Filter Mechanics

Filters are converted to **case-insensitive regex queries** at the database level:

```javascript
// Input: filters = { name: "widget", category: "hardware" }
// Becomes MongoDB query:
{
  name: { $regex: 'widget', $options: 'i' },
  category: { $regex: 'hardware', $options: 'i' },
  _deleted: { $ne: true }  // Always exclude soft-deleted
}
```

**System parameters excluded from filters:** `master`, `page`, `pageSize`, `sort`, `order`, `fields`, `filter`, `filters`, `includeMeta`, `id`, `__ow_method`, `__ow_headers`, `__ow_path`

### Database Operations

| Operation | Purpose | Complexity |
|-----------|---------|------------|
| `countDocuments(filter)` | Total matching records (for pagination) | O(n) with filter |
| `find(filter).sort(sortObj).skip(offset).limit(pageSize)` | Paginated results | Uses indexes |
| `safeFindOne({ [pkField]: id })` | Single record by PK | O(1) with index |

### Dependencies

| Module | Purpose |
|--------|---------|
| `../mdm-utils` | DB client, RBAC, settings, collection helpers |

## Code Walkthrough

### Core Logic

```javascript
async function main(params) {
  if (params.__ow_method === 'options') return createResponse({})
  
  const client = await getDbClient(params)
  try {
    await enforceAppPermission(client, params, 'query-data')
    
    const { master, id, page = 1, pageSize, sort, order, fields, filters } = params
    const settings = await getCachedSettings(client, params)
    const effectivePageSize = Math.min(pageSize || settings.defaultPageSize, settings.maxPageSize)
    
    // Single record fetch
    if (id) {
      const record = await safeFindOne(masterCol, { [pkField]: id })
      if (!record) return createErrorResponse('Record not found', 404)
      return createResponse({ master, record })
    }
    
    // Build query (excluding system params, adding regex)
    const query = buildFilterQuery(params, filters)
    query._deleted = { $ne: true }
    
    // Execute paginated query
    const [total, data] = await Promise.all([
      masterCol.countDocuments(query),
      masterCol.find(query)
        .sort({ [sort || '_updatedAt']: order === 'asc' ? 1 : -1 })
        .skip((page - 1) * effectivePageSize)
        .limit(effectivePageSize)
    ])
    
    // Apply field projection in JS (if specified)
    const projected = fields ? projectFields(data, fields.split(',')) : data
    
    return createResponse({ master, count: projected.length, page, pageSize: effectivePageSize, total, data: projected })
  } finally {
    await client.close()
  }
}
```

### Key Functions

**`buildFilterQuery(params, filters)`** — Constructs MongoDB query from user-provided filters, escaping regex special characters and wrapping values in case-insensitive regex patterns.

**`projectFields(records, fieldNames)`** — Client-side field selection that returns only specified keys from each record.

## Security Considerations

- **Regex Escaping**: All filter values are escaped via `escapeRegex()` to prevent ReDoS attacks
- **Soft-Delete Awareness**: All queries automatically exclude `_deleted: true` records
- **No Direct Aggregation**: Unlike `mdm-facets`, this action doesn't expose aggregation pipeline to prevent injection
- **Page Size Limits**: Enforced maximum prevents memory exhaustion from unbounded queries
- **System Field Exclusion**: Internal fields (`__ow_*`) cannot be used as filter keys

## Configuration

| Setting | Source | Default | Impact |
|---------|--------|---------|--------|
| Default page size | `DEFAULT_PAGE_SIZE` / settings | 25 | Records per page |
| Max page size | `MAX_PAGE_SIZE` / settings | 500 | Upper limit per request |
| Query timeout | `QUERY_TIMEOUT` | 30000ms | DB operation timeout |

## Related Features

- [Record CRUD](./record-crud.md) — Write operations on the same data
- [MDM Data (Public API)](./mdm-data.md) — External read API with caching
- [MDM Facets](./mdm-facets.md) — Aggregation queries for faceted search
- [File Detail](./file-detail.md) — Master metadata (schema, config)

---
*Last updated: 2025-05-08*
*Source: `actions/query-data/index.js`*


---

# Feature: Bulk Update

> High-performance batch record operations (upsert, replace, patch, delete) from CSV or JSON payload with dry-run preview and per-record error reporting.

## Overview

The Bulk Update action enables batch data modifications on master collections. It accepts either a **CSV payload** or **JSON array of records** and applies the specified operation type across all records in a single optimized `bulkWrite` call.

Key differentiators from single-record CRUD:
- **Batch optimization**: Uses MongoDB `bulkWrite` for atomic batch processing
- **Dry-run mode**: Preview what changes would occur without persisting
- **Per-record error tracking**: Individual record failures don't abort the batch
- **Configurable batch sizes**: Large datasets are split into manageable chunks

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `bulk-update` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `import_data` OR `record_management` |
| **HTTP Methods** | POST, OPTIONS |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` | string | Yes | Target master collection |
| `records` | array | Conditional | Array of record objects (if not using CSV) |
| `csvContent` | string | Conditional | CSV content (alternative to `records`) |
| `operationType` | string | Yes | `upsert`, `replace`, `patch`, or `delete` |
| `dryRun` | boolean | No | Preview mode — no DB writes (default: false) |

### Response Structure

**Execution Result:**
```json
{
  "master": "products",
  "operation": "upsert",
  "inserted": 45,
  "updated": 130,
  "deleted": 0,
  "failed": 3,
  "errors": [
    { "row": 12, "id": "PROD-012", "error": "Schema validation: price must be number" },
    { "row": 56, "id": "PROD-056", "error": "Record not found for update" }
  ],
  "status": "partial_success"
}
```

**Dry-Run Preview:**
```json
{
  "master": "products",
  "operation": "upsert",
  "dryRun": true,
  "toInsert": 45,
  "toUpdate": 130,
  "toDelete": 0,
  "errors": [
    { "row": 12, "id": "PROD-012", "error": "Schema validation: price must be number" }
  ],
  "totalRecords": 178,
  "validRecords": 175
}
```

### Error Codes

| Code | Condition | Response |
|------|-----------|----------|
| 400 | Missing `master` or `operationType` | `{ error: "Missing required parameter" }` |
| 400 | Neither `records` nor `csvContent` provided | `{ error: "Provide records array or csvContent" }` |
| 400 | Invalid `operationType` | `{ error: "Invalid operation type" }` |
| 403 | Insufficient permissions | `{ error: "Access denied" }` |
| 404 | Master not found | `{ error: "Master not found" }` |
| 507 | Storage guardrail exceeded | `{ error: "Storage limit exceeded" }` |

## Architecture & Data Flow

### Execution Pipeline

```
Input (CSV or JSON Array)
    │
    ▼
┌─────────────────────────────┐
│ 1. Parse Input              │
│    • Parse CSV → objects    │
│    • Validate JSON array    │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 2. Batch-Fetch Existing     │
│    Records (primaryKey $in) │ ← Avoids N+1 queries
│    Build lookup map         │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 3. Per-Record Processing    │
│    • Schema validation      │
│    • Determine op (insert   │
│      vs update) for upsert  │
│    • Collect errors         │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 4. Dry Run? ─── Yes ──────▶│ Return preview stats
│         │                   │
│         No                  │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 5. Execute bulkWrite        │
│    (in configurable batches)│
│    • insertOne ops          │
│    • updateOne ops          │
│    • deleteOne ops          │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 6. Update Metadata          │
│    (recordCount via         │
│     countDocuments)         │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 7. Create Audit Log         │
└─────────────────────────────┘
```

### Operation Types Explained

| Type | Behavior |
|------|----------|
| `upsert` | Insert if PK doesn't exist; update if it does |
| `replace` | Full document replacement (record must exist) |
| `patch` | Merge provided fields into existing record |
| `delete` | Soft-delete records by PK |

### Database Operations

| Step | Operation | Purpose |
|------|-----------|---------|
| Batch fetch | `find({ [pk]: { $in: [...ids] } })` | Load existing records for comparison |
| Write | `bulkWrite(operations, { ordered: false })` | Atomic batch execution (unordered for max throughput) |
| Count | `countDocuments({})` | Accurate record count post-operation |
| Metadata | `metaCol.updateOne(...)` | Update recordCount |
| Audit | `audit.insertOne(...)` | Operation audit trail |

## Code Walkthrough

### Core Logic

```javascript
async function main(params) {
  const client = await getDbClient(params)
  try {
    await enforceAppPermission(client, params, 'bulk-update')
    
    // Parse input
    let records = params.records
    if (params.csvContent) {
      const csv = decompressCsvContent(params.csvContent)
      records = parseCSV(csv)
    }
    
    // Fetch master metadata + schema
    const meta = await safeFindOne(metaCol, { masterName: master })
    const pkField = meta.primaryKey
    
    // Batch-fetch all existing records
    const ids = records.map(r => r[pkField]).filter(Boolean)
    const existing = await masterCol.find({ [pkField]: { $in: ids } }).toArray()
    const existingMap = new Map(existing.map(r => [r[pkField], r]))
    
    // Process each record
    const operations = []
    const errors = []
    
    for (const [index, record] of records.entries()) {
      try {
        const exists = existingMap.has(record[pkField])
        const op = buildOperation(operationType, record, exists, meta.schema, pkField)
        if (op) operations.push(op)
      } catch (e) {
        errors.push({ row: index + 1, id: record[pkField], error: e.message })
      }
    }
    
    // Dry run — return preview
    if (dryRun) return createResponse({ dryRun: true, toInsert, toUpdate, toDelete, errors })
    
    // Execute in batches
    const batchSize = getEnvConfig(params).bulkBatchSize || 1000
    for (let i = 0; i < operations.length; i += batchSize) {
      await masterCol.bulkWrite(operations.slice(i, i + batchSize), { ordered: false })
    }
    
    // Update metadata
    const newCount = await masterCol.countDocuments({ _deleted: { $ne: true } })
    await metaCol.updateOne({ masterName: master }, { $set: { recordCount: newCount } })
    
    await createAuditLog(client, { masterName: master, operation: 'bulk-update', ... })
    
    return createResponse({ master, operation: operationType, inserted, updated, deleted, failed: errors.length, errors })
  } finally {
    await client.close()
  }
}
```

## Security Considerations

- **Storage Guardrails**: Net-new documents (inserts) checked against storage limits before execution
- **Schema Validation**: Every record validated against master schema before inclusion in bulkWrite
- **Batch Size Limits**: Configurable batch size prevents memory exhaustion
- **Unordered Write**: `{ ordered: false }` ensures maximum throughput; individual failures don't block others
- **Data-Level RBAC**: Validates user has access to the specific master being modified

## Configuration

| Setting | Source | Default | Impact |
|---------|--------|---------|--------|
| Batch size | `BULK_BATCH_SIZE` | 1000 | Records per bulkWrite call |
| Max storage | `MDM_MAX_STORAGE_MB` | 500 | Insert blocking threshold |
| Max page size | `MAX_PAGE_SIZE` | 500 | Limits preview data |

## Related Features

- [Record CRUD](./record-crud.md) — Single-record operations
- [Full Update](./full-update.md) — Complete dataset replacement
- [Delta Update](./delta-update.md) — Incremental updates with multiple modes
- [File Upload](./file-upload.md) — Initial master creation from CSV

---
*Last updated: 2025-05-08*
*Source: `actions/bulk-update/index.js`*


---

# Feature: Schema Update

> Add, update, remove, rename schema fields; replace entire schemas; and manage facet configurations with automatic data migration.

## Overview

The Schema Update action manages the structural definition of master data collections. Schema changes are critical operations that affect how data is validated, stored, and queried. This action supports incremental field modifications (add/update/remove/rename) as well as full schema replacement, with automatic data migration where applicable.

Every schema change bumps the `schemaVersionId` to track schema evolution and creates an audit trail.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `schema-update` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `schema_management` |
| **HTTP Methods** | POST, OPTIONS |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` | string | Yes | Target master collection |
| `operation` | string | Yes | `add`, `update`, `remove`, `rename`, `replace`, `update-facets` |
| `field` | object | Conditional | Field definition for add/update/remove/rename |
| `field.name` | string | Yes (for field ops) | Field name |
| `field.type` | string | For add | Data type: `string`, `number`, `boolean`, `date`, `array`, `object` |
| `field.required` | boolean | No | Whether field is required |
| `field.defaultValue` | any | No | Default value for existing records (add operation) |
| `field.newName` | string | For rename | Target field name |
| `fields` | array | For replace | Complete new schema definition |

### Response Structure

```json
{
  "status": "success",
  "master": "products",
  "schemaVersion": 5,
  "field": {
    "name": "category",
    "type": "string",
    "required": false
  },
  "message": "Field 'category' added successfully. 1250 records migrated with default value."
}
```

### Error Codes

| Code | Condition | Response |
|------|-----------|----------|
| 400 | Missing parameters | `{ error: "Missing required parameter" }` |
| 400 | Invalid operation | `{ error: "Invalid operation" }` |
| 400 | Cannot change PK type | `{ error: "Cannot change type of primary key field" }` |
| 400 | Cannot remove PK | `{ error: "Cannot remove primary key field" }` |
| 400 | Max fields exceeded | `{ error: "Maximum fields limit (100) reached" }` |
| 403 | Insufficient permissions | `{ error: "Access denied" }` |
| 404 | Master not found | `{ error: "Master not found" }` |
| 409 | Field already exists (add) | `{ error: "Field 'category' already exists" }` |
| 409 | Field not found (update/remove) | `{ error: "Field 'category' not found in schema" }` |

## Architecture & Data Flow

### Operation: Add Field

```
1. Validate max fields limit not exceeded
2. Check field name doesn't already exist
3. Insert field definition into schema array
4. If defaultValue provided:
   → updateMany({}, { $set: { [fieldName]: defaultValue } })
   → Migrate ALL existing records with default
5. Bump schemaVersionId
6. Update metadata document
7. Create audit log
```

### Operation: Rename Field

```
1. Validate source field exists
2. Validate target name doesn't exist
3. Atomic rename on ALL records:
   → updateMany({}, { $rename: { [oldName]: [newName] } })
4. Update schema definition (change name property)
5. Bump schemaVersionId
6. Create audit log
```

### Operation: Replace Schema

```
1. Validate new schema array
2. Ensure primary key field is preserved
3. Replace entire schema definition
4. Bump schemaVersionId
5. NOTE: Does NOT migrate existing data (records may have stale fields)
6. Create audit log
```

### Database Operations

| Operation | Method | Records Affected |
|-----------|--------|-----------------|
| Add (with default) | `masterCol.updateMany({}, { $set: {...} })` | All records |
| Rename | `masterCol.updateMany({}, { $rename: {...} })` | All records |
| Remove | `metaCol.updateOne(...)` | Schema only |
| Replace | `metaCol.updateOne(...)` | Schema only |
| Update facets | `metaCol.updateOne(...)` | Config only |

## Security Considerations

- **Primary Key Protection**: Cannot change PK type or remove PK field
- **Field Limit**: `MAX_SCHEMA_FIELDS` prevents unbounded schema growth
- **Atomic Rename**: Uses MongoDB `$rename` for consistency (no partial state)
- **Version Tracking**: `schemaVersionId` enables change detection

## Configuration

| Setting | Source | Default | Impact |
|---------|--------|---------|--------|
| Max fields | `MAX_SCHEMA_FIELDS` | 100 | Add operation blocked |

## Related Features

- [File Upload](./file-upload.md) — Initial schema creation
- [Record CRUD](./record-crud.md) — Validates data against schema
- [Bulk Update](./bulk-update.md) — Validates data against schema

---
*Last updated: 2025-05-08*
*Source: `actions/schema-update/index.js`*


---

# Feature: File Upload (Master Creation)

> Creates a new master data collection from CSV upload with automatic schema inference, index creation, primary key generation, and full initialization.

## Overview

The File Upload action is the **genesis operation** for any master data collection. It accepts a CSV file (optionally gzip-compressed), infers or validates schema, creates the metadata document, creates the per-master database collection, inserts all records, and builds indexes for optimal query performance.

This is a one-time operation per master — attempting to create a master that already exists returns a 409 Conflict.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `file-upload` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `import_data` |
| **HTTP Methods** | POST, OPTIONS |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `masterName` | string | Yes | Collection name (lowercase alphanumeric + underscores) |
| `csvContent` | string | Yes | CSV data (supports gzip base64) |
| `primaryKey` | string | No | PK field name (default: auto-generates `master_id`) |
| `displayName` | string | No | Human-readable name |
| `visibility` | string | No | `public` or `private` (default: `private`) |
| `crudEnabled` | boolean | No | Enable record-level CRUD (default: true) |
| `allowedOperations` | array | No | Restrict to specific operations |
| `queryableFields` | array | No | Fields to index for querying |
| `requiredFields` | array | No | Fields that must be non-empty |
| `facetableFields` | array | No | Fields for faceted search |
| `facetsConfig` | object | No | Facet display configuration |
| `archivalConfig` | object | No | Data archival rules |
| `schema` | array | No | Explicit schema (overrides inference) |
| `description` | string | No | Master description |
| `recordAudit` | boolean | No | Enable per-record audit fields (default: true) |

### Response Structure

```json
{
  "status": "success",
  "master": "products",
  "displayName": "Products Catalog",
  "recordCount": 1250,
  "primaryKey": "product_id",
  "schema": [
    { "name": "product_id", "type": "string", "required": true, "isPrimaryKey": true },
    { "name": "name", "type": "string", "required": false },
    { "name": "price", "type": "number", "required": false }
  ],
  "visibility": "private",
  "indexes": ["product_id (unique)", "deleted+product_id", "category", "brand"]
}
```

### Error Codes

| Code | Condition | Response |
|------|-----------|----------|
| 400 | Invalid master name format | `{ error: "Master name must be lowercase alphanumeric with underscores" }` |
| 400 | Empty CSV | `{ error: "CSV content is empty" }` |
| 403 | Insufficient permissions | `{ error: "Access denied" }` |
| 409 | Master already exists | `{ error: "Master 'products' already exists" }` |
| 422 | CSV validation errors | `{ error: "Validation errors", details: [...] }` |
| 507 | Storage limit exceeded | `{ error: "Storage limit exceeded" }` |

## Architecture & Data Flow

### Master Creation Pipeline

```
CSV Content (plain or gzip)
    │
    ▼
┌────────────────────────────────────┐
│ 1. Decompress (if gzip)           │
│    Detect base64 → decode → gunzip│
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│ 2. Validate Master Name           │
│    /^[a-z][a-z0-9_]{1,49}$/       │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│ 3. Check Master Doesn't Exist     │
│    → 409 if found in metadata     │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│ 4. Parse CSV → Array of Objects   │
│    Header row → field names       │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│ 5. Schema: Infer or Validate      │
│    • Auto-detect types from data  │
│    • Or validate against provided │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│ 6. Auto-Generate PK (if no PK)    │
│    • Reserve batch of IDs         │
│    • getNextSequenceId(master, N)  │
│    • Assign sequential IDs        │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│ 7. Validate CSV Against Schema    │
│    • Type checking per field      │
│    • Required field presence      │
│    • Return all errors at once    │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│ 8. Check Storage Guardrails       │
│    • Estimate size (MB)           │
│    • Check doc count limits       │
│    • Check collection count       │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│ 9. Create Metadata Document       │
│    • masterName, displayName      │
│    • schema, primaryKey           │
│    • visibility, config options   │
│    • recordCount, createdAt/By    │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│ 10. Create Collection & Insert    │
│     • client.collection(mdm_name) │
│     • insertMany(records)         │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│ 11. Create Indexes                │
│     • PK unique index             │
│     • Compound: _deleted + PK     │
│     • Queryable field indexes     │
│     • Facetable field indexes     │
└──────────────┬─────────────────────┘
               │
               ▼
┌────────────────────────────────────┐
│ 12. Create Audit Log              │
└────────────────────────────────────┘
```

### Index Strategy

| Index | Fields | Type | Purpose |
|-------|--------|------|---------|
| Primary | `{ [pkField]: 1 }` | Unique | PK lookups, duplicate prevention |
| Soft-delete | `{ _deleted: 1, [pkField]: 1 }` | Compound | Filtered queries (most common) |
| Queryable | `{ [field]: 1 }` each | Single | Sort/filter optimization |
| Facetable | `{ [field]: 1 }` each | Single | Aggregation performance |

## Security Considerations

- **Name Validation**: Strict regex prevents collection-name injection
- **Size Estimation**: `estimateFileSizeMB()` prevents storage exhaustion before writing
- **Atomic ID Reservation**: `getNextSequenceId(master, count)` reserves IDs atomically
- **Duplicate Prevention**: Unique index on PK field enforced at DB level
- **Gzip Support**: Enables large file uploads within runtime payload limits

## Related Features

- [File List](./file-list.md) — Lists created masters
- [File Detail](./file-detail.md) — View master metadata
- [File Delete](./file-delete.md) — Remove a master
- [Schema Update](./schema-update.md) — Modify schema post-creation
- [Full Update](./full-update.md) — Replace all data in existing master

---
*Last updated: 2025-05-08*
*Source: `actions/file-upload/index.js`*


---

# Feature: Full Update

> Complete dataset replacement — inserts new data first (for atomicity), then removes old records, ensuring zero-downtime data refresh.

## Overview

The Full Update action replaces the entire dataset for a master collection. It implements an **insert-then-delete** strategy to ensure that the collection is never empty during the operation (zero-downtime refresh). New records are inserted first, then old records (those not in the new dataset) are deleted.

This operation is typically used for scheduled data feeds where the source system provides a complete snapshot.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `full-update` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `import_data` |
| **HTTP Methods** | POST, OPTIONS |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` | string | Yes | Target master collection |
| `csvContent` | string | Yes | Complete dataset as CSV (supports gzip) |

### Response Structure

```json
{
  "master": "products",
  "operation": "full-update",
  "inserted": 1300,
  "deleted": 1250,
  "netChange": 50,
  "status": "success",
  "message": "Full update completed. 1300 records inserted, 1250 old records removed."
}
```

## Architecture & Data Flow

```
CSV Content
    │
    ▼
┌─────────────────────────────┐
│ 1. Decompress & Parse CSV   │
│ 2. Validate against schema  │
│ 3. Check storage guardrails │
│    (net new = new - old)    │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 4. Inject audit fields      │
│    (_createdAt, _updatedAt) │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 5. INSERT new records first │ ← Collection has BOTH old + new briefly
│    (insertMany)             │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 6. DELETE old records       │
│    ({ [pk]: { $nin: newIds }│ ← Remove everything not in new set
│    })                       │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 7. Update metadata          │
│    (recordCount = new count)│
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 8. Create audit log         │
└─────────────────────────────┘
```

### Atomicity Strategy

The **insert-first** approach ensures:
- Collection is never empty (readers always see data)
- If insert fails, old data remains untouched
- If delete fails after insert, collection has duplicates (recoverable) rather than data loss

## Security Considerations

- **Net-Change Guardrails**: Storage check uses `newRecords - existingRecords` (net change only)
- **Schema Validation**: All new records validated before any writes
- **Data-Level RBAC**: Validates user access to specific master

## Related Features

- [Delta Update](./delta-update.md) — Incremental changes (preferred for large datasets)
- [File Upload](./file-upload.md) — Initial creation
- [Bulk Update](./bulk-update.md) — Selective batch operations

---
*Last updated: 2025-05-08*
*Source: `actions/full-update/index.js`*


---

# Feature: Delta Update

> Incremental data changes with four modes: upsert, update-only, insert-only, and mixed-action (per-row action column).

## Overview

The Delta Update action applies incremental changes to a master collection. Unlike Full Update (which replaces everything), Delta Update intelligently processes only the changed records. It supports four modes to handle different integration scenarios.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `delta-update` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `import_data` |
| **HTTP Methods** | POST, OPTIONS |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` | string | Yes | Target master collection |
| `csvContent` | string | Yes | Delta records as CSV (supports gzip) |
| `mode` | string | No | `upsert` (default), `update-only`, `insert-only`, `mixed` |

### Modes Explained

| Mode | Behavior | Use Case |
|------|----------|----------|
| `upsert` | Insert if new, update if exists | General-purpose sync |
| `update-only` | Only update existing records; skip new | Enrichment feeds |
| `insert-only` | Only insert new records; skip existing | Append-only feeds |
| `mixed` | Per-row `_action` column: `CREATE`, `UPDATE`, `DELETE` | Changelog/CDC feeds |

### Response Structure

```json
{
  "master": "products",
  "operation": "delta-update",
  "mode": "upsert",
  "inserted": 25,
  "updated": 130,
  "deleted": 0,
  "skipped": 3,
  "errors": [],
  "status": "success"
}
```

## Architecture & Data Flow

```
CSV Content + Mode
    │
    ▼
┌─────────────────────────────┐
│ 1. Parse CSV                │
│ 2. Extract all PKs          │
│ 3. Batch-fetch existing:    │
│    find({ pk: { $in: [] }}) │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 4. For each row:            │
│    • Check mode rules       │
│    • Determine operation    │
│    • Build bulkWrite op     │
│    • Track skip/error       │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 5. bulkWrite(ops,           │
│    { ordered: false })      │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 6. countDocuments → update  │
│    metadata recordCount     │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 7. Audit log                │
└─────────────────────────────┘
```

### Mixed Mode — `_action` Column

In mixed mode, each CSV row MUST have an `_action` column:

| `_action` | Operation |
|-----------|-----------|
| `CREATE` | Insert (error if exists) |
| `UPDATE` | Update (error if not found) |
| `DELETE` | Soft-delete |

The `_action` column is stripped from the stored record.

## Security Considerations

- **Batch Fetch Optimization**: Single `$in` query instead of N+1 lookups
- **Unordered Write**: `{ ordered: false }` for maximum throughput
- **Partial Success**: Individual row failures don't abort the entire batch
- **Storage Guardrails**: Checked for net-new inserts only

## Related Features

- [Full Update](./full-update.md) — Complete replacement
- [Bulk Update](./bulk-update.md) — JSON-based batch operations
- [Record CRUD](./record-crud.md) — Single-record operations

---
*Last updated: 2025-05-08*
*Source: `actions/delta-update/index.js`*


---

# Feature: Visibility Update

> Toggle public/private API visibility for master data collections.

## Overview

Controls whether a master's data is accessible via the public API (`mdm-data`) without authentication. Public masters can be read by anyone; private masters require an IMS token or partner credentials.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `visibility-update` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `masters` |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` | string | Yes | Target master |
| `visibility` | string | Yes | `public` or `private` |

### Response Structure

```json
{
  "status": "success",
  "master": "products",
  "previousVisibility": "private",
  "visibility": "public",
  "message": "Visibility updated to public"
}
```

## Security Considerations

- Making a master `public` exposes ALL its records without authentication via `mdm-data`
- Audit log captures who changed visibility and when

## Related Features

- [MDM Data](./mdm-data.md) — Respects visibility setting
- [Metadata Update](./metadata-update.md) — Other master property changes
- [File Detail](./file-detail.md) — View current visibility

---
*Last updated: 2025-05-08*
*Source: `actions/visibility-update/index.js`*


---

# Feature: Metadata Update

> Update master metadata properties including display name, description, CRUD toggles, allowed operations, and governance settings.

## Overview

The Metadata Update action modifies non-structural properties of a master (everything except schema and data). It supports partial updates — only provided fields are modified.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `metadata-update` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `masters` |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` | string | Yes | Target master |
| `displayName` | string | No | Human-readable name |
| `description` | string | No | Master description |
| `crudEnabled` | boolean | No | Enable/disable record CRUD |
| `allowedOperations` | array | No | Restrict operations |
| `governance` | object | No | Governance settings (deep-merged) |

### Response Structure

```json
{
  "status": "success",
  "master": "products",
  "file": { "...full updated metadata document..." },
  "message": "Metadata updated successfully"
}
```

## Key Behavior

- `allowedOperations` auto-syncs with `crudEnabled`: if `crudEnabled: false`, operations are cleared
- `governance` object is **deep-merged** (not replaced) — allows partial governance updates
- Returns full updated metadata document for UI refresh

## Related Features

- [Visibility Update](./visibility-update.md) — Visibility-specific toggle
- [Schema Update](./schema-update.md) — Structural changes
- [File Detail](./file-detail.md) — View metadata

---
*Last updated: 2025-05-08*
*Source: `actions/metadata-update/index.js`*


---

# Feature: File Operations (List, Detail, Delete)

> Master collection lifecycle management — listing all masters, viewing detailed metadata, and soft-deleting masters.

## Overview

These three actions manage the lifecycle of master data collections at the entity level (not individual records).

## Technical Specification

### File List

| Property | Value |
|----------|-------|
| **Action Name** | `file-list` |
| **RBAC Permission** | `masters` OR `import_data` OR `record_management` OR `schema_management` OR `archive_management` |
| **Purpose** | List all non-deleted masters with summary info |

**Response:**
```json
{
  "files": [
    {
      "masterName": "products",
      "displayName": "Products Catalog",
      "recordCount": 1250,
      "visibility": "public",
      "primaryKey": "product_id",
      "updatedAt": "2025-05-08T10:30:00Z"
    }
  ],
  "total": 12
}
```

### File Detail

| Property | Value |
|----------|-------|
| **Action Name** | `file-detail` |
| **RBAC Permission** | Same as file-list |
| **Input** | `master` (name) |
| **Purpose** | Full metadata document including schema, config, stats |

**Response:**
```json
{
  "file": {
    "masterName": "products",
    "displayName": "Products Catalog",
    "primaryKey": "product_id",
    "schema": [...],
    "recordCount": 1250,
    "visibility": "public",
    "crudEnabled": true,
    "allowedOperations": ["create", "update", "patch", "delete"],
    "queryableFields": ["category", "brand"],
    "facetableFields": ["category", "brand", "status"],
    "archival": { "enabled": true, "threshold": 10000 },
    "createdAt": "...",
    "createdBy": "...",
    "updatedAt": "...",
    "updatedBy": "..."
  }
}
```

### File Delete

| Property | Value |
|----------|-------|
| **Action Name** | `file-delete` |
| **RBAC Permission** | `masters` |
| **Input** | `master` (name) |
| **Purpose** | Soft-delete master and drop data collection |

**Operations:**
1. Set metadata `status: 'deleted'`, `deletedAt`, `deletedBy`
2. Drop the `mdm_<masterName>` collection
3. Create audit log
4. Idempotent — already-deleted returns success

**Response:**
```json
{
  "status": "success",
  "master": "products",
  "message": "Master deleted successfully"
}
```

## Security Considerations

- **Soft Delete**: Metadata preserved (marked deleted) for audit trail
- **Collection Drop**: Physical data removal — irreversible
- **Idempotent**: Safe to retry

## Related Features

- [File Upload](./file-upload.md) — Creates masters
- [Metadata Update](./metadata-update.md) — Modify master properties
- [Query Data](./query-data.md) — Read master records

---
*Last updated: 2025-05-08*
*Source: `actions/file-list/index.js`, `actions/file-detail/index.js`, `actions/file-delete/index.js`*


---

## Public API

> External-facing APIs exposed via Adobe API Mesh for partner and public consumption.

# Feature: MDM Data (Public API)

> Single external-facing API endpoint for all data consumption and mutation operations, with partner authentication, rate limiting, and response caching.

## Overview

The MDM Data action is the **public API gateway** exposed via Adobe API Mesh. It is the single entry point for external systems to read and write master data. Unlike internal admin actions, this endpoint:

- **Does NOT require Adobe IMS** for reading public entities
- **Uses partner credentials** (`x-partner-id` + `x-partner-key`) for write operations
- **Implements rate limiting** per partner
- **Strips system audit fields** from responses
- **Adds cache headers** for CDN/proxy caching

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `mdm-data` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | None (public reads) / Partner Key (writes) / IMS (private reads) |
| **RBAC Permission** | N/A (partner-based auth) |
| **HTTP Methods** | GET, POST, OPTIONS |
| **Cache-Control** | `public, max-age=60` |
| **require-adobe-auth** | `false` |

### Input Parameters

#### Read Operations

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` / `entity` | string | Yes | Target master |
| `id` | string | No | Single record by PK |
| `ids` | string/array | No | Bulk fetch by PK list (comma-separated or array) |
| `page` | number | No | Page number |
| `pageSize` | number | No | Records per page |
| `sort` | string | No | Sort field |
| `order` | string | No | `asc` or `desc` |
| `fields` | string | No | Field projection (CSV) |
| `filter` / `filters` | string/object | No | Query filters |

#### Write Operations (requires partner auth)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `operation` | string | Yes | `create`, `update`, `patch`, `delete`, `bulkCreate`, `bulkUpdate`, `bulkPatch`, `bulkDelete` |
| `data` | object/array | Yes | Record(s) to mutate |

#### Authentication Headers (for writes)

| Header | Description |
|--------|-------------|
| `x-partner-id` | Partner identifier (e.g., `ptr_abc123`) |
| `x-partner-key` | Partner secret key (e.g., `pk_...48chars`) |
| `authorization` | Bearer token (for private entity reads) |

### Response Structure

**Single Record:**
```json
{
  "master": "products",
  "record": {
    "product_id": "PROD-001",
    "name": "Widget A",
    "price": 29.99
  }
}
```

**Paginated List:**
```json
{
  "master": "products",
  "data": [...],
  "page": 1,
  "pageSize": 25,
  "total": 1250
}
```

**Bulk Fetch:**
```json
{
  "master": "products",
  "data": [...],
  "found": 8,
  "notFound": ["PROD-999"]
}
```

### Error Codes

| Code | Condition | Response |
|------|-----------|----------|
| 401 | Invalid/missing partner credentials | `{ error: "Authentication required" }` |
| 403 | Private entity without auth | `{ error: "This entity requires authentication" }` |
| 403 | Partner not allowed for this master | `{ error: "Partner not authorized for this entity" }` |
| 404 | Entity/record not found | `{ error: "Not found" }` |
| 429 | Rate limit exceeded | `{ error: "Rate limit exceeded. Try again in X seconds" }` |

## Architecture & Data Flow

### Read Flow (Public Entity)

```
External Request (no auth needed)
    │
    ▼
┌──────────────────────────────┐
│ 1. Resolve entity metadata   │
│    Check visibility=public   │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 2. Build query from params   │
│    Apply filters, sort, page │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 3. Execute query             │
│    Strip _createdBy etc.     │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 4. Return with cache headers │
│    Cache-Control: max-age=60 │
└──────────────────────────────┘
```

### Write Flow (Partner Auth)

```
External Request
    │
    ▼
┌──────────────────────────────┐
│ 1. Extract partner headers   │
│    x-partner-id + key        │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 2. Validate partner          │
│    • Exists in partners col  │
│    • Status = active         │
│    • Key matches (hashed)    │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 3. Check rate limit          │
│    state cache per partner   │
│    → 429 if exceeded         │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 4. Check allowedMasters      │
│    Partner scoped to specific│
│    entities only             │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 5. Execute mutation          │
│    (same logic as internal   │
│     record-crud/bulk-update) │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 6. Publish mutation event    │
│ 7. Return result             │
└──────────────────────────────┘
```

### Rate Limiting Implementation

```javascript
// State-based sliding window (per partner, per minute)
const key = `rate-${partnerId}`
const current = await state.get(key)
if (current && current.count >= RATE_LIMIT_PER_MINUTE) {
  return createErrorResponse('Rate limit exceeded', 429)
}
await state.put(key, { count: (current?.count || 0) + 1 }, { ttl: 60 })
```

## Security Considerations

- **No IMS for Public Reads**: Intentional — enables CDN caching and anonymous access
- **Partner Key Hashing**: Keys stored hashed; validated via constant-time comparison
- **Rate Limiting**: Per-partner sliding window prevents abuse
- **Field Stripping**: `_createdBy`, `_updatedBy`, `_deletedBy` never exposed externally
- **Master Scoping**: Partners can only access their `allowedMasters`
- **CORS Headers**: Configurable origin restrictions

## Configuration

| Setting | Source | Default | Impact |
|---------|--------|---------|--------|
| Rate limit | `RATE_LIMIT_PER_MINUTE` | 60 | Requests per partner/min |
| Cache TTL | `API_MESH_CACHE_TTL` | 60 | Response cache seconds |
| Page size | Settings | 25 / 500 max | Pagination defaults |

## Related Features

- [MDM Facets](./mdm-facets.md) — Public facet/aggregation API
- [Partner Management](./partner-management.md) — Managing partner credentials
- [Record CRUD](./record-crud.md) — Internal equivalent
- [Publish Events](./publish-events.md) — Mutation event publishing

---
*Last updated: 2025-05-08*
*Source: `actions/mdm-data/index.js`*


---

# Feature: MDM Facets (Public API)

> Public API for faceted search configuration and live aggregation values with OR-style faceting and filtered counts.

## Overview

The MDM Facets action provides the public-facing faceted search capability. It returns facet field configuration and, optionally, live aggregated values (distinct values with counts) computed via MongoDB aggregation pipelines. Supports "OR-style" faceting where selecting a value within a facet doesn't reduce that facet's own options.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `mdm-facets` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | None (public entities) / IMS (private) |
| **require-adobe-auth** | `false` |
| **Cache-Control** | `public, max-age=30` |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` / `entity` | string | Yes | Target master |
| `values` | boolean | No | If `true`, compute live facet values with counts |
| `filters` | string/object | No | Active filters (for contextual counts) |

### Response Structure

```json
{
  "master": "products",
  "facetsEnabled": true,
  "facets": [
    {
      "field": "category",
      "label": "Category",
      "type": "string",
      "sortBy": "count",
      "sortOrder": "desc",
      "limit": 20,
      "values": [
        { "value": "Electronics", "count": 450, "selected": true },
        { "value": "Clothing", "count": 320, "selected": false }
      ]
    }
  ],
  "totalRecords": 1250
}
```

## Architecture & Data Flow

### Aggregation Pipeline (per facet field)

```javascript
// For each facetable field, run:
collection.aggregate([
  { $match: baseFilter },           // Apply all OTHER facet filters (OR-style)
  { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  { $sort: { count: -1 } },         // Or alphabetical based on config
  { $limit: facetConfig.limit || 20 }
])
```

### OR-Style Faceting Logic

When computing values for facet field `category`:
- Apply filters from ALL other facets (brand, price_range, etc.)
- Do NOT apply the `category` filter itself
- This ensures all category options remain visible even when one is selected

## Security Considerations

- **No aggregation injection**: Pipeline is built server-side from config; user only controls filter values
- **Regex escaping**: Filter values escaped before use in `$match`
- **Value limits**: Each facet capped at configured `limit` (default 20 values)

## Related Features

- [MDM Data](./mdm-data.md) — Data retrieval API
- [Schema Update](./schema-update.md) — Facet field configuration (`update-facets`)

---
*Last updated: 2025-05-08*
*Source: `actions/mdm-facets/index.js`*


---

## Infrastructure & Operations

> Dashboard, metrics, archival, event publishing, and scheduled jobs.

# Feature: Dashboard

> Admin dashboard summary statistics with state-based caching (15-minute TTL) for fast page loads.

## Overview

The Dashboard action computes and serves summary statistics for the Admin UI home page. It aggregates data from multiple collections in parallel and caches results in `aio-lib-state` to ensure sub-second response times for repeated requests.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `dashboard` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `dashboard` |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `forceRefresh` | boolean | No | Bypass cache and recompute (default: false) |

### Response Structure

```json
{
  "dashboard": {
    "totalFiles": 12,
    "publicApis": 5,
    "privateApis": 7,
    "totalRecords": 45000,
    "auditAlerts": 3,
    "recentUploads": [
      { "masterName": "products", "recordCount": 1250, "updatedAt": "..." }
    ],
    "recentLogs": [
      { "operation": "bulk-update", "master": "orders", "timestamp": "..." }
    ],
    "masters": [
      { "masterName": "products", "recordCount": 1250, "visibility": "public" }
    ]
  },
  "_cached": true,
  "_cachedAt": "2025-05-08T10:15:00Z"
}
```

## Architecture & Data Flow

### Parallel Data Aggregation

```javascript
const [masters, recentLogs, alertCount] = await Promise.all([
  metaCol.find({ status: { $ne: 'deleted' } }).toArray(),
  auditCol.find().sort({ timestamp: -1 }).limit(10).toArray(),
  auditCol.countDocuments({ status: 'failure' })
])
```

### Caching Strategy

- **Cache key**: `dashboard-cache`
- **TTL**: 15 minutes (configurable via `METRICS_CACHE_TTL_MINUTES`)
- **Bypass**: `forceRefresh=true` skips cache read, always writes fresh data
- **Response flag**: `_cached: true/false` indicates whether data was served from cache

## Related Features

- [Infra Metrics](./infra-metrics.md) — Detailed infrastructure reports
- [Audit List](./audit-list.md) — Full audit log browsing

---
*Last updated: 2025-05-08*
*Source: `actions/dashboard/index.js`*


---

# Feature: Archive Config

> Manage per-entity archival configuration with global defaults and entity-level overrides for data lifecycle governance.

## Overview

The Archive Config action manages archival rules per master entity. Each entity can override global archival defaults (threshold, retention, format). The effective configuration is computed by merging global defaults with entity-specific overrides.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `archive-config` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `archive_management` |

### Input Parameters

**GET:** `master` — returns effective archival config for the entity

**POST:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` | string | Yes | Target master |
| `archival.enabled` | boolean | No | Enable/disable archival |
| `archival.threshold` | number | No | Record count trigger (100–10,000,000) |
| `archival.retentionDays` | number | No | Archive retention (1–3650 days) |
| `archival.keepLatest` | number | No | Records to keep (must be < threshold) |
| `archival.archiveFormat` | string | No | `csv` or `json` |
| `archival.notifyEmail` | string | No | Notification email |

### Response Structure

```json
{
  "master": "products",
  "globalDefaults": { "threshold": 10000, "retentionDays": 365, "keepLatest": 5000 },
  "entityConfig": { "threshold": 5000, "enabled": true },
  "effectiveConfig": { "enabled": true, "threshold": 5000, "retentionDays": 365, "keepLatest": 5000 }
}
```

## Security Considerations

- **Bound Validation**: Threshold, retention, keepLatest all validated within safe ranges
- **Logical Validation**: `keepLatest` must be less than `threshold` to prevent no-op archival

## Related Features

- [Archive Run](./archive-run.md) — Executes archival based on this configuration
- [Archive List](./archive-list.md) — Browse archived data
- [App Settings](./app-settings.md) — Global archival defaults

---
*Last updated: 2025-05-08*
*Source: `actions/archive-config/index.js`*


---

# Feature: Archive Run

> Scheduled data archival job that compresses and offloads old records from masters exceeding their configured thresholds.

## Overview

The Archive Run action is a scheduled job (daily at 3 AM via alarm trigger) that processes all masters with archival enabled. For each master exceeding its record threshold, it archives the oldest records to compressed files, stores download links, and deletes the archived records.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `archive-run` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Self-auth (alarm trigger) |
| **Trigger** | Alarm (daily 3 AM) or manual |
| **RBAC Permission** | `archive_management` (manual only) |

### Response Structure

```json
{
  "processed": 3,
  "archived": 2,
  "recordsArchived": 8000,
  "expiredCleaned": 1,
  "errors": [],
  "details": [
    {
      "master": "events_log",
      "recordsArchived": 5000,
      "fileName": "events_log-archive-20250508-a1b2c3.csv.gz",
      "fileSizeBytes": 250000
    }
  ]
}
```

## Architecture & Data Flow

### Phase 1: Archival

```
For each master where archival.enabled && recordCount > threshold:
    1. Calculate recordsToArchive = recordCount - keepLatest
    2. Fetch oldest records: find().sort({_createdAt: 1}).limit(N)
    3. Serialize to CSV or JSON (per archiveFormat config)
    4. Compress with gzip
    5. Upload to aio-lib-files
    6. Generate pre-signed URL
    7. Store archive metadata in archives collection
    8. Delete archived records in batches
       → deleteMany({ [pk]: { $in: [...batchIds] } })
    9. Update metadata.recordCount
```

### Phase 2: Cleanup Expired Archives

```
1. Find archives where expiresAt < now
2. Delete file from aio-lib-files
3. Remove archive metadata record
```

## Security Considerations

- **Batch Deletion**: Records deleted in batches to prevent timeout
- **Insert-Before-Delete**: Archive file created before records removed
- **Idempotent**: Re-running doesn't duplicate archives (checks current count)

## Related Features

- [Archive Config](./archive-config.md) — Configuration this job uses
- [Archive List](./archive-list.md) — Browse created archives
- [Audit Cleanup](./audit-cleanup.md) — Similar pattern for audit logs

---
*Last updated: 2025-05-08*
*Source: `actions/archive-run/index.js`*


---

# Feature: Archive List

> Browse data archives with filtering, pagination, expiry tracking, and summary statistics.

## Overview

The Archive List action provides visibility into created data archives. It enriches archive records with expiry calculations, master display names, and provides summary statistics across all archives.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `archive-list` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `archive_management` |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` / `entity` | string | No | Filter by master |
| `status` | string | No | `active` or `expired` |
| `page` | number | No | Page number |
| `pageSize` | number | No | Results per page |
| `startDate` | string | No | Filter by archive date |
| `endDate` | string | No | Filter by archive date |

### Response Structure

```json
{
  "archives": [
    {
      "master": "events_log",
      "masterDisplayName": "Events Log",
      "recordCount": 5000,
      "fileName": "events_log-archive-20250508.csv.gz",
      "downloadUrl": "https://...",
      "archivedAt": "2025-05-08T03:00:00Z",
      "expiresAt": "2026-05-08T03:00:00Z",
      "isExpired": false,
      "daysUntilExpiry": 365
    }
  ],
  "summary": {
    "totalArchives": 15,
    "totalRecordsArchived": 75000,
    "totalSizeBytes": 5000000,
    "activeCount": 12,
    "expiredCount": 3
  },
  "page": 1,
  "pageSize": 25,
  "total": 15
}
```

## Related Features

- [Archive Config](./archive-config.md) — Archival configuration
- [Archive Run](./archive-run.md) — Creates the archives listed here

---
*Last updated: 2025-05-08*
*Source: `actions/archive-list/index.js`*


---

# Feature: Infrastructure Metrics

> Comprehensive infrastructure monitoring with six report types covering storage, guardrails, failures, analytics, usage patterns, and system overview.

## Overview

The Infra Metrics action powers the Admin Console's monitoring dashboard. It provides detailed infrastructure reports computed from database statistics and audit logs, with state-based caching for performance.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `infra-metrics` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `admin_console` |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `report` | string | Yes | `storage`, `guardrails`, `failures`, `analytics`, `usage`, `overview` |
| `forceRefresh` | boolean | No | Bypass metrics cache |
| `days` | number | No | Time window for failures/analytics (default: 7) |

### Report Types

#### `storage` — Storage Breakdown
```json
{
  "report": "storage",
  "totalStorageMB": 245.5,
  "maxStorageMB": 500,
  "utilizationPercent": 49.1,
  "collections": [
    { "name": "mdm_products", "docCount": 1250, "estimatedSizeMB": 45.2 },
    { "name": "mdm_orders", "docCount": 8500, "estimatedSizeMB": 120.0 }
  ],
  "systemCollections": [
    { "name": "audit", "docCount": 5000, "estimatedSizeMB": 12.5 }
  ]
}
```

#### `guardrails` — Limits Status
```json
{
  "report": "guardrails",
  "checks": [
    {
      "name": "Total Storage",
      "current": 245.5,
      "limit": 500,
      "unit": "MB",
      "percent": 49.1,
      "status": "healthy"
    },
    {
      "name": "Collection Count",
      "current": 15,
      "limit": 50,
      "percent": 30,
      "status": "healthy"
    }
  ],
  "overallStatus": "healthy"
}
```

Status thresholds: `healthy` (< 70%), `warning` (70-90%), `critical` (> 90%)

#### `failures` — Failure Analytics
```json
{
  "report": "failures",
  "period": "7 days",
  "totalFailures": 12,
  "byOperation": { "bulk-update": 5, "full-update": 3, "record-crud": 4 },
  "byMaster": { "products": 7, "orders": 5 },
  "recentFailures": [...]
}
```

#### `analytics` — Action Invocation Patterns
```json
{
  "report": "analytics",
  "period": "7 days",
  "totalInvocations": 1500,
  "byOperation": { "query-data": 800, "record-crud": 400, "dashboard": 300 },
  "byDay": [{ "date": "2025-05-08", "count": 220 }]
}
```

#### `usage` — Throughput Metrics
```json
{
  "report": "usage",
  "reads": 12000,
  "writes": 3500,
  "cacheHitRate": 0.82,
  "avgResponseTime": 145
}
```

#### `overview` — Combined Summary
```json
{
  "report": "overview",
  "health": {
    "database": "healthy",
    "guardrails": "healthy",
    "operations": "warning",
    "apiMesh": "healthy"
  },
  "storage": { "...summary..." },
  "guardrails": { "...summary..." },
  "recentFailures": 3
}
```

### Caching

- **Cache key**: `metrics-cache` (scoped by report type)
- **TTL**: Configurable via `METRICS_CACHE_TTL_MINUTES` (default: 15 min)
- **Bypass**: `forceRefresh=true`

## Related Features

- [Dashboard](./dashboard.md) — Summary statistics (lighter weight)
- [App Settings](./app-settings.md) — Guardrail configuration
- [Audit List](./audit-list.md) — Raw failure log access

---
*Last updated: 2025-05-08*
*Source: `actions/infra-metrics/index.js`*


---

# Feature: Publish Events

> Publishes CloudEvents to Adobe I/O Events for downstream integration notifications on data mutations.

## Overview

The Publish Events action sends structured CloudEvents to Adobe I/O Events whenever data is mutated. This enables event-driven architectures where downstream systems can subscribe to data change notifications.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `publish-events` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS (require-adobe-auth) |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `apiKey` | string | Yes | Adobe API key |
| `providerId` | string | Yes | Events provider ID |
| `eventCode` | string | Yes | Event type code |
| `payload` | object | Yes | Event data payload |

### Headers Required

| Header | Description |
|--------|-------------|
| `Authorization` | Bearer IMS token |
| `x-gw-ims-org-id` | Adobe IMS Organization ID |

### Response Structure

```json
{
  "statusCode": 200,
  "body": { "message": "Event published successfully" }
}
```

## Architecture & Data Flow

```
Mutation Action (record-crud, bulk-update, etc.)
    │
    ▼
publishMutationEvent(params, eventData)  ← Called internally
    │
    ▼
┌─────────────────────────────┐
│ Build CloudEvent            │
│ • id: UUID v4               │
│ • type: eventCode           │
│ • source: provider URI      │
│ • data: mutation payload    │
│ • time: ISO timestamp       │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ Adobe I/O Events SDK        │
│ Events.publishEvent(event)  │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 200: Published              │
│ 204: No registrations       │
│ (event delivered to webhook │
│  or journal subscribers)    │
└─────────────────────────────┘
```

## Security Considerations

- **Internal Only**: Called by other actions, not directly by external clients
- **IMS Scoped**: Events published under the app's IMS org context
- **Non-Blocking**: Event publishing is fire-and-forget (failures don't block mutation)

## Related Features

- [Record CRUD](./record-crud.md) — Publishes events on mutations
- [MDM Data](./mdm-data.md) — Publishes events on partner mutations
- [Bulk Update](./bulk-update.md) — Publishes batch mutation events

---
*Last updated: 2025-05-08*
*Source: `actions/publish-events/index.js`*


---

## Administration

> User management, partner management, audit logs, and application settings.

# Feature: User Management

> Full CRUD for application users and custom roles with dynamic granular permissions, bulk user creation, and session management.

## Overview

The User Management action handles all operations related to application users and their access roles. It implements a flexible RBAC system where custom roles define feature-level permissions, and users are assigned roles.

The `resolve` operation is special — it's called on every page load to determine the current user's permissions and is cached aggressively for performance.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `user-management` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `user_management` (except `resolve` which is open) |

### Operations

| Operation (`op`) | Permission Required | Description |
|-----------------|-------------------|-------------|
| `resolve` | Any authenticated user | Returns current user's permissions + settings |
| `users` | `user_management` | List all users |
| `roles` | `user_management` | List all roles |
| `create-user` | `user_management` | Create single user |
| `bulk-create-users` | `user_management` | Create up to 500 users |
| `update-user` | `user_management` | Modify user properties |
| `delete-user` | `user_management` | Soft-delete user |
| `create-role` | `user_management` | Create custom role |
| `update-role` | `user_management` | Modify role permissions |
| `delete-role` | `user_management` | Delete role (if no users assigned) |

### Input Parameters (varies by operation)

**create-user:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `email` | string | Yes | User email (validated format) |
| `firstName` | string | Yes | First name |
| `lastName` | string | Yes | Last name |
| `roleId` | string | Yes | Assigned role ID |

**create-role:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Role name (unique) |
| `description` | string | No | Role description |
| `permissions` | object | Yes | Feature permission map |

### Response Structure

**resolve:**
```json
{
  "user": {
    "email": "user@company.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "Super Admin",
    "permissions": {
      "dashboard": true,
      "masters": true,
      "import_data": true,
      "query_console": true,
      "activity_log": true,
      "partners": true,
      "admin_console": true,
      "settings": true,
      "record_management": true,
      "schema_management": true,
      "archive_management": true,
      "user_management": true
    }
  },
  "settings": { "...app settings..." }
}
```

## Architecture & Data Flow

### Resolve Flow (on every page load)

```
1. Extract email from IMS token
2. Check state cache: `user-resolve-<email>` (2-min TTL)
3. If cached → return immediately
4. If miss:
   a. Seed system roles (idempotent, 1-hour cache flag)
   b. Find user in app_users collection
   c. If not found + email matches INITIAL_ADMIN_EMAIL → auto-create as Super Admin
   d. If not found → return "Access Denied"
   e. Fetch user's role from app_roles
   f. Compute permissions from role
   g. Cache result (2-min TTL)
   h. Return user + piggybacked settings
```

### Auto-Provisioning (Bootstrap)

The first user (matching `INITIAL_ADMIN_EMAIL` env var) is automatically created as Super Admin on first resolve. This bootstraps the system without requiring manual DB access.

## Security Considerations

- **Email Validation**: Strict format validation prevents invalid entries
- **Duplicate Prevention**: Unique constraint on email field
- **Role Deletion Safety**: Cannot delete role with assigned users
- **Permission Key Validation**: All permission keys validated against `APP_FEATURES` enum
- **Bulk Limit**: Max 500 users per bulk-create to prevent abuse
- **Cache Invalidation**: User/role changes invalidate resolve cache immediately

## Related Features

- [MDM Utilities](./mdm-utils.md) — RBAC enforcement implementation
- [App Settings](./app-settings.md) — Piggybacked in resolve response
- [Partner Management](./partner-management.md) — External system access (complement to user access)

---
*Last updated: 2025-05-08*
*Source: `actions/user-management/index.js`*


---

# Feature: Partner Management

> CRUD for integration partners with secure credential generation, master-level access scoping, and key lifecycle management.

## Overview

The Partner Management action handles onboarding and lifecycle management of external integration partners. Partners are external systems that access the public API (`mdm-data`) using API keys rather than Adobe IMS tokens.

Each partner receives a unique ID (`ptr_...`) and secret key (`pk_...`) at creation time. The key is shown **only once** (at creation) and stored hashed. Partners are scoped to specific masters via `allowedMasters`.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `partner-management` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `partners` |

### Operations

| Operation (`op`) | Description |
|-----------------|-------------|
| `list` (default) | List all partners (keys stripped) |
| `create` | Create new partner with generated credentials |
| `update` | Modify partner properties, optionally regenerate key |
| `delete` | Soft-delete partner |

### Input Parameters

**create:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Partner display name |
| `description` | string | No | Purpose description |
| `contactEmail` | string | Yes | Partner contact |
| `allowedMasters` | array | Yes | Masters this partner can access |
| `status` | string | No | `active` or `inactive` (default: active) |

### Response Structure

**Create (one-time key disclosure):**
```json
{
  "status": "success",
  "partner": {
    "partnerId": "ptr_a1b2c3d4e5f6",
    "name": "ERP Integration",
    "partnerKey": "pk_abcdef123456...48chars...",
    "allowedMasters": ["products", "inventory"],
    "status": "active",
    "createdAt": "2025-05-08T10:30:00Z"
  },
  "message": "Partner created. Save the partnerKey — it will not be shown again."
}
```

**List (keys never exposed):**
```json
{
  "partners": [
    {
      "partnerId": "ptr_a1b2c3d4e5f6",
      "name": "ERP Integration",
      "keyConfigured": true,
      "allowedMasters": ["products"],
      "status": "active"
    }
  ]
}
```

## Architecture & Data Flow

### Credential Generation

```javascript
// Partner ID: 12 random chars prefixed with ptr_
const partnerId = 'ptr_' + crypto.randomBytes(6).toString('hex')

// Partner Key: 48 random chars prefixed with pk_
const partnerKey = 'pk_' + crypto.randomBytes(24).toString('hex')

// Store hashed key (never store plaintext)
const keyHash = crypto.createHash('sha256').update(partnerKey).digest('hex')
```

### Key Regeneration

On `update` with `regenerateKey: true`:
1. Generate new key
2. Hash and store
3. Return new key (one-time)
4. Old key immediately invalidated

## Security Considerations

- **One-Time Key Display**: Key shown only at creation/regeneration
- **Hashed Storage**: Keys stored as SHA-256 hash
- **Master Scoping**: Partner can only access explicitly listed masters
- **Soft Delete**: Deactivated partners cannot authenticate
- **Key Stripping**: List operations never return key data

## Related Features

- [MDM Data](./mdm-data.md) — Where partner credentials are used for authentication
- [User Management](./user-management.md) — Internal user access (complement)

---
*Last updated: 2025-05-08*
*Source: `actions/partner-management/index.js`*


---

# Feature: Audit List

> Query audit logs with filtering, pagination, date ranges, and archive browsing for compliance and operational monitoring.

## Overview

The Audit List action provides searchable access to the audit trail. Every mutation operation in the platform creates an audit log entry, and this action enables browsing, filtering, and searching those logs. It also supports listing archived audit logs (from the audit-cleanup process).

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `audit-list` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `activity_log` |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` / `entity` | string | No | Filter by master name |
| `action` / `operation` | string | No | Filter by operation type (substring search) |
| `user` / `actor` | string | No | Filter by actor email (substring search) |
| `status` | string | No | Filter by status: `success` or `failure` |
| `page` | number | No | Page number (default: 1) |
| `pageSize` | number | No | Results per page |
| `startDate` | string | No | Start of date range (ISO format) |
| `endDate` | string | No | End of date range (ISO format) |
| `type` | string | No | If `'archives'` → list archived audit files |

### Response Structure

**Audit Logs:**
```json
{
  "logs": [
    {
      "id": "...",
      "masterName": "products",
      "operation": "bulk-update",
      "actor": "admin@company.com",
      "status": "success",
      "affectedRecords": 150,
      "timestamp": "2025-05-08T10:30:00+05:30",
      "details": { "mode": "upsert" }
    }
  ],
  "page": 1,
  "pageSize": 25,
  "total": 340
}
```

**Archives:**
```json
{
  "archives": [
    {
      "fileName": "audit-2025-04-archive.csv.gz",
      "recordCount": 5000,
      "archivedAt": "2025-05-01T03:00:00Z",
      "downloadUrl": "https://...",
      "expiresAt": "2025-05-02T03:00:00Z",
      "isExpired": false,
      "daysUntilExpiry": 12
    }
  ],
  "summary": { "totalArchives": 5, "totalRecords": 25000 }
}
```

## Architecture & Data Flow

### Query Optimization

Two paths based on filter complexity:

**Fast Path** (DB-level pagination): When only `masterName`, `status`, `startDate`/`endDate` filters are used — all can be expressed as MongoDB query operators efficiently.

**Slow Path** (regex search): When `operation` or `actor` substring search is needed — uses `$regex` with `$options: 'i'` for case-insensitive matching.

```javascript
// Fast path: exact match filters
const query = { masterName: 'products', status: 'success' }

// Slow path: regex for substring search
const query = {
  $and: [
    { operation: { $regex: 'bulk', $options: 'i' } },
    { actor: { $regex: 'admin', $options: 'i' } }
  ]
}
```

## Security Considerations

- **Read-Only**: Audit logs cannot be modified through this action
- **Regex Escaping**: User filter values are escaped to prevent ReDoS
- **Pre-signed URLs**: Archive download links expire (24h max)

## Related Features

- [Audit Cleanup](./audit-cleanup.md) — Archival and purge of old logs
- [Dashboard](./dashboard.md) — Shows recent logs and alert count

---
*Last updated: 2025-05-08*
*Source: `actions/audit-list/index.js`*


---

# Feature: Audit Cleanup

> Scheduled/manual audit log archival to compressed files and purge of expired archives for storage lifecycle management.

## Overview

The Audit Cleanup action manages the lifecycle of audit logs through two phases: **archival** (compressing old logs to files) and **purge** (removing expired archive files). It runs automatically via an alarm trigger (scheduled) or can be triggered manually.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `audit-cleanup` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Self-auth (`include-ims-credentials`) for alarms |
| **RBAC Permission** | `admin_console` (manual trigger) |
| **Trigger** | Alarm (scheduled) or manual POST |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `phase` | string | No | `archive`, `purge`, or `all` (default: `all`) |

### Response Structure

```json
{
  "status": "success",
  "phase": "all",
  "archived": {
    "recordCount": 5000,
    "fileName": "audit-2025-05-archive-a1b2c3.csv.gz",
    "sizeBytes": 125000,
    "downloadUrl": "https://..."
  },
  "purgedArchives": 2,
  "message": "Archived 5000 logs, purged 2 expired archives"
}
```

## Architecture & Data Flow

### Archive Phase

```
1. Query audit logs older than retentionDays
   → auditCol.find({ timestamp: { $lt: cutoffDate } })
2. Build CSV from log records
3. Compress with gzip (level 9)
4. Upload to aio-lib-files
5. Generate pre-signed URL (24h)
6. Store archive metadata in audit_archives collection
7. Delete archived logs from audit collection
   → auditCol.deleteMany({ _id: { $in: [...archivedIds] } })
```

### Purge Phase

```
1. Find expired archives
   → audit_archives.find({ expiresAt: { $lt: now } })
2. Delete file from aio-lib-files
3. Remove archive metadata record
```

## Security Considerations

- **Self-Authentication**: Uses `include-ims-credentials` — no external auth needed for scheduled runs
- **Compression**: gzip level 9 minimizes storage costs
- **Pre-signed URLs**: Time-limited access to archive files
- **Atomic Delete**: Only deletes audit records AFTER successful archive upload

## Configuration

| Setting | Source | Default | Impact |
|---------|--------|---------|--------|
| Retention days | `AUDIT_RETENTION_DAYS` | 90 | Logs older than this get archived |
| Archive retention | `ARCHIVE_RETENTION_DAYS` | 365 | Archives expire after this |

## Related Features

- [Audit List](./audit-list.md) — Browsing active and archived logs
- [Archive Run](./archive-run.md) — Similar pattern for data archival

---
*Last updated: 2025-05-08*
*Source: `actions/audit-cleanup/index.js`*


---

# Feature: App Settings

> Application-wide configuration management with environment-variable defaults, database overrides, deep-merge strategy, and active session tracking.

## Overview

The App Settings action manages all platform-wide configuration. Settings are structured in categories and follow a three-layer merge strategy: **Environment Variables** (highest priority, infrastructure) → **Database Stored** (admin-configurable) → **Defaults** (code-defined fallbacks).

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `app-settings` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `settings` (write); read open to authenticated users |

### Settings Categories

| Category | Settings |
|----------|----------|
| `general` | App name, timezone, environment label |
| `guardrails` | Max storage MB, max collections, max docs per collection, max doc size |
| `dataManagement` | Default page size, max page size, bulk batch size, query timeout |
| `api` | Rate limit per minute, cache TTL, CORS origins |
| `audit` | Retention days, archive format, max log size |
| `security` | Session timeout, max sessions, token cache TTL |
| `ui` | Theme, date format, records per page |
| `notifications` | Email notifications enabled, alert thresholds |
| `performance` | Metrics cache TTL, dashboard cache TTL |
| `archival` | Global archival defaults (threshold, retention, format) |

### Merge Strategy

```
┌─────────────────────────────────┐
│ ENV VARS (highest priority)     │ ← Infrastructure values NEVER overridden
│ MDM_MAX_STORAGE_MB, DB_REGION,  │
│ RATE_LIMIT_PER_MINUTE, etc.     │
├─────────────────────────────────┤
│ DATABASE STORED (admin writes)  │ ← Configurable via Admin UI
│ Everything else                 │
├─────────────────────────────────┤
│ CODE DEFAULTS (fallback)        │ ← Applied when no DB value exists
└─────────────────────────────────┘
```

### Session Management

| Operation | Description |
|-----------|-------------|
| `sessionOperation: 'register'` | Track active user session |
| `sessionOperation: 'deregister'` | Remove session on logout/close |

## Security Considerations

- **Env-Var Protection**: Infrastructure values (storage limits, rate limits) cannot be overridden via the API
- **Bound Validation**: Numeric settings validated within safe ranges
- **Cache Invalidation**: Settings cache cleared on write to ensure immediate propagation

## Related Features

- [MDM Utilities](./mdm-utils.md) — Consumes settings via `getCachedSettings()`
- [Infra Metrics](./infra-metrics.md) — Reports against configured guardrails
- [User Management](./user-management.md) — Settings piggybacked on resolve

---
*Last updated: 2025-05-08*
*Source: `actions/app-settings/index.js`*


---

## Common Patterns & Conventions

### Standard Action Entry Pattern

Every MDM action follows this structure:

```javascript
const { getDbClient, enforceAppPermission, createResponse, createErrorResponse } = require('../mdm-utils')

async function main(params) {
  // 1. CORS preflight
  if (params.__ow_method === 'options') return createResponse({})
  
  // 2. Parse request body
  const body = typeof params.__ow_body === 'string' 
    ? JSON.parse(Buffer.from(params.__ow_body, 'base64').toString()) 
    : params
  
  // 3. Connect to database
  const client = await getDbClient(params)
  
  try {
    // 4. RBAC enforcement
    await enforceAppPermission(client, params, 'action-name')
    
    // 5. Business logic
    // ...
    
    // 6. Audit logging
    await createAuditLog(client, { ... })
    
    // 7. Return response
    return createResponse({ status: 'success', ... })
  } catch (error) {
    return createErrorResponse(error.message, error.statusCode || 500)
  } finally {
    // 8. ALWAYS close DB connection
    if (client) await client.close()
  }
}

exports.main = main
```

### Response Format

All actions return responses via `createResponse(body, statusCode)`:

```json
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-partner-id, x-partner-key",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
  },
  "body": { "...response data..." }
}
```

### Error Format

```json
{
  "statusCode": 400,
  "headers": { "...CORS headers..." },
  "body": { "error": "Human-readable error message" }
}
```

### Audit Log Entry Format

```json
{
  "masterName": "products",
  "operation": "bulk-update",
  "actor": "user@company.com",
  "status": "success",
  "affectedRecords": 150,
  "details": { "mode": "upsert", "errors": 0 },
  "timestamp": "2025-05-08T10:30:00+05:30"
}
```

### RBAC Permission Check Flow

```
Request → Extract IMS Token → Decode Email → Check State Cache
   ↓ (cache miss)
Query app_users → Fetch Role → Compute Permissions → Cache (2min)
   ↓
Check ACTION_FEATURE_MAP[action] → User has ANY listed feature? → Allow/Deny
```

---

## Environment Variables Reference

| Variable | Default | Category | Description |
|----------|---------|----------|-------------|
| `DB_REGION` | `apac` | Infrastructure | Database deployment region |
| `APP_TIMEZONE` | `UTC` | General | Timestamp timezone for audit/display |
| `MDM_MAX_STORAGE_MB` | `500` | Guardrails | Maximum total database storage |
| `METRICS_CACHE_TTL_MINUTES` | `15` | Performance | Metrics/dashboard cache duration |
| `DEFAULT_PAGE_SIZE` | `25` | Data | Default pagination size |
| `MAX_PAGE_SIZE` | `500` | Data | Maximum allowed page size |
| `RATE_LIMIT_PER_MINUTE` | `60` | API | Public API rate limit per partner |
| `API_MESH_CACHE_TTL` | `60` | API | Public API response cache (seconds) |
| `MAX_SCHEMA_FIELDS` | `100` | Data | Maximum fields per master schema |
| `BULK_BATCH_SIZE` | `1000` | Data | Records per bulkWrite batch |
| `QUERY_TIMEOUT` | `30000` | Data | DB query timeout (ms) |
| `AUDIT_RETENTION_DAYS` | `90` | Audit | Days before audit log archival |
| `ARCHIVE_RETENTION_DAYS` | `365` | Archival | Days before archive expiry |
| `INITIAL_ADMIN_EMAIL` | — | Security | Email auto-provisioned as Super Admin |

---

## Database Collections Reference

### System Collections

| Collection | Purpose | Managed By |
|-----------|---------|-----------|
| `metadata` | Master definitions, schemas, config | file-upload, metadata-update, schema-update |
| `audit` | Operation audit trail | All mutation actions |
| `audit_archives` | Archived audit log references | audit-cleanup |
| `settings` | Application configuration | app-settings |
| `archives` | Data archive metadata | archive-run |
| `partners` | Integration partner records | partner-management |
| `app_users` | Application user records | user-management |
| `app_roles` | Custom role definitions | user-management |
| `counters` | Atomic sequence generators | file-upload, record-crud |
| `user_sessions` | Active session tracking | app-settings |

### User Data Collections

Pattern: `mdm_<masterName>`

Each master creates a dedicated collection. Example: master "products" → collection `mdm_products`

---

*This documentation is auto-generated from individual feature files in `docs/features/`.*  
*To update: Edit the relevant `docs/features/<feature>.md` file, then run `npm run build:docs`.*
