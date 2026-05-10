---
title: "Query Data"
sidebar_position: 11
description: "Technical documentation for the Query Data feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/pimapp/blob/main/actions/query-data/index.js
---

> Real-time database query engine for the Admin UI providing paginated record browsing with filtering, sorting, field projection, and single-record lookups.

## Overview

The Query Data action serves as the primary read interface for the Admin UI's record browsing capabilities. Unlike the public API (`mdm-data`) which includes caching and partner authentication, this action provides **real-time, uncached** access directly from the database — essential for admin workflows where data freshness is critical.

It supports paginated listing with database-level filtering (regex-based case-insensitive search), multi-field sorting, field projection (selecting specific columns), and single-record fetch by ID.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `query-data` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `masters` OR `query_console` OR `record_management` |
| **HTTP Methods** | GET, POST, OPTIONS |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` | string | Yes | Target master collection name |
| `id` | string | No | Fetch single record by primary key |
| `page` | number | No | Page number (default: 1) |
| `pageSize` | number | No | Records per page (default: from settings, max: from settings) |
| `sort` | string | No | Field name to sort by |
| `order` | string | No | Sort direction: `asc` or `desc` (default: `desc`) |
| `fields` | string | No | Comma-separated field names to return (projection) |
| `filter` | string | No | Simple filter: `fieldName=value` |
| `filters` | string/object | No | Complex filters: JSON object `{ field: value, ... }` |
| `includeMeta` | boolean | No | Include master metadata in response |

### Response Structure

**Paginated List:**
```json
{
  "master": "products",
  "count": 25,
  "page": 1,
  "pageSize": 25,
  "total": 1250,
  "data": [
    {
      "product_id": "PROD-00001",
      "name": "Widget A",
      "price": 29.99,
      "_createdAt": "2025-05-08T10:30:00+05:30"
    }
  ],
  "file": { "...master metadata if includeMeta=true..." }
}
```

**Single Record:**
```json
{
  "master": "products",
  "record": {
    "product_id": "PROD-00001",
    "name": "Widget A",
    "price": 29.99,
    "category": "Hardware",
    "_createdAt": "2025-05-08T10:30:00+05:30",
    "_updatedAt": "2025-05-08T10:30:00+05:30"
  }
}
```

### Error Codes

| Code | Condition | Response |
|------|-----------|----------|
| 400 | Missing `master` parameter | `{ error: "Missing required parameter: master" }` |
| 403 | User lacks required permission | `{ error: "Access denied" }` |
| 404 | Master not found | `{ error: "Master 'xyz' not found" }` |
| 404 | Record not found (single fetch) | `{ error: "Record not found" }` |

## Architecture & Data Flow

### Query Execution Pipeline

```
Request Parameters
    │
    ▼
┌──────────────────────────┐
│ Parse & Normalize Params │
│ • page/pageSize defaults │
│ • Parse filters JSON     │
│ • Validate sort field    │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│ Build MongoDB Query      │
│ • Exclude system params  │
│ • Build $regex filters   │
│ • Case-insensitive match │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│ Execute in Parallel:     │
│ • countDocuments(filter) │
│ • find().sort().skip()   │
│   .limit()               │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│ Post-Process Results     │
│ • Apply field projection │
│ • Strip system fields    │
│ • Build pagination meta  │
└──────────────────────────┘
```

### Filter Mechanics

Filters are converted to **case-insensitive regex queries** at the database level:

```javascript
// Input: filters = { name: "widget", category: "hardware" }
// Becomes MongoDB query:
{
  name: { $regex: 'widget', $options: 'i' },
  category: { $regex: 'hardware', $options: 'i' },
  _deleted: { $ne: true }  // Always exclude soft-deleted
}
```

**System parameters excluded from filters:** `master`, `page`, `pageSize`, `sort`, `order`, `fields`, `filter`, `filters`, `includeMeta`, `id`, `__ow_method`, `__ow_headers`, `__ow_path`

### Database Operations

| Operation | Purpose | Complexity |
|-----------|---------|------------|
| `countDocuments(filter)` | Total matching records (for pagination) | O(n) with filter |
| `find(filter).sort(sortObj).skip(offset).limit(pageSize)` | Paginated results | Uses indexes |
| `safeFindOne({ [pkField]: id })` | Single record by PK | O(1) with index |

### Dependencies

| Module | Purpose |
|--------|---------|
| `../mdm-utils` | DB client, RBAC, settings, collection helpers |

## Code Walkthrough

### Core Logic

```javascript
async function main(params) {
  if (params.__ow_method === 'options') return createResponse({})
  
  const client = await getDbClient(params)
  try {
    await enforceAppPermission(client, params, 'query-data')
    
    const { master, id, page = 1, pageSize, sort, order, fields, filters } = params
    const settings = await getCachedSettings(client, params)
    const effectivePageSize = Math.min(pageSize || settings.defaultPageSize, settings.maxPageSize)
    
    // Single record fetch
    if (id) {
      const record = await safeFindOne(masterCol, { [pkField]: id })
      if (!record) return createErrorResponse('Record not found', 404)
      return createResponse({ master, record })
    }
    
    // Build query (excluding system params, adding regex)
    const query = buildFilterQuery(params, filters)
    query._deleted = { $ne: true }
    
    // Execute paginated query
    const [total, data] = await Promise.all([
      masterCol.countDocuments(query),
      masterCol.find(query)
        .sort({ [sort || '_updatedAt']: order === 'asc' ? 1 : -1 })
        .skip((page - 1) * effectivePageSize)
        .limit(effectivePageSize)
    ])
    
    // Apply field projection in JS (if specified)
    const projected = fields ? projectFields(data, fields.split(',')) : data
    
    return createResponse({ master, count: projected.length, page, pageSize: effectivePageSize, total, data: projected })
  } finally {
    await client.close()
  }
}
```

### Key Functions

**`buildFilterQuery(params, filters)`** — Constructs MongoDB query from user-provided filters, escaping regex special characters and wrapping values in case-insensitive regex patterns.

**`projectFields(records, fieldNames)`** — Client-side field selection that returns only specified keys from each record.

## Security Considerations

- **Regex Escaping**: All filter values are escaped via `escapeRegex()` to prevent ReDoS attacks
- **Soft-Delete Awareness**: All queries automatically exclude `_deleted: true` records
- **No Direct Aggregation**: Unlike `mdm-facets`, this action doesn't expose aggregation pipeline to prevent injection
- **Page Size Limits**: Enforced maximum prevents memory exhaustion from unbounded queries
- **System Field Exclusion**: Internal fields (`__ow_*`) cannot be used as filter keys

## Configuration

| Setting | Source | Default | Impact |
|---------|--------|---------|--------|
| Default page size | `DEFAULT_PAGE_SIZE` / settings | 25 | Records per page |
| Max page size | `MAX_PAGE_SIZE` / settings | 500 | Upper limit per request |
| Query timeout | `QUERY_TIMEOUT` | 30000ms | DB operation timeout |

## Related Features

- [Record CRUD](./record-crud.md) — Write operations on the same data
- [MDM Data (Public API)](../public-api/mdm-data.md) — External read API with caching
- [MDM Facets](../public-api/mdm-facets.md) — Aggregation queries for faceted search
- [File Detail](./file-operations.md) — Master metadata (schema, config)

---
*Last updated: 2025-05-08*
*Source: `actions/query-data/index.js`*
