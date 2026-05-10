---
title: "Schema Update"
sidebar_position: 13
description: "Technical documentation for the Schema Update feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/pimapp/blob/main/actions/schema-update/index.js
---

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
