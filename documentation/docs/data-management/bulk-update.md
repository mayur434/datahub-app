---
title: "Bulk Update"
sidebar_position: 12
description: "Technical documentation for the Bulk Update feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/pimapp/blob/main/actions/bulk-update/index.js
---

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
