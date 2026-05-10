---
title: "Delta Update"
sidebar_position: 16
description: "Technical documentation for the Delta Update feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/pimapp/blob/main/actions/delta-update/index.js
---

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
