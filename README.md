# DataHub — Enterprise Data Platform

> Master Data Management on Adobe App Builder. Import any CSV, get a schema-aware GraphQL API instantly.

---

## How It Works

```
CSV Upload → Auto Schema Detection → Managed Entity → GraphQL API (via API Mesh)
```

DataHub is **entity-agnostic** — upload any CSV file and it becomes a fully queryable, schema-aware data entity with CRUD operations, faceted search, versioning, archival, and a public GraphQL API. No code changes required.

---

## Platform Flow

### 1. Onboard Data

Upload a CSV file through the admin UI. DataHub auto-detects the schema (field names, types), assigns a primary key, and indexes all records.

- Drag-and-drop or file picker
- Choose visibility (public / private) and enable CRUD at import time
- Configure facets for aggregation fields during import

### 2. Manage Entities

Browse all imported entities from the dashboard. Each entity shows record count, last activity, and status. From here you can:

- **View / Edit Records** — Paginated data grid with inline CRUD
- **Modify Schema** — Add/remove/rename fields, change types, toggle visibility
- **Configure Facets** — Enable commerce-style aggregations (value, range, boolean)
- **Update Data** — Full replace, delta merge, or bulk append operations

### 3. Query & Explore

Use the **Query Console** to test queries before integrating. Select a master and the console generates all available API Mesh operations (queries, mutations, bulk ops) dynamically based on the entity's configuration.

- Postman-style operation sidebar with method badges
- Code snippets in GraphQL, cURL, JavaScript, and Python — one-click copy
- Live query builder with filters, pagination, and sort
- Inline response viewer

### 4. Integrate via API

All public entities are exposed through **Adobe API Mesh** as a unified GraphQL endpoint:

```
POST https://graph.adobe.io/api/YOUR_MESH_ID/graphql
```

**12 operations** available:

| # | Operation | Type | Auth |
|---|-----------|------|------|
| 1 | `mdmQuery` | Query | Public |
| 2 | `mdmRecord` | Query | Public |
| 3 | `mdmBulkFetch` | Query | Public |
| 4 | `mdmFacets` | Query | Public |
| 5 | `mdmCreate` | Mutation | Partner |
| 6 | `mdmUpdate` | Mutation | Partner |
| 7 | `mdmPatch` | Mutation | Partner |
| 8 | `mdmDelete` | Mutation | Partner |
| 9 | `mdmBulkCreate` | Mutation | Partner |
| 10 | `mdmBulkUpdate` | Mutation | Partner |
| 11 | `mdmBulkPatch` | Mutation | Partner |
| 12 | `mdmBulkDelete` | Mutation | Partner |

Read operations are publicly accessible. Write operations require `x-partner-id` and `x-partner-key` headers — partners are onboarded through the Admin Console.

### 5. Govern & Audit

Every operation is logged. The platform runs automated maintenance:

- **Audit Trail** — Full activity log with user attribution, searchable and filterable
- **Archival** — Scheduled archival of stale records with configurable retention (runs daily at 3 AM UTC)
- **Audit Cleanup** — Auto-purge of old log entries (runs daily at 2 AM UTC)
- **RBAC** — Role-based access control via Adobe IMS with per-feature permissions

---

## MVP Features

| Feature | Status |
|---------|--------|
| CSV Import with auto-schema detection | ✅ |
| Entity dashboard with KPIs | ✅ |
| Record CRUD (admin UI) | ✅ |
| Full / Delta / Bulk update operations | ✅ |
| Schema editor (types, required, visibility) | ✅ |
| GraphQL public API via API Mesh (12 operations) | ✅ |
| Faceted search & aggregations | ✅ |
| Partner management & API credentials | ✅ |
| Query Console with dynamic code generation | ✅ |
| Audit trail with search & auto-cleanup | ✅ |
| Archive system with retention policies | ✅ |
| Role-based access control (RBAC) | ✅ |
| Scheduled jobs (audit cleanup, archival) | ✅ |
| Record-level audit fields (createdAt, updatedBy) | ✅ |
| Version control with rollback | ✅ |

### Follow-on

| Feature | Status |
|---------|--------|
| Webhook / event-driven notifications | 🔜 |
| Multi-org / multi-tenant support | 🔜 |
| Bulk import via API (not just CSV) | 🔜 |
| Field-level access control | 🔜 |
| Custom validation rules | 🔜 |

---

## Documentation

| Document | What's in it |
|----------|-------------|
| **[ADMIN-MANUAL.md](ADMIN-MANUAL.md)** | Step-by-step guide for every UI feature — importing, records, schema, facets, archives, partners, settings |
| **[API-REFERENCE.md](API-REFERENCE.md)** | All 12 GraphQL operations — parameters, data formats, response shapes, error codes |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | System architecture, component diagrams, integration map, feature flow diagrams |
| **[TECHNICAL.md](TECHNICAL.md)** | Tech stack, project structure, database layer, deployment, troubleshooting |
| **[Postman Collection](PIM-API.postman_collection.json)** | Import into Postman — all 14 requests with example responses, ready to run |

---

## Getting Started

### Prerequisites

- Node.js >= 18
- Adobe I/O CLI: `npm install -g @adobe/aio-cli`
- Adobe Developer Console project with App Builder enabled

### Install & Run

```bash
npm install
aio app dev           # Local dev at https://localhost:9080
```

### Deploy

```bash
aio app deploy        # Build & deploy to Adobe I/O Runtime + CDN
```

### Access

The app runs inside Adobe Experience Cloud Shell:

```
https://experience.adobe.com/?devMode=true#/@<your-org>/custom-apps/<namespace>
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Hosting | Adobe Experience Cloud Shell |
| Frontend | React 16 + React Spectrum 3 |
| Backend | Adobe I/O Runtime (Node.js 22) |
| Database | `@adobe/aio-lib-db` |
| File Storage | `@adobe/aio-lib-files` |
| Cache | `@adobe/aio-lib-state` |
| API Gateway | Adobe API Mesh (GraphQL) |
| Auth | Adobe IMS (OAuth 2.0) |
| Scheduler | OpenWhisk Alarm Triggers |

---

*Built with Adobe App Builder • React Spectrum • Adobe I/O Runtime • API Mesh*
