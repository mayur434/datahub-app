---
title: "File Operations (List, Detail, Delete)"
sidebar_position: 19
description: "Technical documentation for the File Operations (List, Detail, Delete) feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/datahub-app/blob/main/actions/file-list/index.js, actions/file-detail/index.js, actions/file-delete/index.js
---

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
