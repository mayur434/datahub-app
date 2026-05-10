---
title: "File Upload (Master Creation)"
sidebar_position: 14
description: "Technical documentation for the File Upload (Master Creation) feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/pimapp/blob/main/actions/file-upload/index.js
---

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

- [File List](./file-operations.md) — Lists created masters
- [File Detail](./file-operations.md) — View master metadata
- [File Delete](./file-operations.md) — Remove a master
- [Schema Update](./schema-update.md) — Modify schema post-creation
- [Full Update](./full-update.md) — Replace all data in existing master

---
*Last updated: 2025-05-08*
*Source: `actions/file-upload/index.js`*
