# AEM Master Data Manager - Adobe App Builder MDM Console

## 1. Executive Summary

This document defines the technical and business requirements for building a low-code / no-code Master Data Management (MDM) Admin Console for AEM as a Cloud Service (AEMaaCS) using Adobe App Builder.

The application will act as an admin console for AEM administrators and business users to manage CSV-based master data. Once a CSV file is uploaded and configured, the platform will automatically enable APIs for querying and managing the data.

The solution is intended to behave like a lightweight PIM-style platform where CSV uploads become manageable, versioned, queryable, and API-enabled master data sources.

## 2. Business Objective

### 2.1 Primary Business Goal

Create an MDM platform for AEMaaCS business and admin users where structured master data can be managed through CSV upload instead of custom development.

The platform should allow business users to upload CSV files, configure metadata, expose APIs automatically, manage access controls, perform CRUD operations, maintain versions, and query CSV data using generated API endpoints.

### 2.2 Business Problems Solved

| Current Challenge | Proposed MDM Capability |
|---|---|
| Product, category, store, region, pricing, banner, or lookup data is managed manually | CSV upload and metadata-based management |
| New data APIs require backend development | Auto-generated APIs per uploaded CSV |
| Business teams depend on developers for small master data changes | Admin console enables low-code/no-code operations |
| Data consumers need filtered API responses | Query-param based public/read APIs |
| Data governance is inconsistent | Versioning, access control, audit logs, approval-ready metadata |
| CSV changes are hard to trace | Upload history, delta logs, rollback support |
| Performance depends on repeated parsing/querying | AIO State-based response caching |

### 2.3 Target Users

| Persona | Role |
|---|---|
| AEM Admin | Manages files, permissions, API enablement, public/private flags |
| Business User / Content Admin | Uploads CSV files and updates product/content master data |
| Integration User | Consumes public or private read APIs |
| Developer / App Builder Admin | Maintains runtime actions, deployment, observability |
| Compliance / Ops User | Reviews logs, versions, and access history |
| Product / PIM Owner | Owns schema, data model, lifecycle, and governance |

## 3. Scope

### 3.1 In Scope

The application should support:

1. CSV file upload and management.
2. CSV metadata configuration.
3. CRUD enablement based on file-level metadata.
4. Public read API generation.
5. IMS-token secured Create, Update, Delete, Patch, Bulk, and Admin operations.
6. Full master update.
7. Delta update.
8. Bulk row update.
9. CSV column addition and update.
10. File public/private toggle.
11. File versioning and rollback.
12. Audit logging.
13. Query-param based data filtering.
14. AIO State response caching.
15. Cache TTL configuration from admin UI.
16. API documentation / generated endpoint details.
17. Admin UI with React Spectrum.
18. Integration with AEMaaCS admin/user context.
19. Business-level no-code configuration.

### 3.2 Out of Scope for Initial MVP

The following can be future enhancements:

1. Complex relational joins across multiple CSVs.
2. Real-time streaming ingestion.
3. Full enterprise PIM replacement with DAM workflows, enrichment, AI tagging, or taxonomy governance.
4. External approval workflow engine.
5. Advanced data quality scoring.
6. Row-level RBAC unless explicitly required.
7. GraphQL API auto-generation unless added later through API Mesh.

## 4. Proposed Solution Overview

### 4.1 High-Level Concept

The app will provide an admin UI where users can:

1. Upload a CSV file.
2. Define metadata:
   - File name
   - Business entity type
   - Primary key column
   - Public/private status
   - CRUD enabled/disabled
   - Allowed operations
   - Cache TTL
   - Queryable columns
   - Required columns
   - Data type mapping
   - Versioning policy
3. Save the file and metadata into App Builder Document Database.
4. Automatically expose read/query APIs.
5. Secure write operations using IMS token.
6. Allow AEM or external frontend consumers to read public data.
7. Provide logs, version history, and rollback.

### 4.2 Recommended Technical Foundation

| Layer | Recommended Technology |
|---|---|
| Admin UI | React + React Spectrum |
| Backend APIs | Adobe I/O Runtime actions |
| Authentication | Adobe IMS token |
| Master Data Store | App Builder Document Database |
| Cache Store | AIO State |
| Raw File Archive | Optional App Builder Files SDK |
| Logging | Runtime logs + Document DB audit logs |
| Deployment | AIO CLI / CI-CD |
| AEM Integration | AEMaaCS APIs, AEM components, AEM admin user flow |

## 5. Business Requirements

### 5.1 Master Data File Management

The admin user should be able to manage multiple CSV-based master data files.

Example files:

| File | Business Purpose |
|---|---|
| `products.csv` | Product master / PIM-style data |
| `categories.csv` | Category taxonomy |
| `stores.csv` | Store locator data |
| `regions.csv` | Country/region mapping |
| `promotions.csv` | Campaign or offer data |
| `sku-attributes.csv` | Product attribute enrichment |
| `content-mapping.csv` | AEM content-to-product mappings |
| `dealer-master.csv` | Dealer/distributor data |
| `pricing.csv` | Price lookup data |
| `inventory-rules.csv` | Fulfillment or stock rules |

