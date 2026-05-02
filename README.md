# DataHub — Enterprise Data Platform

> A full-featured Master Data Management (MDM) application built on Adobe App Builder, providing enterprise-grade data import, versioning, schema management, archival, and GraphQL API access via Adobe API Mesh.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Admin Features Guide](#admin-features-guide)
  - [Dashboard](#dashboard)
  - [Import Data](#import-data)
  - [Entity Management](#entity-management)
  - [Record Management](#record-management)
  - [Schema Management](#schema-management)
  - [Version Control](#version-control)
  - [Archives & Backups](#archives--backups)
  - [Query Console](#query-console)
  - [Activity Log (Audit)](#activity-log-audit)
  - [Settings](#settings)
- [API Access (GraphQL via API Mesh)](#api-access-graphql-via-api-mesh)
- [Documentation](#documentation)
- [Getting Started](#getting-started)
- [Screenshots](#screenshots)

---

## Overview

DataHub is an enterprise-grade Master Data Management platform that runs inside the Adobe Experience Cloud shell. It allows organizations to:

- **Import** CSV datasets as managed entities
- **Version** every change with full rollback capability
- **Query** data through a unified GraphQL API (Adobe API Mesh)
- **Archive** stale data on configurable schedules
- **Audit** every operation with tamper-proof activity logs
- **Facet & Aggregate** data like Adobe Commerce product catalogs

The platform is **entity-agnostic** — upload any CSV and it becomes a fully queryable, versioned, schema-aware data entity with no code changes required.

---

## Key Features

| Feature | Description |
|---------|-------------|
| CSV Import | Drag-and-drop or file picker upload with automatic schema detection |
| Entity Dashboard | KPI cards showing entities, records, API endpoints, last activity |
| Full/Delta/Bulk Updates | Replace all records, merge changes, or batch operations |
| Schema Editor | View and modify field types, required flags, visibility per entity |
| Version History | Every mutation creates a version snapshot; one-click rollback |
| Archival System | Scheduled + on-demand archival with configurable retention policies |
| Query Console | Admin query builder with filter, sort, pagination, and facets |
| GraphQL API | Public API via Adobe API Mesh with caching and aggregations |
| Faceted Search | Commerce-style aggregations: value facets, range facets, boolean facets |
| Audit Trail | Complete activity log with user attribution, searchable & filterable |
| Role-Based Auth | Adobe IMS authentication with `require-adobe-auth` enforcement |
| Scheduled Jobs | Daily audit cleanup (2 AM) and archive runs (3 AM) via alarm triggers |

---

## Admin Features Guide

### Dashboard

The main landing page provides an at-a-glance overview of platform health:

- **KPI Cards**: Total Entities, Total Records, API Endpoints count, Last Modified timestamp
- **Quick Actions**: "Import Data" button for fast dataset onboarding
- **Platform Status**: Live indicators for Database, API Mesh, Authentication, and File Storage connectivity
- **Entity Overview**: Scrollable list of all entities with record counts

**Navigation**: Click the DataHub logo or "Dashboard" in the sidebar.

---

### Import Data

Upload CSV files to create new entities or update existing ones.

**How to import:**
1. Navigate to **Import Data** from the sidebar or dashboard
2. Select your CSV file (drag-and-drop or file picker)
3. Provide an entity name (or let the system auto-detect from filename)
4. Choose import mode:
   - **Full Update** — Replace all existing records
   - **Delta Update** — Merge new/changed records (matched by ID)
   - **Bulk Update** — Append records without deduplication
5. Submit — the system auto-detects schema, creates metadata, and indexes records

**Supported formats**: CSV with header row. UTF-8 encoding recommended.

**Limits**: File size depends on your Adobe I/O Runtime tier. Records are stored in `@adobe/aio-lib-db`.

---

### Entity Management

The **Files** section lists all imported entities with:

- **Search**: Filter entities by name in real-time
- **Sort**: By name, record count, or last modified date
- **Bulk Actions**: Select multiple entities for batch delete
- **Per-Entity Actions** (via action menu):
  - View Details
  - Manage Schema
  - Version History
  - Archives & Backups
  - Delete Entity

**Empty State**: If no entities exist, the platform shows a friendly onboarding prompt with an import button.

---

### Record Management

Drill into any entity to view, search, and manage individual records:

- **Tabular View**: Paginated data grid with all fields
- **Record Detail**: Click any row to view full record JSON
- **CRUD Operations**: Create, Read, Update, Delete individual records
- **Field Visibility**: Control which fields appear in the grid via schema settings

---

### Schema Management

Each entity has an auto-detected schema that can be customized:

- **Field Types**: string, number, boolean, date (auto-detected on import)
- **Required Fields**: Mark fields as mandatory for validation
- **Visibility**: Show/hide fields from the default data grid
- **Facet Configuration**: Enable fields for aggregation/faceted search
  - Facet types: `value`, `range`, `boolean`
  - Configure sort order, bucket limits, collapsed state

**Access**: Entity Detail → Schema tab, or via the action menu on the entity list.

---

### Version Control

Every mutation (import, update, delete, schema change) creates an immutable version snapshot:

- **Version List**: Chronological history with timestamps, user, and change type
- **Diff View**: See what changed between versions
- **Rollback**: One-click restore to any previous version
- **Metadata**: Each version records the operation type, user, and record count

**Access**: Entity Detail → Versions tab.

---

### Archives & Backups

Enterprise-grade data archival system with configurable retention policies:

#### Configuration (per entity)
- **Enable/Disable**: Toggle archival for each entity
- **Retention Period**: Number of days before records are archived (e.g., 90 days)
- **Archive Format**: JSON snapshots stored in Adobe I/O Files
- **Schedule**: Automated daily runs at 3:00 AM UTC (configurable via alarm trigger)

#### Archive Operations
- **View Archives**: Browse all archived snapshots with metadata
- **Pagination**: Navigate large archive histories
- **Summary Stats**: Total archives, total archived records, date ranges
- **Manual Trigger**: Run archival on-demand via the Archive Manager UI

#### How Archival Works
1. The `archive-run` action executes daily (or on-demand)
2. For each entity with archival enabled, it finds records older than the retention period
3. Records are serialized to JSON and stored in `@adobe/aio-lib-files`
4. Archived records are removed from the active database
5. An audit entry logs the archival operation

**Access**: Entity Detail → "Archives" button, or entity action menu → "Archives & Backups".

---

### Query Console

An administrative query interface for ad-hoc data exploration:

- **Entity Picker**: Select any entity from the dropdown
- **Filters**: Apply field-level filters in `field=value&field2=value2` format
- **Pagination**: Set page number and page size
- **Sort**: Choose sort field and order (asc/desc)
- **Field Selection**: Specify which fields to return (comma-separated)
- **Facets**: Enable aggregation for specific fields
- **Results Display**: Formatted JSON with byte size indicator
- **Clear Results**: Reset the output panel

**Filter Syntax**: `status=active&country=US` — each key-value pair matches against entity records.

**Access**: Sidebar → "Query Console".

---

### Activity Log (Audit)

Complete audit trail of all platform operations:

- **Logged Events**: Imports, updates, deletes, schema changes, rollbacks, archival runs, settings changes
- **Attributes**: Timestamp, user, operation type, entity, details
- **Search**: Full-text search across all audit entries
- **Filter**: By operation type, entity, date range
- **Pagination**: Navigate large audit histories
- **Auto-Cleanup**: Entries older than the configured retention period are purged daily at 2:00 AM UTC

**Access**: Sidebar → "Activity Log".

---

### Settings

Global application configuration:

- **Audit Retention**: Number of days to keep audit log entries (default: 90)
- **Default Page Size**: Records per page across all views
- **Platform Information**: Version, runtime environment, database region

**Access**: Sidebar → "Settings".

---

## API Access (GraphQL via API Mesh)

DataHub exposes all data through Adobe API Mesh as a unified GraphQL endpoint. The API supports **single-record** and **bulk** CRUD operations.

### Endpoint

```
POST https://edge-sandbox-graph.adobe.io/api/114b5a31-5c7f-4584-81eb-22241fc6411a/graphql
```

### Authentication

| Header | Description |
|--------|-------------|
| `x-partner-id` | Partner ID for write operations |
| `x-partner-key` | Partner API key for write operations |
| `Content-Type` | `application/json` |

Read operations are publicly accessible for public masters. Write operations require valid partner credentials.

### Available Operations

| # | Operation | Type | Description |
|---|-----------|------|-------------|
| 1 | `mdmQuery` | Query | Paginated list with filters, sort, field selection, facets |
| 2 | `mdmRecord` | Query | Fetch single record by primary key |
| 3 | `mdmBulkFetch` | Query | Fetch multiple records by comma-separated IDs |
| 4 | `mdmFacets` | Query | Get facet aggregations for a master |
| 5 | `mdmCreate` | Mutation | Create a single record |
| 6 | `mdmUpdate` | Mutation | Full replace of a single record |
| 7 | `mdmPatch` | Mutation | Partial update of a single record |
| 8 | `mdmDelete` | Mutation | Soft-delete a single record |
| 9 | `mdmBulkCreate` | Mutation | Create multiple records in one request |
| 10 | `mdmBulkUpdate` | Mutation | Full replace multiple records |
| 11 | `mdmBulkPatch` | Mutation | Partial update multiple records |
| 12 | `mdmBulkDelete` | Mutation | Soft-delete multiple records |

### Quick Example — Query Records

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

### Quick Example — Create Record

```graphql
mutation {
  mdmCreate(
    master: "productcatalog"
    input: {
      data: "{\"master_id\":\"NEW-001\",\"sku\":\"SKU-001\",\"name\":\"New Product\",\"price\":\"99.99\"}"
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

### Response Caching

| Operation | Cache |
|-----------|-------|
| Read queries (GET) | CDN cached: `max-age=60, s-maxage=900` (15 min edge cache) |
| Mutations (POST/PUT/PATCH/DELETE) | `no-store` (never cached) |

> For complete API documentation with all parameters, data formats, request/response examples, and error codes, see the [API Reference](API-REFERENCE.md) or the [Postman Documentation](https://documenter.getpostman.com/view/38215772/2sBXqKofA5).

---

## Documentation

| Document | Description |
|----------|-------------|
| [README.md](README.md) | This file — overview, features, admin guide, getting started |
| [TECHNICAL.md](TECHNICAL.md) | Architecture, tech stack, project structure, data flows, deployment, troubleshooting |
| [API-REFERENCE.md](API-REFERENCE.md) | Complete API reference — all 12 GraphQL operations with parameters, examples, and error codes |
| [Postman Collection](PIM-API.postman_collection.json) | Importable Postman collection with all API requests and example responses |
| [API Documentation (Online)](https://documenter.getpostman.com/view/38215772/2sBXqKofA5) | Published Postman API documentation — interactive, shareable |

---

## Getting Started

### Prerequisites

- Node.js >= 18
- Adobe I/O CLI (`npm install -g @adobe/aio-cli`)
- Adobe Developer Console project with App Builder enabled
- Valid `.env` file with runtime credentials

### Installation

```bash
npm install
```

### Local Development

```bash
aio app dev
```

App runs at `https://localhost:9080`. Actions are served locally.

### Accessing the Deployed App

The app runs inside the **Adobe Experience Cloud Shell** with full IMS authentication:

```
https://experience.adobe.com/?devMode=true#/@<your-org>/custom-apps/<namespace>
```

For direct CDN access (standalone mode), set the IMS token manually:
```javascript
// Browser console at https://<namespace>.adobeio-static.net/index.html
localStorage.setItem('mdm_ims_token', '<your-token>')
localStorage.setItem('mdm_ims_org', '<your-org-id>')
location.reload()
```

### Run Tests

```bash
aio app test          # Unit tests
aio app test --e2e    # End-to-end tests
```

### Deploy

```bash
aio app deploy        # Build & deploy to Adobe I/O Runtime + CDN
aio app undeploy      # Remove deployment
```

### Environment Configuration

Generate `.env` using:
```bash
aio app use
```

Required variables:
```bash
AIO_RUNTIME_AUTH=<your-runtime-auth>
AIO_RUNTIME_NAMESPACE=<your-namespace>
```

---

## Screenshots

| View | Description |
|------|-------------|
| Dashboard | KPI cards, platform status, entity overview |
| Entity List | Searchable grid with bulk actions |
| Record Grid | Paginated data with sort/filter |
| Schema Editor | Field type configuration and facet settings |
| Query Console | Ad-hoc query builder with JSON results |
| Archive Manager | Retention configuration and archive history |
| Audit Log | Searchable activity timeline |

---

## License

Apache-2.0

---

*Built with Adobe App Builder • React Spectrum • Adobe I/O Runtime • API Mesh*
