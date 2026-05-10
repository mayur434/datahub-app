---
title: "Visibility Update"
sidebar_position: 17
description: "Technical documentation for the Visibility Update feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/datahub-app/blob/main/actions/visibility-update/index.js
---

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

- [MDM Data](../public-api/mdm-data.md) — Respects visibility setting
- [Metadata Update](./metadata-update.md) — Other master property changes
- [File Detail](./file-operations.md) — View current visibility

---
*Last updated: 2025-05-08*
*Source: `actions/visibility-update/index.js`*