### 5.2 Low-Code / No-Code Requirement

The user should not need to write code to create a new API.

Uploading a CSV and providing metadata should be enough to generate:

1. Entity name.
2. API endpoint.
3. Allowed operations.
4. Queryable fields.
5. Validation rules.
6. Public/private status.
7. Cache TTL.
8. API documentation.
9. Versioning behavior.

Example metadata:

```text
Entity Name: product
Primary Key: sku
Public Read: Yes
Write Operations: IMS Secured
Queryable Fields: sku, category, brand, status, region
Cache TTL: 300 seconds
```

Generated API behavior:

```text
GET    /api/mdm/product
GET    /api/mdm/product?sku=ABC123
GET    /api/mdm/product?category=shoes&brand=nike
POST   /api/mdm/product
PATCH  /api/mdm/product/{sku}
PUT    /api/mdm/product/{sku}
DELETE /api/mdm/product/{sku}
POST   /api/mdm/product/bulk
POST   /api/mdm/product/full-update
POST   /api/mdm/product/delta-update
GET    /api/mdm/product/versions
POST   /api/mdm/product/rollback/{versionId}
```

## 6. Functional Requirements

### 6.1 Admin Dashboard

The dashboard should show:

| Widget | Description |
|---|---|
| Total Files | Total managed CSV master files |
| Public APIs | Count of files exposed publicly |
| Private APIs | Count of secured files |
| Recent Uploads | Recently uploaded/updated files |
| Failed Imports | CSV upload/validation failures |
| Cache Hit Ratio | Cache performance summary |
| API Usage | Read/write request volume |
| Latest Versions | Recently created file versions |
| Audit Alerts | Failed auth, invalid updates, delete attempts |

### 6.2 CSV Upload

Upload flow:

1. Select CSV file.
2. Parse header row.
3. Preview first N rows.
4. Detect columns.
5. Infer field types.
6. Ask user to confirm metadata.
7. Select primary key.
8. Define queryable fields.
9. Define required fields.
10. Define public/private mode.
11. Define allowed CRUD operations.
12. Define cache TTL.
13. Save metadata.
14. Persist parsed records.
15. Generate API metadata.

### 6.3 CSV Validation

Validation should include:

| Validation | Purpose |
|---|---|
| File extension | Only `.csv` allowed |
| File size limit | Prevent large runtime issues |
| Header validation | Required columns must exist |
| Duplicate header check | Avoid ambiguous fields |
| Primary key check | Required for CRUD |
| Duplicate primary key check | Prevent conflicting records |
| Empty primary key check | Ensure addressable records |
| Data type validation | Validate number, string, boolean, date |
| Required field validation | Prevent incomplete records |
| Encoding validation | Ensure UTF-8 compatibility |
| Row limit validation | Protect platform limits |
| Reserved column validation | Prevent conflict with system fields |

Recommended reserved fields:

```text
_id
_entity
_version
_createdAt
_updatedAt
_createdBy
_updatedBy
_deleted
_status
_public
```

### 6.4 Metadata Management

Each uploaded file should have a metadata document.

Suggested metadata model:

