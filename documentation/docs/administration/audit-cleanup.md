---
title: "Audit Cleanup"
sidebar_position: 43
description: "Technical documentation for the Audit Cleanup feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/pimapp/blob/main/actions/audit-cleanup/index.js
---

> Scheduled/manual audit log archival to compressed files and purge of expired archives for storage lifecycle management.

## Overview

The Audit Cleanup action manages the lifecycle of audit logs through two phases: **archival** (compressing old logs to files) and **purge** (removing expired archive files). It runs automatically via an alarm trigger (scheduled) or can be triggered manually.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `audit-cleanup` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Self-auth (`include-ims-credentials`) for alarms |
| **RBAC Permission** | `admin_console` (manual trigger) |
| **Trigger** | Alarm (scheduled) or manual POST |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `phase` | string | No | `archive`, `purge`, or `all` (default: `all`) |

### Response Structure

```json
{
  "status": "success",
  "phase": "all",
  "archived": {
    "recordCount": 5000,
    "fileName": "audit-2025-05-archive-a1b2c3.csv.gz",
    "sizeBytes": 125000,
    "downloadUrl": "https://..."
  },
  "purgedArchives": 2,
  "message": "Archived 5000 logs, purged 2 expired archives"
}
```

## Architecture & Data Flow

### Archive Phase

```
1. Query audit logs older than retentionDays
   → auditCol.find({ timestamp: { $lt: cutoffDate } })
2. Build CSV from log records
3. Compress with gzip (level 9)
4. Upload to aio-lib-files
5. Generate pre-signed URL (24h)
6. Store archive metadata in audit_archives collection
7. Delete archived logs from audit collection
   → auditCol.deleteMany({ _id: { $in: [...archivedIds] } })
```

### Purge Phase

```
1. Find expired archives
   → audit_archives.find({ expiresAt: { $lt: now } })
2. Delete file from aio-lib-files
3. Remove archive metadata record
```

## Security Considerations

- **Self-Authentication**: Uses `include-ims-credentials` — no external auth needed for scheduled runs
- **Compression**: gzip level 9 minimizes storage costs
- **Pre-signed URLs**: Time-limited access to archive files
- **Atomic Delete**: Only deletes audit records AFTER successful archive upload

## Configuration

| Setting | Source | Default | Impact |
|---------|--------|---------|--------|
| Retention days | `AUDIT_RETENTION_DAYS` | 90 | Logs older than this get archived |
| Archive retention | `ARCHIVE_RETENTION_DAYS` | 365 | Archives expire after this |

## Related Features

- [Audit List](./audit-list.md) — Browsing active and archived logs
- [Archive Run](../infrastructure/archive-run.md) — Similar pattern for data archival

---
*Last updated: 2025-05-08*
*Source: `actions/audit-cleanup/index.js`*
