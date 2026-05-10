---
title: "Archive Config"
sidebar_position: 31
description: "Technical documentation for the Archive Config feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/pimapp/blob/main/actions/archive-config/index.js
---

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
- [App Settings](../administration/app-settings.md) — Global archival defaults

---
*Last updated: 2025-05-08*
*Source: `actions/archive-config/index.js`*
