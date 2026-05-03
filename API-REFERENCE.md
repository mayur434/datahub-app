# MDM Public API Reference

All operations are exposed via **Adobe API Mesh** as a single GraphQL endpoint.

> **Tip:** Import the [Postman Collection](PIM-API.postman_collection.json) for ready-to-run requests with example responses.

## Endpoint

```
POST https://edge-sandbox-graph.adobe.io/api/<YOUR_MESH_ID>/graphql
```

## Authentication

All **write operations** (create, update, patch, delete) require partner credentials in headers:

| Header | Description |
|--------|-------------|
| `x-partner-id` | Your partner ID |
| `x-partner-key` | Your partner API key |
| `Content-Type` | `application/json` |

**Read operations** (query, record, bulk fetch, facets) are publicly accessible for public masters.

## Prerequisites

For write operations to work, the master must:
1. Have **visibility** set to `public`
2. Have **CRUD enabled** in the Admin Console
3. The partner must be **authorized** for the specific master

---

## Single Record Operations

### 1. Query Records (List)

Paginated listing with optional filtering, sorting, and field selection.

```graphql
{
  mdmQuery(
    master: "productcatalog"
    page: 1
    pageSize: 10
    sort: "name"
    order: "asc"
    fields: "master_id,sku,name,price"
    filters: "sku=CFG-TSHIRT"
    facets: "true"
  ) {
    master
    count
    page
    pageSize
    total
    data
  }
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` | String! | Yes | Master name |
| `page` | Int | No | Page number (default: 1) |
| `pageSize` | Int | No | Records per page (default: from settings) |
| `sort` | String | No | Field to sort by (default: primary key) |
| `order` | String | No | `asc` or `desc` (default: asc) |
| `fields` | String | No | Comma-separated field names to return |
| `filters` | String | No | Filter as `key=value` pairs separated by `,` or `&` |
| `facets` | String | No | `true` to include facet aggregations |

**Filter syntax (via `filters` param):**
- Key-value: `sku=CFG-TSHIRT`
- Multiple: `sku=CFG-TSHIRT,price=599.0` or `sku=CFG-TSHIRT&price=599.0`

> **Note:** JSON filter syntax (e.g. `{"sku":"value"}`) is NOT supported via API Mesh due to URL encoding limitations. Use `key=value` syntax instead.

**Response:**
```json
{
  "data": {
    "mdmQuery": {
      "master": "productcatalog",
      "count": 2,
      "page": 1,
      "pageSize": 10,
      "total": 48,
      "data": [
        { "master_id": "abc-123", "sku": "CFG-TSHIRT", "name": "T-Shirt", "price": "599.0" }
      ]
    }
  }
}
```

---

### 2. Get Single Record

Fetch a single record by its primary key value.

```graphql
{
  mdmRecord(
    master: "productcatalog"
    id: "abc-123-uuid"
  ) {
    master
    data
  }
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` | String! | Yes | Master name |
| `id` | String! | Yes | Primary key value of the record |

**Response:**
```json
{
  "data": {
    "mdmRecord": {
      "master": "productcatalog",
      "data": {
        "master_id": "abc-123-uuid",
        "sku": "CFG-TSHIRT",
        "name": "Classic T-Shirt",
        "price": "599.0"
      }
    }
  }
}
```

---

### 3. Create Record

Create a single new record. The `data` field is a **JSON-encoded string** of the record object.

```graphql
mutation {
  mdmCreate(
    master: "productcatalog"
    input: {
      data: "{\"master_id\":\"NEW-001\",\"sku\":\"NEW-SKU\",\"name\":\"New Product\",\"price\":\"99.99\"}"
    }
  ) {
    success
    master
    operation
    record
    error
  }
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` | String! | Yes | Master name |
| `input.data` | String! | Yes | JSON string of the record object |

**Rules:**
- The primary key field (e.g. `master_id`) must be included and unique
- System fields (`createdAt`, `updatedAt`, `createdBy`, `updatedBy`) are auto-managed and stripped if sent
- Schema validation is applied if the master has a schema defined

**Response (201):**
```json
{
  "data": {
    "mdmCreate": {
      "success": true,
      "master": "productcatalog",
      "operation": "create",
      "record": {
        "master_id": "NEW-001",
        "sku": "NEW-SKU",
        "name": "New Product",
        "price": "99.99",
        "_createdAt": "2026-05-02T20:00:00+05:30",
        "_createdBy": "partner:DEPT"
      },
      "error": null
    }
  }
}
```

---

### 4. Update Record (Full Replace)

Replaces the entire record data. All fields must be provided.

```graphql
mutation {
  mdmUpdate(
    master: "productcatalog"
    id: "NEW-001"
    input: {
      data: "{\"master_id\":\"NEW-001\",\"sku\":\"NEW-SKU\",\"name\":\"Updated Product\",\"price\":\"149.99\"}"
    }
  ) {
    success
    master
    operation
    record
    error
  }
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` | String! | Yes | Master name |
| `id` | String! | Yes | Primary key value of the record to update |
| `input.data` | String! | Yes | JSON string of the complete record object |

