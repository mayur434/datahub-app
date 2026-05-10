---
title: "MDM Data (Public API)"
sidebar_position: 20
description: "Technical documentation for the MDM Data (Public API) feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/pimapp/blob/main/actions/mdm-data/index.js
---

> Single external-facing API endpoint for all data consumption and mutation operations, with partner authentication, rate limiting, and response caching.

## Overview

The MDM Data action is the **public API gateway** exposed via Adobe API Mesh. It is the single entry point for external systems to read and write master data. Unlike internal admin actions, this endpoint:

- **Does NOT require Adobe IMS** for reading public entities
- **Uses partner credentials** (`x-partner-id` + `x-partner-key`) for write operations
- **Implements rate limiting** per partner
- **Strips system audit fields** from responses
- **Adds cache headers** for CDN/proxy caching

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `mdm-data` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | None (public reads) / Partner Key (writes) / IMS (private reads) |
| **RBAC Permission** | N/A (partner-based auth) |
| **HTTP Methods** | GET, POST, OPTIONS |
| **Cache-Control** | `public, max-age=60` |
| **require-adobe-auth** | `false` |

### Input Parameters

#### Read Operations

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` / `entity` | string | Yes | Target master |
| `id` | string | No | Single record by PK |
| `ids` | string/array | No | Bulk fetch by PK list (comma-separated or array) |
| `page` | number | No | Page number |
| `pageSize` | number | No | Records per page |
| `sort` | string | No | Sort field |
| `order` | string | No | `asc` or `desc` |
| `fields` | string | No | Field projection (CSV) |
| `filter` / `filters` | string/object | No | Query filters |

#### Write Operations (requires partner auth)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `operation` | string | Yes | `create`, `update`, `patch`, `delete`, `bulkCreate`, `bulkUpdate`, `bulkPatch`, `bulkDelete` |
| `data` | object/array | Yes | Record(s) to mutate |

#### Authentication Headers (for writes)

| Header | Description |
|--------|-------------|
| `x-partner-id` | Partner identifier (e.g., `ptr_abc123`) |
| `x-partner-key` | Partner secret key (e.g., `pk_...48chars`) |
| `authorization` | Bearer token (for private entity reads) |

### Response Structure

**Single Record:**
```json
{
  "master": "products",
  "record": {
    "product_id": "PROD-001",
    "name": "Widget A",
    "price": 29.99
  }
}
```

**Paginated List:**
```json
{
  "master": "products",
  "data": [...],
  "page": 1,
  "pageSize": 25,
  "total": 1250
}
```

**Bulk Fetch:**
```json
{
  "master": "products",
  "data": [...],
  "found": 8,
  "notFound": ["PROD-999"]
}
```

### Error Codes

| Code | Condition | Response |
|------|-----------|----------|
| 401 | Invalid/missing partner credentials | `{ error: "Authentication required" }` |
| 403 | Private entity without auth | `{ error: "This entity requires authentication" }` |
| 403 | Partner not allowed for this master | `{ error: "Partner not authorized for this entity" }` |
| 404 | Entity/record not found | `{ error: "Not found" }` |
| 429 | Rate limit exceeded | `{ error: "Rate limit exceeded. Try again in X seconds" }` |

## Architecture & Data Flow

### Read Flow (Public Entity)

```
External Request (no auth needed)
    │
    ▼
┌──────────────────────────────┐
│ 1. Resolve entity metadata   │
│    Check visibility=public   │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 2. Build query from params   │
│    Apply filters, sort, page │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 3. Execute query             │
│    Strip _createdBy etc.     │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 4. Return with cache headers │
│    Cache-Control: max-age=60 │
└──────────────────────────────┘
```

### Write Flow (Partner Auth)

```
External Request
    │
    ▼
┌──────────────────────────────┐
│ 1. Extract partner headers   │
│    x-partner-id + key        │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 2. Validate partner          │
│    • Exists in partners col  │
│    • Status = active         │
│    • Key matches (hashed)    │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 3. Check rate limit          │
│    state cache per partner   │
│    → 429 if exceeded         │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 4. Check allowedMasters      │
│    Partner scoped to specific│
│    entities only             │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 5. Execute mutation          │
│    (same logic as internal   │
│     record-crud/bulk-update) │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 6. Publish mutation event    │
│ 7. Return result             │
└──────────────────────────────┘
```

### Rate Limiting Implementation

```javascript
// State-based sliding window (per partner, per minute)
const key = `rate-${partnerId}`
const current = await state.get(key)
if (current && current.count >= RATE_LIMIT_PER_MINUTE) {
  return createErrorResponse('Rate limit exceeded', 429)
}
await state.put(key, { count: (current?.count || 0) + 1 }, { ttl: 60 })
```

## Security Considerations

- **No IMS for Public Reads**: Intentional — enables CDN caching and anonymous access
- **Partner Key Hashing**: Keys stored hashed; validated via constant-time comparison
- **Rate Limiting**: Per-partner sliding window prevents abuse
- **Field Stripping**: `_createdBy`, `_updatedBy`, `_deletedBy` never exposed externally
- **Master Scoping**: Partners can only access their `allowedMasters`
- **CORS Headers**: Configurable origin restrictions

## Configuration

| Setting | Source | Default | Impact |
|---------|--------|---------|--------|
| Rate limit | `RATE_LIMIT_PER_MINUTE` | 60 | Requests per partner/min |
| Cache TTL | `API_MESH_CACHE_TTL` | 60 | Response cache seconds |
| Page size | Settings | 25 / 500 max | Pagination defaults |

## Related Features

- [MDM Facets](./mdm-facets.md) — Public facet/aggregation API
- [Partner Management](../administration/partner-management.md) — Managing partner credentials
- [Record CRUD](../data-management/record-crud.md) — Internal equivalent
- [Publish Events](../infrastructure/publish-events.md) — Mutation event publishing

---
*Last updated: 2025-05-08*
*Source: `actions/mdm-data/index.js`*
