---
title: "MDM Facets (Public API)"
sidebar_position: 21
description: "Technical documentation for the MDM Facets (Public API) feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/datahub-app/blob/main/actions/mdm-facets/index.js
---

> Public API for faceted search configuration and live aggregation values with OR-style faceting and filtered counts.

## Overview

The MDM Facets action provides the public-facing faceted search capability. It returns facet field configuration and, optionally, live aggregated values (distinct values with counts) computed via MongoDB aggregation pipelines. Supports "OR-style" faceting where selecting a value within a facet doesn't reduce that facet's own options.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `mdm-facets` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | None (public entities) / IMS (private) |
| **require-adobe-auth** | `false` |
| **Cache-Control** | `public, max-age=30` |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` / `entity` | string | Yes | Target master |
| `values` | boolean | No | If `true`, compute live facet values with counts |
| `filters` | string/object | No | Active filters (for contextual counts) |

### Response Structure

```json
{
  "master": "products",
  "facetsEnabled": true,
  "facets": [
    {
      "field": "category",
      "label": "Category",
      "type": "string",
      "sortBy": "count",
      "sortOrder": "desc",
      "limit": 20,
      "values": [
        { "value": "Electronics", "count": 450, "selected": true },
        { "value": "Clothing", "count": 320, "selected": false }
      ]
    }
  ],
  "totalRecords": 1250
}
```

## Architecture & Data Flow

### Aggregation Pipeline (per facet field)

```javascript
// For each facetable field, run:
collection.aggregate([
  { $match: baseFilter },           // Apply all OTHER facet filters (OR-style)
  { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  { $sort: { count: -1 } },         // Or alphabetical based on config
  { $limit: facetConfig.limit || 20 }
])
```

### OR-Style Faceting Logic

When computing values for facet field `category`:
- Apply filters from ALL other facets (brand, price_range, etc.)
- Do NOT apply the `category` filter itself
- This ensures all category options remain visible even when one is selected

## Security Considerations

- **No aggregation injection**: Pipeline is built server-side from config; user only controls filter values
- **Regex escaping**: Filter values escaped before use in `$match`
- **Value limits**: Each facet capped at configured `limit` (default 20 values)

## Related Features

- [MDM Data](./mdm-data.md) — Data retrieval API
- [Schema Update](../data-management/schema-update.md) — Facet field configuration (`update-facets`)

---
*Last updated: 2025-05-08*
*Source: `actions/mdm-facets/index.js`*