**Response:**
```json
{
  "data": {
    "mdmUpdate": {
      "success": true,
      "master": "productcatalog",
      "operation": "update",
      "record": { "master_id": "NEW-001", "sku": "NEW-SKU", "name": "Updated Product", "price": "149.99" },
      "error": null
    }
  }
}
```

---

### 5. Patch Record (Partial Update)

Merges provided fields into the existing record. Only send fields you want to change.

```graphql
mutation {
  mdmPatch(
    master: "productcatalog"
    id: "NEW-001"
    input: {
      data: "{\"price\":\"199.99\",\"tags\":\"on-sale\"}"
    }
  ) {
    success
    master
    operation
    record
    error
  }
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` | String! | Yes | Master name |
| `id` | String! | Yes | Primary key value of the record to patch |
| `input.data` | String! | Yes | JSON string of fields to merge |

**Response:**
```json
{
  "data": {
    "mdmPatch": {
      "success": true,
      "master": "productcatalog",
      "operation": "patch",
      "record": { "master_id": "NEW-001", "sku": "NEW-SKU", "name": "Updated Product", "price": "199.99", "tags": "on-sale" },
      "error": null
    }
  }
}
```

---

### 6. Delete Record (Soft Delete)

Soft-deletes a record. The record is marked as deleted but not physically removed.

```graphql
mutation {
  mdmDelete(
    master: "productcatalog"
    id: "NEW-001"
  ) {
    success
    master
    operation
    id
    error
  }
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` | String! | Yes | Master name |
| `id` | String! | Yes | Primary key value of the record to delete |

**Response:**
```json
{
  "data": {
    "mdmDelete": {
      "success": true,
      "master": "productcatalog",
      "operation": "delete",
      "id": "NEW-001",
      "error": null
    }
  }
}
```

---

### 7. Get Facets

Retrieve facet/aggregation data for a master (must have facets configured in Admin Console).

```graphql
{
  mdmFacets(
    master: "productcatalog"
    values: "true"
    filters: "category=Fashion"
  ) {
    master
    facetsEnabled
    facetableFields
    totalRecords
    facets {
      field
      label
      type
      values {
        value
        count
      }
    }
  }
}
```

---

## Bulk Operations

All bulk mutations accept a `data` field containing a **JSON-encoded string of an array**.

### 8. Bulk Fetch (Multiple Records by IDs)

Fetch multiple records in a single request by passing comma-separated IDs.

