---
title: "Audit List"
sidebar_position: 42
description: "Technical documentation for the Audit List feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/datahub-app/blob/main/actions/audit-list/index.js
---

> Query audit logs with filtering, pagination, date ranges, and archive browsing for compliance and operational monitoring.

## Overview

The Audit List action provides searchable access to the audit trail. Every mutation operation in the platform creates an audit log entry, and this action enables browsing, filtering, and searching those logs. It also supports listing archived audit logs (from the audit-cleanup process).

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `audit-list` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `activity_log` |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` / `entity` | string | No | Filter by master name |
| `action` / `operation` | string | No | Filter by operation type (substring search) |
| `user` / `actor` | string | No | Filter by actor email (substring search) |
| `status` | string | No | Filter by status: `success` or `failure` |
| `page` | number | No | Page number (default: 1) |
| `pageSize` | number | No | Results per page |
| `startDate` | string | No | Start of date range (ISO format) |
| `endDate` | string | No | End of date range (ISO format) |
| `type` | string | No | If `'archives'` → list archived audit files |

### Response Structure

**Audit Logs:**
```json
{
  "logs": [
    {
      "id": "...",
      "masterName": "products",
      "operation": "bulk-update",
      "actor": "admin@company.com",
      "status": "success",
      "affectedRecords": 150,
      "timestamp": "2025-05-08T10:30:00+05:30",
      "details": { "mode": "upsert" }
    }
  ],
  "page": 1,
  "pageSize": 25,
  "total": 340
}
```

**Archives:**
```json
{
  "archives": [
    {
      "fileName": "audit-2025-04-archive.csv.gz",
      "recordCount": 5000,
      "archivedAt": "2025-05-01T03:00:00Z",
      "downloadUrl": "https://...",
      "expiresAt": "2025-05-02T03:00:00Z",
      "isExpired": false,
      "daysUntilExpiry": 12
    }
  ],
  "summary": { "totalArchives": 5, "totalRecords": 25000 }
}
```

## Architecture & Data Flow

### Query Optimization

Two paths based on filter complexity:

**Fast Path** (DB-level pagination): When only `masterName`, `status`, `startDate`/`endDate` filters are used — all can be expressed as MongoDB query operators efficiently.

**Slow Path** (regex search): When `operation` or `actor` substring search is needed — uses `$regex` with `$options: 'i'` for case-insensitive matching.

```javascript
// Fast path: exact match filters
const query = { masterName: 'products', status: 'success' }

// Slow path: regex for substring search
const query = {
  $and: [
    { operation: { $regex: 'bulk', $options: 'i' } },
    { actor: { $regex: 'admin', $options: 'i' } }
  ]
}
```

## Security Considerations

- **Read-Only**: Audit logs cannot be modified through this action
- **Regex Escaping**: User filter values are escaped to prevent ReDoS
- **Pre-signed URLs**: Archive download links expire (24h max)

## Related Features

- [Audit Cleanup](./audit-cleanup.md) — Archival and purge of old logs
- [Dashboard](../infrastructure/dashboard.md) — Shows recent logs and alert count

---
*Last updated: 2025-05-08*
*Source: `actions/audit-list/index.js`*
