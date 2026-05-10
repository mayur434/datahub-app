---
title: "Metadata Update"
sidebar_position: 18
description: "Technical documentation for the Metadata Update feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/datahub-app/blob/main/actions/metadata-update/index.js
---

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
- [File Detail](./file-operations.md) — View metadata

---
*Last updated: 2025-05-08*
*Source: `actions/metadata-update/index.js`*
