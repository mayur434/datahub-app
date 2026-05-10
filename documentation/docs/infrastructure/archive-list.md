---
title: "Archive List"
sidebar_position: 33
description: "Technical documentation for the Archive List feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/datahub-app/blob/main/actions/archive-list/index.js
---

> Browse data archives with filtering, pagination, expiry tracking, and summary statistics.

## Overview

The Archive List action provides visibility into created data archives. It enriches archive records with expiry calculations, master display names, and provides summary statistics across all archives.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `archive-list` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `archive_management` |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` / `entity` | string | No | Filter by master |
| `status` | string | No | `active` or `expired` |
| `page` | number | No | Page number |
| `pageSize` | number | No | Results per page |
| `startDate` | string | No | Filter by archive date |
| `endDate` | string | No | Filter by archive date |

### Response Structure

```json
{
  "archives": [
    {
      "master": "events_log",
      "masterDisplayName": "Events Log",
      "recordCount": 5000,
      "fileName": "events_log-archive-20250508.csv.gz",
      "downloadUrl": "https://...",
      "archivedAt": "2025-05-08T03:00:00Z",
      "expiresAt": "2026-05-08T03:00:00Z",
      "isExpired": false,
      "daysUntilExpiry": 365
    }
  ],
  "summary": {
    "totalArchives": 15,
    "totalRecordsArchived": 75000,
    "totalSizeBytes": 5000000,
    "activeCount": 12,
    "expiredCount": 3
  },
  "page": 1,
  "pageSize": 25,
  "total": 15
}
```

## Related Features

- [Archive Config](./archive-config.md) — Archival configuration
- [Archive Run](./archive-run.md) — Creates the archives listed here

---
*Last updated: 2025-05-08*
*Source: `actions/archive-list/index.js`*