```graphql
{
  mdmBulkFetch(
    master: "productcatalog"
    ids: "ID-001,ID-002,ID-003"
  ) {
    master
    count
    requested
    data
    notFound
  }
}
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `master` | String! | Yes | Master name |
| `ids` | String! | Yes | Comma-separated primary key values |

**Response:**
```json
{
  "data": {
    "mdmBulkFetch": {
      "master": "productcatalog",
      "count": 2,
      "requested": 3,
      "data": [
        { "master_id": "ID-001", "sku": "SKU-001", "name": "Product 1" },
        { "master_id": "ID-002", "sku": "SKU-002", "name": "Product 2" }
      ],
      "notFound": ["ID-003"]
    }
  }
}
```

---

### 9. Bulk Create

Create multiple records in a single request. The `data` field is a JSON string of an **array of record objects**.

```graphql
mutation {
  mdmBulkCreate(
    master: "productcatalog"
    input: {
      data: "[{\"master_id\":\"BLK-001\",\"sku\":\"SKU-001\",\"name\":\"Product 1\",\"price\":\"100\"},{\"master_id\":\"BLK-002\",\"sku\":\"SKU-002\",\"name\":\"Product 2\",\"price\":\"200\"},{\"master_id\":\"BLK-003\",\"sku\":\"SKU-003\",\"name\":\"Product 3\",\"price\":\"300\"}]"
    }
  ) {
    master
    operation
    total
    succeeded
    failed
    results {
      success
      id
      error
    }
  }
}
```

**Data format:** Array of record objects. Each object must include the primary key field.

```json
[
  { "master_id": "BLK-001", "sku": "SKU-001", "name": "Product 1", "price": "100" },
  { "master_id": "BLK-002", "sku": "SKU-002", "name": "Product 2", "price": "200" }
]
```

**Response:**
```json
{
  "data": {
    "mdmBulkCreate": {
      "master": "productcatalog",
      "operation": "bulkCreate",
      "total": 3,
      "succeeded": 3,
      "failed": 0,
      "results": [
        { "success": true, "id": "BLK-001", "error": null },
        { "success": true, "id": "BLK-002", "error": null },
        { "success": true, "id": "BLK-003", "error": null }
      ]
    }
  }
}
```

---

### 10. Bulk Update (Full Replace)

Update multiple records in a single request. Each item must have `id` and complete `data`.

```graphql
mutation {
  mdmBulkUpdate(
    master: "productcatalog"
    input: {
      data: "[{\"id\":\"BLK-001\",\"data\":{\"master_id\":\"BLK-001\",\"sku\":\"SKU-001\",\"name\":\"Updated 1\",\"price\":\"999\"}},{\"id\":\"BLK-002\",\"data\":{\"master_id\":\"BLK-002\",\"sku\":\"SKU-002\",\"name\":\"Updated 2\",\"price\":\"888\"}}]"
    }
  ) {
    master
    operation
    total
    succeeded
    failed
    results {
      success
      id
      error
    }
  }
}
```

**Data format:** Array of `{ id, data }` objects. `data` is the complete replacement record.

```json
[
  { "id": "BLK-001", "data": { "master_id": "BLK-001", "sku": "SKU-001", "name": "Updated 1", "price": "999" } },
  { "id": "BLK-002", "data": { "master_id": "BLK-002", "sku": "SKU-002", "name": "Updated 2", "price": "888" } }
]
```

---

### 11. Bulk Patch (Partial Update)

Partially update multiple records. Only the fields in `data` are merged into existing records.

```graphql
mutation {
  mdmBulkPatch(
    master: "productcatalog"
    input: {
      data: "[{\"id\":\"BLK-001\",\"data\":{\"price\":\"555\",\"tags\":\"patched\"}},{\"id\":\"BLK-002\",\"data\":{\"price\":\"777\",\"tags\":\"patched\"}}]"
    }
  ) {
    master
    operation
    total
    succeeded
    failed
    results {
      success
      id
      error
    }
  }
}
```

**Data format:** Array of `{ id, data }` objects. `data` contains only the fields to change.

```json
[
  { "id": "BLK-001", "data": { "price": "555", "tags": "patched" } },
  { "id": "BLK-002", "data": { "price": "777", "tags": "patched" } }
]
```

---

### 12. Bulk Delete

Delete multiple records in a single request. The `data` field is a JSON string of an **array of ID strings**.

```graphql
mutation {
  mdmBulkDelete(
    master: "productcatalog"
    input: {
      data: "[\"BLK-001\",\"BLK-002\",\"BLK-003\"]"
    }
  ) {
    master
    operation
    total
    succeeded
    failed
    results {
      success
      id
      error
    }
  }
}
```

**Data format:** Array of primary key strings.

```json
["BLK-001", "BLK-002", "BLK-003"]
```

**Response:**
```json
{
  "data": {
    "mdmBulkDelete": {
      "master": "productcatalog",
      "operation": "bulkDelete",
      "total": 3,
      "succeeded": 3,
      "failed": 0,
      "results": [
        { "success": true, "id": "BLK-001", "error": null },
        { "success": true, "id": "BLK-002", "error": null },
        { "success": true, "id": "BLK-003", "error": null }
      ]
    }
  }
}
```

---

## Error Handling

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created (single create) |
| 400 | Bad request (missing/invalid params) |
| 401 | Unauthorized (invalid partner credentials) |
| 403 | Forbidden (private master, CRUD disabled, or unauthorized partner) |
| 404 | Not found (master or record) |
| 405 | Method not allowed |
| 409 | Conflict (duplicate primary key on create) |
| 429 | Rate limit exceeded |
| 507 | Storage limit reached |

### Bulk Error Handling

Bulk operations process each item independently. If some items fail, the response includes per-item results with individual error messages. The operation does NOT roll back successful items.

```json
{
  "total": 3,
  "succeeded": 1,
  "failed": 2,
  "results": [
    { "success": true, "id": "BLK-001", "error": null },
    { "success": false, "id": "BLK-002", "error": "Already exists" },
    { "success": false, "id": "MISSING", "error": "Not found" }
  ]
}
```

---

## Caching

| Operation | Cache |
|-----------|-------|
| Read queries (GET) | CDN cached: `max-age=60, s-maxage=900` (15 min edge cache) |
| Mutations (POST/PUT/PATCH/DELETE) | `no-store` (never cached) |

After mutations, read queries may return stale data for up to 15 minutes due to CDN caching.

---

## Quick Reference

| Operation | GraphQL Field | Type | Auth Required |
|-----------|--------------|------|---------------|
| List records | `mdmQuery` | Query | No (public masters) |
| Get single record | `mdmRecord` | Query | No (public masters) |
| Fetch multiple by IDs | `mdmBulkFetch` | Query | No (public masters) |
| Get facets | `mdmFacets` | Query | No (public masters) |
| Create single | `mdmCreate` | Mutation | Partner credentials |
| Update single (full) | `mdmUpdate` | Mutation | Partner credentials |
| Patch single (partial) | `mdmPatch` | Mutation | Partner credentials |
| Delete single | `mdmDelete` | Mutation | Partner credentials |
| Bulk create | `mdmBulkCreate` | Mutation | Partner credentials |
| Bulk update (full) | `mdmBulkUpdate` | Mutation | Partner credentials |
| Bulk patch (partial) | `mdmBulkPatch` | Mutation | Partner credentials |
| Bulk delete | `mdmBulkDelete` | Mutation | Partner credentials |