```json
{
  "fileId": "product-master",
  "entityName": "product",
  "displayName": "Product Master",
  "originalFileName": "product-master.csv",
  "primaryKey": "sku",
  "status": "active",
  "visibility": "public",
  "crudEnabled": true,
  "allowedOperations": {
    "read": true,
    "create": true,
    "update": true,
    "patch": true,
    "delete": true,
    "bulkUpdate": true,
    "fullUpdate": true,
    "deltaUpdate": true
  },
  "schema": [
    {
      "name": "sku",
      "type": "string",
      "required": true,
      "queryable": true,
      "editable": false
    },
    {
      "name": "brand",
      "type": "string",
      "required": false,
      "queryable": true,
      "editable": true
    }
  ],
  "cache": {
    "enabled": true,
    "ttlSeconds": 300
  },
  "versioning": {
    "enabled": true,
    "retainVersions": 10
  },
  "createdBy": "user@company.com",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### 6.5 CRUD Enablement

CRUD should be controlled by file metadata.

| Operation | Public? | Secured by IMS? | Controlled by Metadata |
|---|---:|---:|---:|
| Read | Yes, if public | Optional if private | Yes |
| Create | No | Yes | Yes |
| Update | No | Yes | Yes |
| Patch | No | Yes | Yes |
| Delete | No | Yes | Yes |
| Bulk Update | No | Yes | Yes |
| Full Update | No | Yes | Yes |
| Delta Update | No | Yes | Yes |
| Version Rollback | No | Yes | Yes |
| Public/Private Toggle | No | Yes | Yes |

### 6.6 Full Master Update

A full master update replaces the active dataset for a given file/entity.

Business behavior:

1. Admin uploads a new complete CSV.
2. System validates schema compatibility.
3. System creates a new version.
4. Existing active records are archived.
5. New records become active.
6. Cache is invalidated.
7. Audit log is created.

Endpoint:

```text
POST /api/mdm/{entity}/full-update
```

Expected processing:

| Step | Action |
|---|---|
| 1 | Validate IMS token |
| 2 | Validate entity metadata |
| 3 | Validate full CSV |
| 4 | Create version snapshot |
| 5 | Replace active records |
| 6 | Rebuild indexes if required |
| 7 | Invalidate AIO State cache |
| 8 | Return import summary |

Example response:

```json
{
  "entity": "product",
  "operation": "full-update",
  "versionId": "v12",
  "inserted": 1200,
  "updated": 0,
  "deleted": 30,
  "failed": 0,
  "status": "success"
}
```

### 6.7 Delta Update

A delta update updates only changed rows.

Supported delta modes:

| Mode | Behavior |
|---|---|
| Upsert | Insert if new, update if existing |
| Update Only | Reject new primary keys |
| Insert Only | Reject existing primary keys |
| Delete Marker | Delete rows marked with action column |
| Mixed Action | Use `_action` column: `CREATE`, `UPDATE`, `DELETE` |

Suggested delta CSV format:

```csv
_action,sku,name,brand,status
UPDATE,ABC123,Shoe 1,Nike,active
CREATE,XYZ999,Shoe 2,Adidas,active
DELETE,OLD111,,,
```

Endpoint:

```text
POST /api/mdm/{entity}/delta-update
```

### 6.8 CSV Field Addition and Update

Supported schema changes:

| Change Type | Allowed? | Notes |
|---|---:|---|
| Add new nullable column | Yes | Safe |
| Add required column | Yes with default value | Needs migration |
| Rename column | Yes with mapping | Requires migration |
| Change data type | Conditional | Requires validation |
| Remove column | Conditional | Requires version backup |
| Change primary key | Restricted | Requires full reindex |
| Change queryable flag | Yes | Requires index/cache rebuild |
| Change editable flag | Yes | Metadata-only |

Recommended behavior:

1. Any schema change creates a new metadata version.
2. Existing data should be migrated.
3. Failed migration should roll back.
4. Cache should be invalidated.
5. API documentation should update.

### 6.9 Bulk File Update

Bulk update should support:

1. Uploading a revised CSV.
2. Mapping columns.
3. Choosing operation type:
   - Upsert
   - Replace
   - Patch
   - Delete by key
4. Validating before commit.
5. Showing dry-run summary.
6. Confirming execution.
7. Logging every changed row.

Recommended bulk flow:

```text
Upload -> Validate -> Dry Run -> Preview Changes -> Confirm -> Execute -> Version -> Invalidate Cache
```

### 6.10 Public and Private File Mode

Each CSV/entity should support visibility mode.

| Mode | Read Access | Write Access |
|---|---|---|
| Public | No IMS required | IMS required |
| Private | IMS required | IMS required |

Public mode should only apply to GET APIs.

Private mode should require IMS token even for read.

Public/private change should:

1. Update metadata.
2. Invalidate cache.
3. Log security event.
4. Optionally notify admin.

### 6.11 File Versioning

Every significant file operation should create a version.

Version-triggering operations:

| Operation | Create Version? |
|---|---:|
| Initial upload | Yes |
| Full update | Yes |
| Delta update | Yes |
| Bulk update | Yes |
| Schema change | Yes |
| Public/private toggle | Yes, metadata version |
| Rollback | Yes |
| Delete file | Yes, tombstone version |

Version metadata:

```json
{
  "versionId": "v12",
  "entityName": "product",
  "operation": "delta-update",
  "createdBy": "admin@company.com",
  "createdAt": "timestamp",
  "recordCount": 1200,
  "changeSummary": {
    "inserted": 20,
    "updated": 100,
    "deleted": 5
  },
  "schemaVersion": "schema-v4",
  "status": "active"
}
```

Rollback endpoint:

```text
POST /api/mdm/{entity}/rollback/{versionId}
```

Rollback should:

1. Validate admin permission.
2. Archive current state.
3. Restore selected version.
4. Create a rollback version.
5. Invalidate cache.
6. Log rollback action.

### 6.12 Logging and Audit

Audit logs should capture:

| Field | Description |
|---|---|
| logId | Unique log ID |
| entityName | Master data entity |
| operation | Upload, update, delete, read, rollback |
| actor | IMS user or technical account |
| requestId | Correlation ID |
| sourceIp | If available |
| timestamp | Event time |
| beforeVersion | Previous version |
| afterVersion | New version |
| status | Success/failure |
| errorMessage | If failed |
| affectedRecords | Count |
| cacheInvalidated | Yes/no |

Business logs should be searchable from the admin UI.

Technical logs should include:

1. Runtime action execution.
2. Validation errors.
3. DB operation failures.
4. Cache hits/misses.
5. Auth failures.
6. API latency.
7. File parsing failures.

### 6.13 API Query Params

The read API should allow CSV columns to become query parameters.

Example CSV:

```csv
sku,name,brand,category,status,region
ABC123,Shoe 1,Nike,Footwear,active,IN
```

Generated query options:

```text
GET /api/mdm/product?sku=ABC123
GET /api/mdm/product?brand=Nike
GET /api/mdm/product?category=Footwear&region=IN
GET /api/mdm/product?status=active
```

Required API behavior:

| Feature | Requirement |
|---|---|
| Exact match | Supported |
| Multiple query params | AND condition |
| Pagination | Required |
| Sorting | Recommended |
| Field selection | Recommended |
| Case-insensitive search | Optional |
| Partial match | Optional |
| Operators | Optional advanced feature |

Recommended query params:

```text
?page=1
&pageSize=50
&sort=sku
&order=asc
&fields=sku,name,brand
```

Example response:

```json
{
  "entity": "product",
  "count": 25,
  "page": 1,
  "pageSize": 25,
  "total": 480,
  "data": [
    {
      "sku": "ABC123",
      "name": "Shoe 1",
      "brand": "Nike",
      "status": "active"
    }
  ],
  "cache": {
    "hit": true,
    "ttlSeconds": 300
  }
}
```

## 7. Caching Requirements

### 7.1 AIO State Cache

Caching should happen at the AIO State level.

AIO State should be used for:

1. Query response cache.
2. Temporary import status.
3. Short-lived validation summary.
4. Runtime feature flags if needed.
5. Locks for import processing if needed.

AIO State should not be used as the source of truth for master data.

### 7.2 Cache Key Strategy

Cache key should be based on:

1. Entity name.
2. Query params.
3. Public/private mode.
4. Page.
5. Page size.
6. Sort.
7. Selected fields.
8. Active version ID.

Recommended format:

```text
mdm:{entity}:{versionId}:{hashOfNormalizedQueryParams}
```

Example:

```text
mdm:product:v12:8e921f0a9d3
```

### 7.3 Cache Value

Cache value should contain:

```json
{
  "response": {
    "entity": "product",
    "data": []
  },
  "createdAt": "timestamp",
  "ttlSeconds": 300,
  "versionId": "v12"
}
```

### 7.4 TTL Configuration

TTL should be configurable in the App Configuration admin UI.

Recommended TTL options:

| Data Type | Suggested TTL |
|---|---:|
| Frequently changing data | 60-300 seconds |
| Product master | 300-900 seconds |
| Store/dealer master | 900-3600 seconds |
| Static lookup data | 3600-86400 seconds |

### 7.5 Cache Invalidation

Cache should be invalidated on:

1. Full update.
2. Delta update.
3. Bulk update.
4. Row create/update/delete.
5. Schema update.
6. Public/private toggle.
7. Rollback.
8. TTL update.

Recommended strategy: include `versionId` in the cache key. When data changes, the active version changes and old cache keys naturally become stale.

## 8. Technical Architecture

### 8.1 Logical Components

| Component | Technology |
|---|---|
| Admin UI | React + React Spectrum |
| Hosting | App Builder SPA |
| API Layer | Adobe I/O Runtime web actions |
| Auth | Adobe IMS token |
| Data Store | App Builder Document Database |
| Cache | Adobe I/O State |
| File Storage | Document DB for parsed records; optional Files SDK for raw CSV archive |
| Logs | Document DB audit logs + Runtime logs |
| Config | App metadata + App Builder configuration |
| Deployment | AIO CLI / CI-CD |
| AEM Integration | AEMaaCS APIs / admin users / Experience Cloud access |

### 8.2 Recommended Architecture

```text
AEM Admin User
   |
   | IMS Authenticated Access
   v
