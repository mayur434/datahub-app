# Changelog

All notable changes to **DataHub App** are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased] — feature/performance-optimisation

### Added — Enterprise Features (`830de17`)

- **Record Versioning** — Auto-snapshot on every update, patch, and delete; configurable max versions per record (default 50); full rollback to any previous version
- **Data Quality Scoring** — Per-record completeness score (0–100) with weighted fields (required = 3 pts, optional = 1 pt, format-valid = +1 bonus); entity-level aggregate metrics with distribution breakdown (excellent/good/fair/poor) and per-field completeness percentages
- **Duplicate Detection** — Trigram similarity matching (Dice coefficient) across configurable fields; adjustable threshold (default 80%); capped pairwise comparison for serverless safety
- **Approval Workflow** — Six-state lifecycle: `draft → pending_review → approved → rejected → published → archived`; enforced transition rules; versioned status changes with optional review comments
- **Webhook Subscriptions** — Partner-scoped HTTPS endpoints; HMAC-SHA256 payload signatures; per-event + per-master filtering; auto-disable after 10 consecutive delivery failures; 5s timeout per delivery
- **Data Export** — CSV, JSON, and JSONL formats; field selection; filter support; date-range queries; inline response for small datasets (≤ 5 000 records); presigned download URL via `aio-lib-files` for large exports (≤ 50 000 records); 2-minute action timeout
- **API Key Rotation** — Rotate partner keys with configurable expiry (default 365 days); expired keys are rejected at validation time; key shown once on rotation
- **Cross-Entity References** — Schema fields can define `reference: { master, fields }` for FK lookups; batch resolution with `resolveRecordReferences()`

### Added — New Backend Action

- `data-export` — Unified action for export, preview, quality, duplicates, version history, and rollback operations; registered in `app.config.yaml` with 120s timeout

### Added — Partner Management Extensions

- `rotate-key` operation — Generate new API key with expiry date
- `register-webhook` — Create webhook subscription for a partner
- `list-webhooks` — List all webhook subscriptions (secrets stripped)
- `delete-webhook` — Remove a webhook subscription

### Added — Frontend Invoker Functions

- `exportData()`, `previewExport()`, `fetchDataQuality()`, `findDuplicates()`
- `fetchRecordVersions()`, `rollbackRecord()`, `transitionRecordStatus()`
- `rotatePartnerKey()`, `registerWebhook()`, `fetchWebhooks()`, `deleteWebhook()`

### Changed — Record CRUD

- Create sets `workflowStatus` to `draft` (if approval workflow enabled) or `published` (default, backwards-compatible)
- Update, patch, and delete now create version snapshots before mutation
- All mutations dispatch webhook notifications in parallel (best-effort)
- New `transition` / `status` operation for approval workflow state changes

### Changed — Partner Validation

- `validatePartner()` now checks `keyExpiresAt` — expired keys return `403` with rotation instructions
- New partner records include `keyExpiresAt` (default 1 year from creation)

### Fixed — Technical Audit Findings

- **mdm-data & mdm-facets** — Replaced weak auth header length check (`length < 20`) with proper Bearer token prefix validation
- **app-settings** — Added `enforceAppPermission()` RBAC check for POST/update operations; previously any authenticated IMS user could modify system settings
- **archive-run** — Removed duplicated `getDbClient()` / `safeFindOne()` / `getMasterCollectionName()` functions; now imports from `mdm-utils` for single source of truth
- **archive-run** — Added secondary sort key (`primaryKey`) to archive query for deterministic record ordering when `createdAt` values are identical
- **infra-metrics** — Replaced `estimatedDocumentCount()` with `countDocuments({})` for accurate storage metrics
- **infra-metrics** — Entity growth calculation now subtracts delete operations instead of only counting writes
- **audit-cleanup** — File deletion failures now mark archive as `purge-failed` instead of silently continuing; prevents false "expired" status when files still exist

---

## [1.3.0] — 2026-05-10 — Performance & Security (`cf8f9be`)

