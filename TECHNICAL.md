# DataHub — Technical Architecture Guide

> Comprehensive technical reference for developers working on the DataHub Enterprise Data Platform.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Runtime Actions (Backend)](#runtime-actions-backend)
- [Database Layer](#database-layer)
- [File Storage Layer](#file-storage-layer)
- [API Mesh (GraphQL)](#api-mesh-graphql)
- [Frontend Architecture](#frontend-architecture)
- [Authentication & Authorization](#authentication--authorization)
- [Scheduled Jobs & Triggers](#scheduled-jobs--triggers)
- [Data Flow Diagrams](#data-flow-diagrams)
- [Configuration Reference](#configuration-reference)
- [Error Handling Patterns](#error-handling-patterns)
- [Testing Strategy](#testing-strategy)
- [Deployment](#deployment)
- [Performance Considerations](#performance-considerations)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Adobe Experience Cloud Shell                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐    ┌──────────────────────────────────────┐   │
│  │   React UI   │───▶│     Adobe I/O Runtime Actions         │   │
│  │  (Spectrum)  │    │         (Node.js 22)                  │   │
│  └──────────────┘    └─────────┬──────────────┬─────────────┘   │
│                                │              │                   │
│                    ┌───────────▼──┐    ┌──────▼──────┐          │
│                    │ @adobe/aio-  │    │ @adobe/aio- │          │
│                    │  lib-db      │    │  lib-files  │          │
│                    │ (MongoDB)    │    │ (Blob Store)│          │
│                    └──────────────┘    └─────────────┘          │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│                       Adobe API Mesh                              │
│              (GraphQL Gateway - Public API)                       │
│                                                                   │
│  ┌────────────────┐         ┌────────────────────┐              │
│  │  MDMData Source│         │  MDMFacets Source   │              │
│  │  (JsonSchema)  │         │   (JsonSchema)      │              │
│  └────────────────┘         └────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Entity-Agnostic**: No code changes needed for new data types — upload CSV → auto-schema → queryable
2. **No L2 Cache**: Direct database reads for freshness; API Mesh provides edge caching (60s/120s)
3. **Versioned Mutations**: Every write creates an immutable version snapshot
4. **Separation of Concerns**: Admin UI actions (auth-required) vs. Public API actions (no auth, Mesh-protected)

---

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Adobe I/O Runtime (OpenWhisk) | Node.js 22 |
| Database | `@adobe/aio-lib-db` | ^1.0.3 |
| File Storage | `@adobe/aio-lib-files` | via `@adobe/aio-sdk` ^6 |
| SDK | `@adobe/aio-sdk` | ^6 |
| API Gateway | Adobe API Mesh | JsonSchema handler |
| Frontend | React | ^16.13.1 |
| UI Framework | `@adobe/react-spectrum` | ^3.4.0 |
| Routing | `react-router-dom` | ^6.26.2 |
| Icons | `@spectrum-icons/workflow` | ^3.2.0 |
| Bundler | Webpack (via App Builder CLI) | Custom config |
| Testing | Jest | ^29 |
| Linting | ESLint | ^8 |
| TypeScript | Optional (tsconfig present) | ^5.5.4 |

---

## Project Structure

```
pimapp/
├── app.config.yaml          # App Builder manifest (actions, triggers, rules)
├── package.json             # Dependencies & scripts
├── webpack-config.js        # Custom webpack overrides
├── tsconfig.json            # TypeScript configuration
├── jest.setup.js            # Test setup
├── .env                     # Runtime credentials (git-ignored)
│
├── actions/                 # Backend serverless actions
│   ├── utils.js             # Shared utilities (auth, params, logging)
│   ├── mdm-utils.js         # MDM-specific helpers (escapeRegex, filter parsing)
│   │
│   ├── dashboard/           # Dashboard KPIs & platform status
│   ├── file-upload/         # CSV import & entity creation
│   ├── file-list/           # Entity listing with search/sort/pagination
│   ├── file-detail/         # Single entity detail (metadata + records)
│   ├── file-delete/         # Entity deletion with cascade
│   ├── metadata-update/     # Entity metadata changes
│   │
│   ├── record-crud/         # Individual record CRUD operations
│   ├── full-update/         # Full dataset replacement
│   ├── delta-update/        # Merge/upsert records by ID
│   ├── bulk-update/         # Batch append operations
│   │
│   ├── schema-update/       # Schema modification (types, visibility, facets)
│   ├── version-list/        # Version history retrieval
│   ├── version-rollback/    # Restore entity to previous version
│   ├── visibility-update/   # Field visibility toggles
│   │
│   ├── query-data/          # Admin query interface (auth-required)
│   ├── mdm-data/            # Public data API (Mesh source, no auth)
│   ├── mdm-facets/          # Public facets API (Mesh source, no auth)
│   │
│   ├── audit-list/          # Audit log retrieval
│   ├── audit-cleanup/       # Scheduled audit purge
│   ├── app-settings/        # Global settings CRUD
│   │
│   ├── archive-run/         # Archival execution engine
│   ├── archive-list/        # Archive history retrieval
│   ├── archive-config/      # Per-entity archival configuration
│   │
│   ├── generic/             # Template action (unused in production)
│   └── publish-events/      # Adobe I/O Events publisher
│
├── mesh/                    # API Mesh configuration
│   ├── mesh.json            # Mesh source definitions & operations
│   ├── schema.graphql       # GraphQL type definitions
│   └── response-samples/    # Response shape samples for Mesh
│       ├── mdm-query.json
│       ├── mdm-record.json
│       └── mdm-facets.json
│
├── web-src/                 # Frontend SPA
│   ├── index.html           # Entry HTML (title: DataHub)
│   ├── 404.html             # Static 404 page
│   └── src/
│       ├── index.js         # React entry point
│       ├── index.css        # Global styles (~1020 lines)
│       ├── config.json      # Action endpoint URLs
│       ├── exc-runtime.js   # Experience Cloud shell integration
│       ├── utils.js         # Frontend utilities
│       └── components/
│           ├── App.js           # Root component, routing, error boundary
│           ├── SideBar.js       # Left navigation
│           ├── HeaderBar.js     # Top bar with breadcrumbs & user info
│           ├── Dashboard.js     # Main dashboard with KPIs
│           ├── Home.js          # Legacy home (unused)
│           ├── FileList.js      # Entity list view
│           ├── FileUpload.js    # Import wizard
│           ├── FileDetail.js    # Entity detail with tabs
│           ├── RecordManager.js # Record CRUD interface
│           ├── SchemaManager.js # Schema editor
│           ├── VersionManager.js# Version history & rollback
│           ├── ArchiveManager.js# Archive config & history
│           ├── QueryConsole.js  # Ad-hoc query builder
│           ├── AuditLogs.js     # Activity log viewer
│           ├── AppSettings.js   # Settings panel (hypothetical)
│           ├── NotificationProvider.js # Toast notifications context
│           ├── ActionsForm.js   # Legacy form (unused)
│           ├── About.js         # About page (unused)
│           └── SideBar.js       # Left navigation sidebar
│
├── test/                    # Unit tests
│   ├── generic.test.js
│   ├── publish-events.test.js
│   └── utils.test.js
│
└── e2e/                     # End-to-end tests
    ├── generic.e2e.test.js
    └── publish-events.e2e.test.js
```

---

## Runtime Actions (Backend)

### Action Anatomy

Every action follows this pattern:

```javascript
const { Core } = require('@adobe/aio-sdk')
const { errorResponse, stringParameters, checkMissingRequestInputs } = require('../utils')

async function main (params) {
  const logger = Core.Logger('action-name', { level: params.LOG_LEVEL || 'info' })
  logger.info('Calling action-name')

  try {
    // 1. Validate inputs
    const requiredParams = ['entity']
    const errorMessage = checkMissingRequestInputs(params, requiredParams)
    if (errorMessage) return errorResponse(400, errorMessage, logger)

    // 2. Get database client
    const { DatabaseClient } = require('@adobe/aio-lib-db')
    const db = await DatabaseClient.createFrom(params)

    // 3. Business logic
    const result = await db.collection('records').find({ entity: params.entity })

    // 4. Return response
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: result
    }
  } catch (error) {
    logger.error(error)
    return errorResponse(500, 'Internal server error', logger)
  }
}

exports.main = main
```

### Action Registry

| Action | Method | Auth | Purpose |
|--------|--------|------|---------|
| `dashboard` | GET | Yes | KPI metrics & platform status |
| `file-upload` | POST | Yes | CSV import, schema detection, record insertion |
| `file-list` | GET | Yes | List entities with search/sort/pagination |
| `file-detail` | GET | Yes | Entity metadata + paginated records |
| `file-delete` | DELETE | Yes | Cascade delete entity + records + versions |
| `metadata-update` | POST | Yes | Update entity metadata fields |
| `record-crud` | POST/PUT/DELETE | Yes | Individual record operations |
| `full-update` | POST | Yes | Replace all records for an entity |
| `delta-update` | POST | Yes | Upsert records by ID match |
| `bulk-update` | POST | Yes | Append records without dedup |
| `schema-update` | POST | Yes | Modify field schema & facet config |
| `version-list` | GET | Yes | Retrieve version history |
| `version-rollback` | POST | Yes | Restore entity to a version |
| `visibility-update` | POST | Yes | Toggle field visibility |
| `query-data` | GET | Yes | Admin query with filters |
| `mdm-data` | GET | **No** | Public API (Mesh source) |
| `mdm-facets` | GET | **No** | Public facets API (Mesh source) |
| `audit-list` | GET | Yes | Retrieve audit entries |
| `audit-cleanup` | POST | Yes | Purge old audit entries (scheduled) |
| `app-settings` | GET/POST | Yes | Global settings CRUD |
| `archive-run` | POST | Yes | Execute archival (scheduled/manual) |
| `archive-list` | GET | Yes | Retrieve archive history |
| `archive-config` | GET/POST | Yes | Per-entity archival settings |

### Auth Annotations

```yaml
annotations:
  require-adobe-auth: true    # Admin actions — requires IMS token
  require-adobe-auth: false   # Public actions (mdm-data, mdm-facets) — Mesh handles auth
  final: true                 # Cannot override params via query/body
  include-ims-credentials: true  # Inject IMS context for DB/Files access
```

---

## Database Layer

### Provider: `@adobe/aio-lib-db` v1.0.3

MongoDB-compatible document database auto-provisioned by App Builder.

### Configuration

```yaml
database:
  auto-provision: true
  region: apac
```

### Collections

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `metadata` | Entity registry | `entity`, `entityName`, `recordCount`, `schema`, `createdAt`, `updatedAt` |
| `records` | Data records | `entity`, `_id`, `...fields` (dynamic per entity schema) |
| `versions` | Version snapshots | `entity`, `version`, `type`, `user`, `data`, `createdAt` |
| `audit` | Activity log | `action`, `entity`, `user`, `details`, `timestamp` |
| `settings` | App configuration | `key`, `value`, `updatedAt` |
| `archives` | Archive metadata | `entity`, `archiveId`, `recordCount`, `filePath`, `createdAt` |

### Supported Operations

```javascript
// Find documents
db.collection('records').find(query, options)     // options: limit, skip, sort, projection
db.collection('records').findOne(query)

// Insert
db.collection('records').insertOne(document)

// Update
db.collection('records').updateOne(filter, update)  // update: { $set: {...} }

// Delete
db.collection('records').deleteMany(filter)

// Aggregation
db.collection('records').aggregate(pipeline)       // MongoDB-style pipeline

// Count
db.collection('records').countDocuments(filter)
```

### Safe Query Pattern

```javascript
// findOne throws if document not found — wrap it:
async function safeFindOne(collection, query) {
  try {
    return await collection.findOne(query)
  } catch (e) {
    if (e.message && e.message.includes('Document not found')) {
      return null
    }
    throw e
  }
}
```

### Aggregation Pipeline (Facets)

```javascript
const pipeline = [
  { $match: { entity: 'products', ...filters } },
  { $facet: {
    category: [
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ],
    brand: [
      { $group: { _id: '$brand', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]
  }}
]
const result = await db.collection('records').aggregate(pipeline)
```

---

## File Storage Layer

### Provider: `@adobe/aio-lib-files` (via `@adobe/aio-sdk`)

Used for:
- Storing original uploaded CSV files
- Archival JSON snapshots
- Large dataset exports

### Operations

```javascript
const { Files } = require('@adobe/aio-sdk')
const files = await Files.init()

// Write file
await files.write('archives/products/2024-01-15.json', jsonBuffer)

// Read file
const content = await files.read('path/to/file')

// List files
const fileList = await files.list('archives/products/')

// Delete
await files.delete('path/to/file')

// Generate pre-signed URL (for downloads)
const url = await files.generatePresignURL('path/to/file', { expiryInSeconds: 3600 })
```

---

## API Mesh (GraphQL)

### Configuration: `mesh/mesh.json`

Two JsonSchema sources pointing to Runtime actions:

#### MDMData Source
- **Base URL**: `https://{NAMESPACE}.adobeioruntime.net/api/v1/web/pimapp/mdm-data`
- **Operations**: `mdmQuery` (list/search), `mdmRecord` (get by ID)
- **Auth forwarding**: `x-forwarded-authorization` header

#### MDMFacets Source
- **Base URL**: `https://{NAMESPACE}.adobeioruntime.net/api/v1/web/pimapp/mdm-facets`
- **Operations**: `mdmFacets` (facet config + live values)
- **Auth forwarding**: `x-forwarded-authorization` header

### Schema Types (`mesh/schema.graphql`)

```graphql
scalar JSON

type FacetValue {
  value: String!
  count: Int!
  selected: Boolean!
}

type Aggregation {
  field: String!
  label: String!
  type: String!          # value | range | boolean
  showCount: Boolean!
  collapsed: Boolean!
  values: [FacetValue!]!
}

type MDMQueryResponse {
  entity: String!
  count: Int!
  page: Int!
  pageSize: Int!
  total: Int!
  data: JSON!
  aggregations: [Aggregation!]
}

type MDMRecordResponse {
  entity: String!
  data: JSON!
}

type MDMFacetsResponse {
  entity: String!
  facetsEnabled: Boolean!
  totalFields: Int!
  facetableFields: Int!
  config: [FacetConfig!]!
  facets: [Aggregation!]
  totalRecords: Int!
}
```

### Filter Passing Strategy

Filters are passed as a **JSON-encoded string** via the `filters` query parameter:

```
?filters={"category":"electronics","brand":"Sony"}
```

This avoids GraphQL schema changes when new filterable fields are added (entity-agnostic design).

### Deploying Mesh Changes

```bash
aio api-mesh:update mesh/mesh.json
```

### Response Caching

```json
"responseConfig": {
  "headers": {
    "Cache-Control": "public, max-age=60, s-maxage=120"
  }
}
```

- Browser cache: 60 seconds
- CDN/edge cache: 120 seconds

---

## Frontend Architecture

### Routing (React Router v6)

```
/                        → Dashboard
/files                   → Entity List (FileList)
/upload                  → Import Wizard (FileUpload)
/files/:entity           → Entity Detail (FileDetail)
/files/:entity/records   → Record Manager (RecordManager)
/files/:entity/schema    → Schema Editor (SchemaManager)
/files/:entity/versions  → Version History (VersionManager)
/files/:entity/archives  → Archive Manager (ArchiveManager)
/api-console             → Query Console (QueryConsole)
/audit                   → Activity Log (AuditLogs)
/settings                → Settings (AppSettings)
*                        → 404 Not Found (NotFound)
```

### Component Hierarchy

```
<Provider theme={defaultTheme}>
  <ErrorBoundary FallbackComponent={fallbackComponent}>
    <NotificationProvider>
      <Router>
        <Grid areas={['sidebar header', 'sidebar content']}>
          <SideBar />
          <HeaderBar />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            ...
          </Routes>
        </Grid>
      </Router>
    </NotificationProvider>
  </ErrorBoundary>
</Provider>
```

### State Management

- **No global store** — each component manages its own state via `useState`/`useEffect`
- **API calls**: Direct `fetch()` to action endpoints from `config.json`
- **Notifications**: React Context via `NotificationProvider`
- **Routing state**: React Router's `useParams`, `useNavigate`, `useLocation`

### Action URL Resolution

```javascript
import actions from '../config.json'

const response = await fetch(actions['pimapp/file-list'] + '?search=test', {
  headers: { 'x-ow-extra-logging': 'on' }
})
```

### UI Framework: React Spectrum

All components use Adobe's React Spectrum for consistent enterprise UI:
- Layout: `Grid`, `View`, `Flex`
- Navigation: Sidebar (custom), Breadcrumbs (custom in HeaderBar)
- Data: `TableView` (via custom implementations)
- Forms: `TextField`, `NumberField`, `Picker`, `Switch`, `Checkbox`, `SearchField`
- Feedback: `ProgressCircle`, `StatusLight`, `Well`
- Actions: `Button`, `ActionButton`, `ActionMenu`
- Overlays: `DialogTrigger`, `AlertDialog`, `Tooltip`, `TooltipTrigger`

---

## Authentication & Authorization

### Admin UI Actions

All admin actions require Adobe IMS authentication:

```yaml
annotations:
  require-adobe-auth: true
```

The Runtime gateway validates the `Authorization: Bearer <IMS_TOKEN>` header before invoking the action.

### Public API Actions (Mesh Sources)

`mdm-data` and `mdm-facets` have `require-adobe-auth: false` because API Mesh handles authentication at the gateway level and forwards credentials via `x-forwarded-authorization`.

### IMS Credentials in Actions

With `include-ims-credentials: true`, the action receives:
- `params.__ow_headers.authorization` — Bearer token
- IMS context for initializing `@adobe/aio-lib-db` and `@adobe/aio-lib-files`

---

## Scheduled Jobs & Triggers

### Audit Cleanup (Daily at 2:00 AM UTC)

```yaml
triggers:
  audit-cleanup-daily:
    feed: /whisk.system/alarms/alarm
    inputs:
      cron: '0 2 * * *'
rules:
  audit-cleanup-rule:
    trigger: audit-cleanup-daily
    action: pimapp/audit-cleanup
```

**Behavior**: Deletes audit entries older than the configured retention period (default 90 days).

### Archive Run (Daily at 3:00 AM UTC)

```yaml
triggers:
  archive-run-daily:
    feed: /whisk.system/alarms/alarm
    inputs:
      cron: '0 3 * * *'
rules:
  archive-run-rule:
    trigger: archive-run-daily
    action: pimapp/archive-run
```

**Behavior**:
1. Reads archive configuration for all entities
2. For entities with archival enabled, finds records older than retention period
3. Serializes matching records to JSON
4. Stores JSON in `@adobe/aio-lib-files` under `archives/{entity}/{timestamp}.json`
5. Deletes archived records from active database
6. Creates archive metadata document
7. Logs audit entry

---

## Data Flow Diagrams

### CSV Import Flow

```
User → FileUpload UI → file-upload action
  1. Parse CSV headers → auto-detect schema
  2. Insert metadata doc (entity name, schema, record count)
  3. Batch insert records into 'records' collection
  4. Create version 1 snapshot in 'versions' collection
  5. Create audit entry
  6. Return success with entity details
```

### Query Flow (Admin)

```
QueryConsole UI → query-data action
  1. Parse entity, filters, pagination, sort params
  2. Build MongoDB query from filters
  3. Execute find() with projection, skip, limit, sort
  4. If facets requested: run aggregate pipeline
  5. Return { count, page, pageSize, total, data, aggregations }
```

### Query Flow (Public API via Mesh)

```
External Client → API Mesh (GraphQL) → mdm-data action
  1. Mesh maps GraphQL args to query params
  2. Action parses 'filters' JSON string
  3. Build MongoDB query
  4. Execute find + optional aggregation
  5. Return JSON response
  6. Mesh caches response (60s browser, 120s CDN)
```

### Archival Flow

```
Alarm Trigger (3 AM) → archive-run action
  1. Load all entity archive configs
  2. For each enabled entity:
     a. Calculate cutoff date (now - retentionDays)
     b. Find records with createdAt < cutoff
     c. Serialize to JSON buffer
     d. Write to files storage: archives/{entity}/{timestamp}.json
     e. Delete archived records from DB
     f. Insert archive metadata document
     g. Update entity metadata (recordCount)
  3. Log audit entries for each archival
```

---

## Configuration Reference

### `app.config.yaml`

```yaml
application:
  actions: actions              # Actions source directory
  web: web-src                  # Frontend source directory
  runtimeManifest:
    database:
      auto-provision: true      # Auto-create DB on deploy
      region: apac              # Database region
    packages:
      pimapp:
        license: Apache-2.0
        actions:
          <action-name>:
            function: actions/<name>/index.js
            web: 'yes'          # Accessible via web URL
            runtime: nodejs:22  # Runtime version
            inputs:
              LOG_LEVEL: debug  # Default log level
            annotations:
              require-adobe-auth: true/false
              final: true
              include-ims-credentials: true
```

### `web-src/src/config.json`

Maps action names to their HTTP endpoints. Auto-generated during `aio app dev` for local development. On deploy, URLs point to production Runtime namespace.

### Environment Variables (`.env`)

```bash
AIO_RUNTIME_AUTH=<base64-encoded-auth>
AIO_RUNTIME_NAMESPACE=<org-id>-<workspace>-stage
SERVICE_API_KEY=<optional-api-key-for-events>
```

---

## Error Handling Patterns

### Action-Level Error Response

```javascript
// utils.js - shared error formatter
function errorResponse(statusCode, message, logger) {
  logger.error(`${statusCode}: ${message}`)
  return {
    error: {
      statusCode,
      body: { error: message }
    }
  }
}
```

### Frontend Error Boundary

```jsx
<ErrorBoundary FallbackComponent={fallbackComponent}>
  {/* App content */}
</ErrorBoundary>
```

The fallback renders a full-page error with technical details (in dev) and a reload button.

### 404 Handling

Unknown routes render a `NotFound` component with a "Go to Dashboard" button.

### safeFindOne Pattern

The `@adobe/aio-lib-db` throws an error when `findOne` matches no documents. All actions use:

```javascript
async function safeFindOne(collection, query) {
  try {
    return await collection.findOne(query)
  } catch (e) {
    if (e.message?.includes('Document not found')) return null
    throw e
  }
}
```

---

## Testing Strategy

### Unit Tests (`test/`)

```bash
npm test                    # or: aio app test
```

- Test individual action logic
- Mock `@adobe/aio-lib-db` and `@adobe/aio-lib-files`
- Validate input parsing, error responses, business logic

### End-to-End Tests (`e2e/`)

```bash
npm run e2e                 # or: aio app test --e2e
```

- Test deployed actions via HTTP
- Validate response shapes and status codes
- Require deployed environment

### Test Configuration

```javascript
// jest.setup.js
// Global test setup (mocks, env vars)
```

---

## Deployment

### Development

```bash
aio app dev                 # Local dev server (actions + UI hot reload)
```

- Actions served locally via Runtime emulator
- UI at `https://localhost:9080`
- Live reload on file changes

### Staging/Production

```bash
aio app deploy              # Full deployment
```

Deploys:
1. All actions to Adobe I/O Runtime (webpack bundled)
2. Static assets to CDN
3. Registers alarm triggers and rules

### API Mesh Deployment

```bash
aio api-mesh:update mesh/mesh.json
```

Must be run separately when mesh config changes. Update the `baseUrl` in `mesh.json` to match your namespace before deploying.

### Undeploy

```bash
aio app undeploy            # Remove all actions, assets, triggers
```

---

## Performance Considerations

### Database

- **Pagination**: All list queries use `skip`/`limit` (never fetch all records)
- **Projections**: Use `fields` parameter to select only needed columns
- **Indexing**: `entity` field is used as partition key in all queries

### API Mesh Caching

- Browser: 60s `max-age`
- CDN: 120s `s-maxage`
- No L2 (application-level) caching — ensures data freshness

### Frontend

- **Code splitting**: Webpack bundles per route (via App Builder CLI)
- **Lazy loading**: Components loaded on route navigation
- **Pagination**: All lists paginated (default 20 items/page)

### Action Timeouts

Default Runtime timeout: 60 seconds. Archive operations on large entities may need increased limits.

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| `EADDRINUSE :9080` | Previous dev server still running | `lsof -ti :9080 | xargs kill -9` |
| `EADDRINUSE :35729` | LiveReload port conflict | `lsof -ti :35729 | xargs kill -9` |
| `Document not found` error | `findOne` with no match | Use `safeFindOne` pattern |
| Empty entity picker | `entityName` vs `entity` field mismatch | Ensure picker uses `e.entityName` |
| Mesh 404 on filters | Filters not JSON-encoded | Pass as `JSON.stringify({...})` |
| Auth failure in Mesh | Missing `x-forwarded-authorization` | Check mesh.json operationHeaders |
| Large file upload timeout | File exceeds Runtime limits | Increase timeout or chunk uploads |

### Debug Logging

All actions support `LOG_LEVEL` input (default: `debug`):

```bash
# View action logs
aio runtime activation logs <activation-id>

# List recent activations
aio runtime activation list --limit 10
```

### Local Debugging

With `aio app dev` running:
1. Set breakpoints in VS Code
2. Attach to Node.js debugger (port shown in terminal)
3. Trigger action via UI or curl

### Useful Commands

```bash
# Check deployed actions
aio runtime action list

# Invoke action directly
aio runtime action invoke pimapp/dashboard --result

# View action details
aio runtime action get pimapp/file-list

# Check triggers
aio runtime trigger list

# Check rules
aio runtime rule list

# Update API Mesh
aio api-mesh:update mesh/mesh.json

# Get Mesh endpoint URL
aio api-mesh:get
```

---

## Contributing

### Code Style

- ESLint config in `package.json` (extends standard)
- No semicolons in action code (project convention)
- React Spectrum components for all UI elements
- Functional components with hooks only (no class components)

### Adding a New Action

1. Create `actions/<action-name>/index.js`
2. Add entry to `app.config.yaml` under `packages.pimapp.actions`
3. Add URL to `web-src/src/config.json`
4. Add unit test in `test/<action-name>.test.js`
5. Run `aio app dev` to verify

### Adding a New UI Route

1. Create component in `web-src/src/components/<Name>.js`
2. Add `<Route>` in `App.js`
3. Add navigation link in `SideBar.js`
4. Add breadcrumb label in `HeaderBar.js`

---

*DataHub v2.0.0 • Adobe App Builder • Node.js 22 • React Spectrum • API Mesh*