App Builder Admin UI - React Spectrum
   |
   | Calls secured Runtime APIs
   v
Adobe I/O Runtime Actions
   |
   |-----------------------------|
   |                             |
   v                             v
Document Database              AIO State
Metadata                       Query Response Cache
CSV Records                    TTL-based Cache
Versions
Audit Logs
   |
   v
Generated Public/Private APIs
   |
   v
AEM Sites / EDS / External Consumers / Commerce / PIM-like Consumers
```

### 8.3 Runtime Action Groups

Recommended action groups:

| Runtime Action | Purpose |
|---|---|
| `file-upload` | Upload and parse CSV |
| `file-list` | List managed files |
| `file-detail` | Get metadata, schema, status |
| `file-delete` | Soft delete file/entity |
| `schema-update` | Add/update/remove CSV fields |
| `record-create` | Create row |
| `record-update` | Full row update |
| `record-patch` | Partial row update |
| `record-delete` | Soft/hard delete row |
| `bulk-update` | Bulk row update |
| `full-update` | Replace entire master |
| `delta-update` | Apply delta CSV |
| `query-data` | Public/private read API |
| `version-list` | View versions |
| `version-rollback` | Restore version |
| `visibility-update` | Public/private switch |
| `cache-config-update` | Configure TTL |
| `cache-clear` | Manual cache invalidation |
| `audit-list` | View audit logs |
| `api-docs` | Show generated endpoint contract |

## 9. Integration Touchpoints

### 9.1 Adobe App Builder

Main responsibilities:

1. Host admin SPA.
2. Provide secured serverless backend.
3. Manage runtime actions.
4. Integrate with Adobe Developer Console.
5. Store environment-level configuration.
6. Provide access to Adobe I/O Runtime, State, Files, and DB.

### 9.2 React Spectrum

React Spectrum should be used for:

1. Shell layout.
2. File upload UI.
3. Data table.
4. Form validation.
5. Modal dialogs.
6. Action menus.
7. Toast notifications.
8. Tabs.
9. Breadcrumbs.
10. Search/filter controls.
11. Status badges.
12. Admin configuration screens.

### 9.3 Adobe IMS

IMS is required for:

1. Admin UI access.
2. Secured Runtime API calls.
3. Create/update/delete operations.
4. User identity capture.
5. Audit logging.
6. Role-based access mapping.

Authentication rule:

| API Type | IMS Required |
|---|---:|
| Public read API | No |
| Private read API | Yes |
| Admin metadata APIs | Yes |
| CRUD write APIs | Yes |
| Cache/admin config APIs | Yes |
| Version rollback | Yes |

### 9.4 AEMaaCS

AEMaaCS touchpoints:

1. AEM admins access the App Builder admin console.
2. AEM Sites can consume public MDM APIs.
3. AEM components can use MDM data for dropdowns, product/content enrichment, dealer lookup, etc.
4. AEM backend integrations may use IMS-secured APIs.
5. AEM service credentials can be used where server-side integration with AEM APIs is needed.

### 9.5 Document Database

Document DB should store:

1. File metadata.
2. Parsed CSV rows.
3. Schema definitions.
4. Versions.
5. Audit logs.
6. API configuration.
7. Cache configuration.
8. Import job status.

### 9.6 AIO State

AIO State should store:

1. Query response cache.
2. Temporary import status.
3. Short-lived validation summary.
4. Runtime feature flags if needed.
5. Locks for import processing if needed.

Do not use AIO State as the source of truth for master data.

### 9.7 Optional App Builder Files SDK

Although CSV data should be stored using Document DB, consider App Builder Files SDK for raw CSV archival.

Suggested split:

| Data | Storage |
|---|---|
| Parsed records | Document DB |
| Metadata | Document DB |
| Versions | Document DB |
| Raw uploaded CSV | Optional Files SDK |
| Query cache | AIO State |
| Audit logs | Document DB |

### 9.8 Optional API Mesh Touchpoint

API Mesh can be added later if a unified API gateway or GraphQL layer is needed.

Potential API Mesh use cases:

1. Expose MDM APIs together with AEM/Commerce APIs.
2. Transform REST to GraphQL.
3. Hide internal Runtime URLs.
4. Provide unified API governance.
5. Combine MDM product data with Commerce product data.

For MVP, Runtime web actions are sufficient. API Mesh can be added in Phase 2 or Phase 3.

### 9.9 Optional Adobe Commerce Touchpoint

If this MDM behaves like a lightweight PIM, Adobe Commerce may consume:

1. Product attribute mappings.
2. Category mappings.
3. Store/dealer data.
4. Region-based content.
5. Pricing lookup references.
6. Campaign master data.

## 10. Data Model

### 10.1 Collections

Recommended Document DB collections:

| Collection | Purpose |
|---|---|
| `mdm_files` | File/entity metadata |
| `mdm_schemas` | Schema versions |
| `mdm_records_{entity}` | Active records per entity |
| `mdm_versions` | File/data version history |
| `mdm_version_records_{entity}` | Optional version snapshots |
| `mdm_audit_logs` | Business audit logs |
| `mdm_import_jobs` | Upload/import job status |
| `mdm_api_configs` | Generated API settings |
| `mdm_cache_configs` | Cache TTL and cache mode |
| `mdm_access_policies` | Access control metadata |

### 10.2 Record Document

```json
{
  "_id": "product:ABC123",
  "entityName": "product",
  "primaryKey": "ABC123",
  "versionId": "v12",
  "data": {
    "sku": "ABC123",
    "name": "Shoe 1",
    "brand": "Nike",
    "category": "Footwear",
    "status": "active",
    "region": "IN"
  },
  "status": "active",
  "deleted": false,
  "createdAt": "timestamp",
  "createdBy": "admin@company.com",
  "updatedAt": "timestamp",
  "updatedBy": "admin@company.com"
}
```

### 10.3 File Metadata Document

```json
{
  "_id": "file:product",
  "entityName": "product",
  "displayName": "Product Master",
  "description": "Product master data for AEM and downstream consumers",
  "primaryKey": "sku",
  "visibility": "public",
  "crudEnabled": true,
  "activeVersionId": "v12",
  "schemaVersionId": "schema-v4",
  "cache": {
    "enabled": true,
    "ttlSeconds": 300
  },
  "api": {
    "basePath": "/api/mdm/product",
    "readEnabled": true,
    "writeEnabled": true,
    "bulkEnabled": true
  },
  "governance": {
    "owner": "pim-admin@company.com",
    "businessUnit": "Digital",
    "retentionPolicy": "last-10-versions"
  },
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

## 11. API Contract

### 11.1 Admin APIs

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/admin/files/upload` | Upload new CSV |
| `GET` | `/api/admin/files` | List files |
| `GET` | `/api/admin/files/{entity}` | Get file metadata |
| `PATCH` | `/api/admin/files/{entity}` | Update metadata |
| `DELETE` | `/api/admin/files/{entity}` | Soft delete file |
| `POST` | `/api/admin/files/{entity}/visibility` | Public/private toggle |
| `POST` | `/api/admin/files/{entity}/schema` | Update schema |
| `GET` | `/api/admin/files/{entity}/versions` | List versions |
| `POST` | `/api/admin/files/{entity}/rollback/{versionId}` | Rollback |
| `GET` | `/api/admin/files/{entity}/logs` | View logs |
| `POST` | `/api/admin/files/{entity}/cache/clear` | Clear cache |
| `PATCH` | `/api/admin/files/{entity}/cache` | Update TTL |

### 11.2 Data APIs

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/mdm/{entity}` | Query records |
| `GET` | `/api/mdm/{entity}/{id}` | Get record by primary key |
| `POST` | `/api/mdm/{entity}` | Create record |
| `PUT` | `/api/mdm/{entity}/{id}` | Replace record |
| `PATCH` | `/api/mdm/{entity}/{id}` | Patch record |
| `DELETE` | `/api/mdm/{entity}/{id}` | Delete record |
| `POST` | `/api/mdm/{entity}/bulk` | Bulk update |
| `POST` | `/api/mdm/{entity}/full-update` | Full master update |
| `POST` | `/api/mdm/{entity}/delta-update` | Delta update |

### 11.3 Read API Example

```text
GET /api/mdm/product?brand=Nike&category=Footwear&status=active&page=1&pageSize=25
```

### 11.4 Write API Example

```http
PATCH /api/mdm/product/ABC123
Authorization: Bearer <IMS_TOKEN>
Content-Type: application/json
```

Body:

```json
{
  "brand": "Nike",
  "status": "inactive"
}
```

## 12. Security Requirements

### 12.1 Authentication

| User/Consumer | Authentication |
|---|---|
| Admin UI user | IMS |
| Public read API consumer | No token if file is public |
| Private read API consumer | IMS token |
| CRUD API consumer | IMS token |
| AEM server-side integration | IMS server-to-server token |
| Developer/Ops | Developer Console workspace access |

### 12.2 Authorization

Suggested roles:

| Role | Permissions |
|---|---|
| MDM Viewer | View metadata, read data |
| MDM Editor | Upload, update, delta update |
| MDM Admin | Manage schema, visibility, cache, rollback |
| MDM Auditor | View logs and versions |
| MDM API Consumer | Read private APIs |
| MDM Super Admin | Delete files, manage global config |

### 12.3 Security Controls

Required controls:

1. Validate IMS token for secured APIs.
2. Never allow write operations without IMS.
3. Validate allowed operations from file metadata.
4. Validate payload against schema.
5. Enforce primary key uniqueness.
6. Escape/normalize query params.
7. Limit page size.
8. Rate-limit public APIs if possible.
9. Prevent CSV injection.
10. Prevent schema pollution.
11. Mask sensitive fields in logs.
12. Keep `.env` and `.aio` out of source control.

## 13. Admin UI Modules

### 13.1 Navigation

Recommended navigation:

```text
Dashboard
Files
Upload CSV
API Console
Schema Manager
Versions
Audit Logs
Cache Settings
Access Policies
App Configuration
```

### 13.2 File List Page

Columns:

| Column |
|---|
| Display Name |
| Entity Name |
| File Name |
| Records |
| Visibility |
| CRUD Enabled |
| Active Version |
| Cache TTL |
| Last Updated |
| Owner |
| Status |
| Actions |

Actions:

1. View.
2. Edit metadata.
3. Upload delta.
4. Full update.
5. Schema update.
6. View API.
7. Make public/private.
8. Clear cache.
9. View logs.
10. View versions.
11. Rollback.
12. Delete.

### 13.3 Upload Wizard

Steps:

```text
Step 1: Upload CSV
Step 2: Preview Data
Step 3: Configure Entity
Step 4: Define Schema
Step 5: Configure API
Step 6: Configure Cache
Step 7: Review & Publish
```

### 13.4 API Console

For every file/entity, show:

1. Base API path.
2. Public/private status.
3. Supported methods.
4. Queryable fields.
5. Example requests.
6. Example responses.
7. Auth requirements.
8. Cache TTL.
9. Last version.
10. Copy endpoint button.

### 13.5 Schema Manager

Should support:

1. View fields.
2. Add field.
3. Rename field.
4. Change type.
5. Mark queryable.
6. Mark required.
7. Mark editable.
8. Set default value.
9. View schema version history.

### 13.6 Version Manager

Should show:

| Column |
|---|
| Version ID |
| Operation |
| Created By |
| Created At |
| Records |
| Inserted |
| Updated |
| Deleted |
| Status |
| Rollback Action |

### 13.7 Audit Log Viewer

Filters:

1. Entity.
2. Operation.
3. User.
4. Status.
5. Date range.
6. Request ID.
7. Version ID.

## 14. Non-Functional Requirements

### 14.1 Performance

| Requirement | Target |
|---|---:|
| Cached read response | Less than 300 ms preferred |
| Non-cached simple query | Less than 1-2 seconds depending on data size |
| Upload validation | Async for large files |
| Page size | Default 25/50, max configurable |
| Bulk operation | Async job-based for large datasets |

### 14.2 Scalability

Design assumptions:

1. Each entity should have a separate logical collection or indexed partition.
2. Large files should be processed in chunks.
3. Queryable fields should be indexed.
4. Cache should use normalized query keys.
5. Full updates should be job-based if file size is large.
6. Version storage should have retention policy.

### 14.3 Reliability

Required:

1. Transaction-like processing where possible.
2. Do not publish invalid file.
3. Full update should not corrupt active version.
4. Rollback should be available.
5. Failed delta should produce error report.
6. Cache should not serve old version after update.

### 14.4 Observability

Need:

1. Request ID.
2. Correlation ID.
3. Runtime logs.
4. Audit logs.
5. Import job logs.
6. Cache hit/miss metrics.
7. API latency metrics.
8. Error rate.
9. Failed auth count.
10. Version change history.

### 14.5 Maintainability

Need:

1. Metadata-driven runtime actions.
2. Generic CRUD engine.
3. Generic CSV parser.
4. Schema validation layer.
5. Reusable access-control middleware.
6. Reusable cache helper.
7. Reusable audit logger.
8. Config-driven endpoint generation.

## 15. Business Governance

### 15.1 Data Ownership

Every file/entity should have:

1. Business owner.
2. Technical owner.
3. Data steward.
4. Description.
5. Retention policy.
6. Visibility classification.
7. SLA classification.

### 15.2 Data Lifecycle

```text
Draft -> Validated -> Published -> Versioned -> Updated -> Archived / Deleted
```

### 15.3 Approval Workflow

MVP can allow direct publish by MDM Admin.

Future enhancement:

```text
Upload -> Validate -> Submit for Approval -> Approve -> Publish
```

### 15.4 Version Retention

Recommended default:

| Entity Type | Retention |
|---|---:|
| High-change product data | Last 10 versions |
| Static lookup data | Last 5 versions |
| Compliance-sensitive data | Last 20 versions or time-based |
| Large datasets | Snapshot + delta log strategy |

## 16. CRUD Handling Matrix

| Feature | Admin UI | API | Auth | Versioned | Cache Impact | Audit |
|---|---:|---:|---:|---:|---:|---:|
| Create file | Yes | Yes | IMS | Yes | Clear entity cache | Yes |
| Read file | Yes | Yes | Optional | No | Cacheable | Optional |
| Update metadata | Yes | Yes | IMS | Metadata version | Clear cache | Yes |
| Delete file | Yes | Yes | IMS | Tombstone | Clear cache | Yes |
| Create row | Yes | Yes | IMS | Yes | Clear cache | Yes |
| Update row | Yes | Yes | IMS | Yes | Clear cache | Yes |
| Patch row | Yes | Yes | IMS | Yes | Clear cache | Yes |
| Delete row | Yes | Yes | IMS | Yes | Clear cache | Yes |
| Full update | Yes | Yes | IMS | Yes | Clear cache | Yes |
| Delta update | Yes | Yes | IMS | Yes | Clear cache | Yes |
| Bulk update | Yes | Yes | IMS | Yes | Clear cache | Yes |
| Add field | Yes | Yes | IMS | Schema version | Clear cache | Yes |
| Update field | Yes | Yes | IMS | Schema version | Clear cache | Yes |
| Public/private | Yes | Yes | IMS | Metadata version | Clear cache | Yes |
| Rollback | Yes | Yes | IMS | Yes | Clear cache | Yes |
| TTL update | Yes | Yes | IMS | Metadata version | Clear cache | Yes |

## 17. Recommended MVP Phases

### Phase 1: Foundation

Deliver:

1. App Builder project.
2. React Spectrum admin shell.
3. IMS-secured admin access.
4. CSV upload.
5. Metadata configuration.
6. Document DB persistence.
7. Read API generation.
8. Public/private read support.
9. Basic audit logs.

### Phase 2: CRUD Engine

Deliver:

1. Create row.
2. Update row.
3. Patch row.
4. Delete row.
5. Allowed operation metadata.
6. Schema validation.
7. Query-param based filtering.
8. Pagination.

### Phase 3: Bulk and Versioning

Deliver:

1. Full master update.
2. Delta update.
3. Bulk update.
4. Version snapshots.
5. Rollback.
6. Import dry run.
7. Error report download.

### Phase 4: Cache and Performance

Deliver:

1. AIO State cache.
2. TTL configuration.
3. Cache invalidation.
4. Cache hit/miss logs.
5. Query key normalization.
6. Version-aware cache keys.

### Phase 5: Governance and Enterprise Readiness

Deliver:

1. Role-based permissions.
2. Approval workflow.
3. Advanced audit dashboard.
4. API usage dashboard.
5. Data quality rules.
6. API Mesh integration if required.
7. AEM component integration examples.

## 18. Key Design Decisions

### 18.1 Store Parsed CSV in Document DB

Recommended.

Reasons:

1. Queryable.
2. Supports document-style records.
3. Better for CRUD.
4. Better for metadata-driven filtering.
5. Versioning can be modeled.
6. Aligns with App Builder Database Storage.

### 18.2 Use AIO State Only for Cache

Recommended.

Reasons:

1. Fast key-value access.
2. Suitable for response caching.
3. Avoids repeated DB query/parsing.
4. TTL can be implemented at app level.
5. Not suitable as source of truth.

### 18.3 Use Version ID in Cache Key

Strongly recommended.

Reasons:

1. Avoids complex cache purging.
2. Prevents stale data after update.
3. Makes rollback easier.
4. Old cache expires naturally.

### 18.4 Metadata-Driven APIs

Strongly recommended.

Reasons:

1. Enables low-code/no-code behavior.
2. New CSV file automatically becomes API-enabled.
3. Avoids building custom endpoint per CSV.
4. Allows centralized governance.

### 18.5 Soft Delete by Default

Recommended.

Reasons:

1. Safer for business data.
2. Supports rollback.
3. Improves auditability.
4. Prevents accidental data loss.

## 19. Risks and Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Very large CSV files | Runtime timeout/performance issue | Chunked processing, async jobs, file size limits |
| Too many queryable columns | Slow queries | Limit queryable columns, create indexes |
| Public API abuse | Cost/performance issue | Rate limiting, page-size limit, cache |
| Bad CSV data | API quality issue | Validation, dry run, error report |
| Schema changes break consumers | Integration issue | Schema versions, API docs, compatibility checks |
| Stale cache | Incorrect data | Version-aware cache keys |
| Unauthorized writes | Security issue | IMS-only write APIs |
| Accidental delete/update | Business issue | Versioning, rollback, audit logs |
| Duplicate primary keys | Data corruption | Upload validation |
| No ownership | Governance issue | Mandatory owner metadata |

## 20. Acceptance Criteria

### 20.1 Business Acceptance

The solution is acceptable when:

1. A business admin can upload a CSV without developer help.
2. The uploaded CSV becomes queryable through an API.
3. Admin can configure public/private mode.
4. Admin can enable/disable CRUD operations.
5. Admin can perform full and delta updates.
6. Admin can add/update schema fields.
7. Admin can view logs and versions.
8. Admin can roll back to a previous version.
9. API consumers can filter data using CSV column names.
10. Cache TTL can be configured from admin UI.

### 20.2 Technical Acceptance

The solution is acceptable when:

1. All write APIs validate IMS token.
2. Public read APIs work without IMS only when file is public.
3. Private read APIs require IMS.
4. Data is stored in Document DB.
5. Query responses are cached in AIO State.
6. Cache key is based on request params and active version.
7. Cache invalidates on data/schema/visibility updates.
8. Every write operation creates an audit log.
9. File versions are preserved.
10. Runtime APIs return consistent JSON responses.
11. Admin UI uses React Spectrum.
12. `.env` and `.aio` are not committed.

## 21. Suggested Solution Name

Recommended name:

```text
AEM Master Data Manager - App Builder MDM Console
```

Other possible names:

1. AEM MDM Admin Console
2. App Builder MDM Hub
3. CSV-to-API Master Data Console
4. AEM Master Data Manager
5. Low-Code PIM Lite for AEM
6. Adobe App Builder MDM Console

## 22. Final Recommendation

Build this as a metadata-driven App Builder MDM platform where CSV upload acts as the source of API generation.

The core design should be:

```text
React Spectrum Admin UI
+ IMS-secured Admin Actions
+ Document DB for metadata, records, versions, logs
+ AIO State for query response cache
+ Public/private Runtime APIs
+ Metadata-controlled CRUD
+ Version-aware cache keys
+ Full auditability
```

This approach provides a practical low-code/no-code PIM-like capability for AEMaaCS without building a full PIM system from scratch. It also keeps the application aligned with Adobe App Builder architecture: React Spectrum frontend, Adobe I/O Runtime APIs, Adobe-managed storage, and IMS-secured enterprise integrations.