### Fixed

- **SWR Cache** — Skip revalidation when cache is fresh (saves 1–3 redundant API calls per navigation)

### Added

- **In-flight Request Deduplication** — Concurrent identical GET calls share a single promise; prevents duplicate fetches on rapid navigation

### Changed

- **Webpack Source Maps** — Production builds use `source-map` (external file) instead of `inline-source-map`; halves bundle size
- **Module-level Config Cache** — `getEnvConfig()` result cached at module scope; avoids re-parsing env vars per invocation
- **Deferred Session Registration** — `registerSession()` delayed 2 s on startup to avoid competing with `resolveCurrentUser`

### Security

- **CORS Hardening** — Restricted `Access-Control-Allow-Origin` to `https://experience.adobe.com` and `https://localhost:9080` with `Vary: Origin`; wildcard `*` removed from all internal actions
- **IMS Profile Timeout** — 5 s `AbortController` timeout on IMS profile API fallback; prevents hanging requests

---

## [1.2.0] — 2026-05-10 — Documentation & Deployment (`bbc7e33`, `103de53`)

### Added

- **Docusaurus Documentation Site** — Full API and admin docs at `https://mayur434.github.io/datahub-app/`
- **GitHub Actions Workflow** — `deploy_docs.yml` auto-deploys docs on push to `main` (when `documentation/**` changes) or manual trigger
- **Help Button** — Header bar help icon opens documentation site in new tab

### Fixed

- **Repo Rename** — Updated all `baseUrl`, `projectName`, `editUrl`, and GitHub links from `pimapp` to `datahub-app`

### Removed

- **Sidebar Documentation Link** — Removed redundant "Documentation ↗" external link from sidebar navigation

---

## [1.1.0] — 2026-05-09 — App Optimisation (`b17b1aa` → `e512124`)

### Added

- **User Management** — Full user/role CRUD with RBAC; 12 granular feature permissions; system roles (Super Admin, Viewer); custom role creation; bulk user onboarding
- **Query Console Enhancements** — Dynamic GraphQL query builder; code generation in 4 languages (cURL, JavaScript, Python, Ruby)
- **Architecture Diagram** — Visual system architecture reference
- **Theme Provider** — Light/dark mode toggle
- **Partner Console** — Partner onboarding, credential management, status control
- **Archive Management** — Configurable per-entity archival with retention policies
- **Infra Metrics** — 6 report types: storage breakdown, guardrail usage, failure analysis, collection stats, audit summary, performance metrics

### Changed

- **Record Manager** — Inline CRUD with field-level validation
- **File Upload** — CSV wizard with schema preview and facet configuration
- **Dashboard** — KPI cards with cached metrics (15 min TTL)
- **API Mesh** — Expanded GraphQL schema with bulk operations

---

## [1.0.0] — 2026-05-08 — Initial Release (`07771ad`)

### Added

- **Core MDM Platform** — Entity-agnostic master data management with per-master collections
- **CSV Import** — Auto-schema detection, primary key inference, validation
- **3 Update Strategies** — Full replace, delta (upsert/update-only/insert-only/mixed), bulk batch
- **Schema Management** — Add, remove, rename, update fields with type validation
- **Faceted Search** — Value, range, and boolean aggregations with live counts
- **GraphQL Public API** — 12 operations via Adobe API Mesh (queries + mutations + bulk)
- **Partner Integration** — Credential-based access with constant-time key comparison
- **Audit Trail** — All CRUD operations logged; 90-day retention; auto-compress to CSV.gz
- **Scheduled Jobs** — Daily audit cleanup (2 AM UTC) and archive run (3 AM UTC)
- **Rate Limiting** — Per-IP sliding window via `aio-lib-state` (60 s TTL)
- **Storage Guardrails** — File size, per-entity record, global document, and storage limits
- **React SPA** — 12 pages with Adobe React Spectrum UI, lazy-loaded routes, responsive layout
