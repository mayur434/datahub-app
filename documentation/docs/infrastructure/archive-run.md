---
title: "Archive Run"
sidebar_position: 32
description: "Technical documentation for the Archive Run feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/datahub-app/blob/main/actions/archive-run/index.js
---

> Scheduled data archival job that compresses and offloads old records from masters exceeding their configured thresholds.

## Overview

The Archive Run action is a scheduled job (daily at 3 AM via alarm trigger) that processes all masters with archival enabled. For each master exceeding its record threshold, it archives the oldest records to compressed files, stores download links, and deletes the archived records.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `archive-run` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Self-auth (alarm trigger) |
| **Trigger** | Alarm (daily 3 AM) or manual |
| **RBAC Permission** | `archive_management` (manual only) |

### Response Structure

```json
{
  "processed": 3,
  "archived": 2,
  "recordsArchived": 8000,
  "expiredCleaned": 1,
  "errors": [],
  "details": [
    {
      "master": "events_log",
      "recordsArchived": 5000,
      "fileName": "events_log-archive-20250508-a1b2c3.csv.gz",
      "fileSizeBytes": 250000
    }
  ]
}
```

## Architecture & Data Flow

### Phase 1: Archival

```
For each master where archival.enabled && recordCount > threshold:
    1. Calculate recordsToArchive = recordCount - keepLatest
    2. Fetch oldest records: find().sort({_createdAt: 1}).limit(N)
    3. Serialize to CSV or JSON (per archiveFormat config)
    4. Compress with gzip
    5. Upload to aio-lib-files
    6. Generate pre-signed URL
    7. Store archive metadata in archives collection
    8. Delete archived records in batches
       → deleteMany({ [pk]: { $in: [...batchIds] } })
    9. Update metadata.recordCount
```

### Phase 2: Cleanup Expired Archives

```
1. Find archives where expiresAt < now
2. Delete file from aio-lib-files
3. Remove archive metadata record
```

## Security Considerations

- **Batch Deletion**: Records deleted in batches to prevent timeout
- **Insert-Before-Delete**: Archive file created before records removed
- **Idempotent**: Re-running doesn't duplicate archives (checks current count)

## Related Features

- [Archive Config](./archive-config.md) — Configuration this job uses
- [Archive List](./archive-list.md) — Browse created archives
- [Audit Cleanup](../administration/audit-cleanup.md) — Similar pattern for audit logs

---
*Last updated: 2025-05-08*
*Source: `actions/archive-run/index.js`*
