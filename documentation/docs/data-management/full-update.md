---
title: "Full Update"
sidebar_position: 15
description: "Technical documentation for the Full Update feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/datahub-app/blob/main/actions/full-update/index.js
---

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
