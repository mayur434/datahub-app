---
title: "Record CRUD"
sidebar_position: 10
description: "Technical documentation for the Record CRUD feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/datahub-app/blob/main/actions/record-crud/index.js
---

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
- [MDM Data (Public API)](../public-api/mdm-data.md) — External CRUD via partner credentials

---
*Last updated: 2025-05-08*
*Source: `actions/record-crud/index.js`*
