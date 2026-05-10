---
title: "Dashboard"
sidebar_position: 30
description: "Technical documentation for the Dashboard feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/pimapp/blob/main/actions/dashboard/index.js
---

> Admin dashboard summary statistics with state-based caching (15-minute TTL) for fast page loads.

## Overview

The Dashboard action computes and serves summary statistics for the Admin UI home page. It aggregates data from multiple collections in parallel and caches results in `aio-lib-state` to ensure sub-second response times for repeated requests.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `dashboard` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `dashboard` |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `forceRefresh` | boolean | No | Bypass cache and recompute (default: false) |

### Response Structure

```json
{
  "dashboard": {
    "totalFiles": 12,
    "publicApis": 5,
    "privateApis": 7,
    "totalRecords": 45000,
    "auditAlerts": 3,
    "recentUploads": [
      { "masterName": "products", "recordCount": 1250, "updatedAt": "..." }
    ],
    "recentLogs": [
      { "operation": "bulk-update", "master": "orders", "timestamp": "..." }
    ],
    "masters": [
      { "masterName": "products", "recordCount": 1250, "visibility": "public" }
    ]
  },
  "_cached": true,
  "_cachedAt": "2025-05-08T10:15:00Z"
}
```

## Architecture & Data Flow

### Parallel Data Aggregation

```javascript
const [masters, recentLogs, alertCount] = await Promise.all([
  metaCol.find({ status: { $ne: 'deleted' } }).toArray(),
  auditCol.find().sort({ timestamp: -1 }).limit(10).toArray(),
  auditCol.countDocuments({ status: 'failure' })
])
```

### Caching Strategy

- **Cache key**: `dashboard-cache`
- **TTL**: 15 minutes (configurable via `METRICS_CACHE_TTL_MINUTES`)
- **Bypass**: `forceRefresh=true` skips cache read, always writes fresh data
- **Response flag**: `_cached: true/false` indicates whether data was served from cache

## Related Features

- [Infra Metrics](./infra-metrics.md) — Detailed infrastructure reports
- [Audit List](../administration/audit-list.md) — Full audit log browsing

---
*Last updated: 2025-05-08*
*Source: `actions/dashboard/index.js`*
