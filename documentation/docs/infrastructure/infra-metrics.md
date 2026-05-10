---
title: "Infrastructure Metrics"
sidebar_position: 34
description: "Technical documentation for the Infrastructure Metrics feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/datahub-app/blob/main/actions/infra-metrics/index.js
---

> Comprehensive infrastructure monitoring with six report types covering storage, guardrails, failures, analytics, usage patterns, and system overview.

## Overview

The Infra Metrics action powers the Admin Console's monitoring dashboard. It provides detailed infrastructure reports computed from database statistics and audit logs, with state-based caching for performance.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `infra-metrics` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `admin_console` |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `report` | string | Yes | `storage`, `guardrails`, `failures`, `analytics`, `usage`, `overview` |
| `forceRefresh` | boolean | No | Bypass metrics cache |
| `days` | number | No | Time window for failures/analytics (default: 7) |

### Report Types

#### `storage` — Storage Breakdown
```json
{
  "report": "storage",
  "totalStorageMB": 245.5,
  "maxStorageMB": 500,
  "utilizationPercent": 49.1,
  "collections": [
    { "name": "mdm_products", "docCount": 1250, "estimatedSizeMB": 45.2 },
    { "name": "mdm_orders", "docCount": 8500, "estimatedSizeMB": 120.0 }
  ],
  "systemCollections": [
    { "name": "audit", "docCount": 5000, "estimatedSizeMB": 12.5 }
  ]
}
```

#### `guardrails` — Limits Status
```json
{
  "report": "guardrails",
  "checks": [
    {
      "name": "Total Storage",
      "current": 245.5,
      "limit": 500,
      "unit": "MB",
      "percent": 49.1,
      "status": "healthy"
    },
    {
      "name": "Collection Count",
      "current": 15,
      "limit": 50,
      "percent": 30,
      "status": "healthy"
    }
  ],
  "overallStatus": "healthy"
}
```

Status thresholds: `healthy` (< 70%), `warning` (70-90%), `critical` (> 90%)

#### `failures` — Failure Analytics
```json
{
  "report": "failures",
  "period": "7 days",
  "totalFailures": 12,
  "byOperation": { "bulk-update": 5, "full-update": 3, "record-crud": 4 },
  "byMaster": { "products": 7, "orders": 5 },
  "recentFailures": [...]
}
```

#### `analytics` — Action Invocation Patterns
```json
{
  "report": "analytics",
  "period": "7 days",
  "totalInvocations": 1500,
  "byOperation": { "query-data": 800, "record-crud": 400, "dashboard": 300 },
  "byDay": [{ "date": "2025-05-08", "count": 220 }]
}
```

#### `usage` — Throughput Metrics
```json
{
  "report": "usage",
  "reads": 12000,
  "writes": 3500,
  "cacheHitRate": 0.82,
  "avgResponseTime": 145
}
```

#### `overview` — Combined Summary
```json
{
  "report": "overview",
  "health": {
    "database": "healthy",
    "guardrails": "healthy",
    "operations": "warning",
    "apiMesh": "healthy"
  },
  "storage": { "...summary..." },
  "guardrails": { "...summary..." },
  "recentFailures": 3
}
```

### Caching

- **Cache key**: `metrics-cache` (scoped by report type)
- **TTL**: Configurable via `METRICS_CACHE_TTL_MINUTES` (default: 15 min)
- **Bypass**: `forceRefresh=true`

## Related Features

- [Dashboard](./dashboard.md) — Summary statistics (lighter weight)
- [App Settings](../administration/app-settings.md) — Guardrail configuration
- [Audit List](../administration/audit-list.md) — Raw failure log access

---
*Last updated: 2025-05-08*
*Source: `actions/infra-metrics/index.js`*
