---
slug: /
sidebar_position: 1
title: Getting Started
description: DataHub MDM Platform — comprehensive technical documentation for all features, APIs, and architecture.
---

# DataHub Platform — Technical Documentation

> Comprehensive technical reference for all DataHub MDM platform features, APIs, and internal architecture.

## Platform Overview

**DataHub** is an enterprise Master Data Management (MDM) platform built on **Adobe App Builder** (I/O Runtime). It provides a complete suite of tools for managing, governing, and distributing master data across an organization.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Adobe Experience Cloud Shell                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              React SPA (Admin UI)                          │  │
│  │   Dashboard │ Records │ Files │ Schema │ Settings          │  │
│  └──────────────────────┬────────────────────────────────────┘  │
│                         │ HTTPS + IMS Token                     │
│  ┌──────────────────────▼────────────────────────────────────┐  │
│  │            Adobe I/O Runtime (Node.js 22)                  │  │
│  │  ┌─────────┐ ┌──────────┐ ┌───────────┐ ┌─────────────┐  │  │
│  │  │ generic │ │record-   │ │ query-    │ │ mdm-data    │  │  │
│  │  │(router) │ │crud      │ │ data      │ │ (public)    │  │  │
│  │  └────┬────┘ └─────┬────┘ └─────┬─────┘ └──────┬──────┘  │  │
│  │       │            │            │               │          │  │
│  │  ┌────▼────────────▼────────────▼───────────────▼──────┐  │  │
│  │  │              Adobe I/O Database (MongoDB)            │  │  │
│  │  │  masters │ _metadata │ _audit │ _users │ _partners  │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 16 + Adobe React Spectrum 3.4 |
| **Routing** | React Router 6 (HashRouter) |
| **Backend** | Adobe I/O Runtime (Node.js 22, serverless) |
| **Database** | Adobe I/O Database (MongoDB-compatible) |
| **State Cache** | Adobe I/O State (TTL-based key-value) |
| **File Storage** | Adobe I/O Files (cloud blob storage) |
| **Auth** | Adobe IMS (OAuth 2.0 + JWT) |
| **Events** | Adobe I/O Events (CloudEvents 1.0) |
| **CI/CD** | GitHub Actions → `aio app deploy` |

### Key Capabilities

- **25+ serverless actions** covering the full MDM lifecycle
- **Role-Based Access Control (RBAC)** with feature-level and data-level permissions
- **Multi-master architecture** — unlimited independent data collections
- **Schema enforcement** with dynamic field validation
- **Full audit trail** on every data mutation
- **Automated archival** with configurable retention policies
- **Public GraphQL-ready APIs** for downstream consumers
- **CloudEvents publishing** for real-time integration

## Documentation Structure

| Category | Description |
|----------|-------------|
| [**Core**](/core/core-utils) | Foundation modules — shared utilities, DB helpers, RBAC |
| [**Data Management**](/data-management/record-crud) | Record CRUD, queries, bulk updates, schema, files |
| [**Public API**](/public-api/mdm-data) | External-facing APIs for data consumers |
| [**Infrastructure**](/infrastructure/dashboard) | Dashboard, archival, metrics, event publishing |
| [**Administration**](/administration/user-management) | User/partner management, auditing, app settings |

## Common Patterns

### Authentication & Authorization Flow

Every action follows this standardized flow:

```js
// 1. Extract IMS token from request headers
const token = getBearerToken(params);

// 2. Validate required parameters
const requiredParams = checkMissingRequestInputs(params, ['master', 'operation']);

// 3. Verify user permissions via RBAC
const user = await validateUserAccess(db, token, 'feature_name');

// 4. Check data-level access (master restrictions)
if (user.allowedMasters && !user.allowedMasters.includes(params.master)) {
  return errorResponse(403, 'Access denied to this master');
}
```

### Database Collection Naming

| Collection | Purpose |
|-----------|---------|
| `{masterName}` | Primary data records |
| `{masterName}_metadata` | Schema, field config, visibility rules |
| `_audit` | Cross-master audit trail |
| `_users` | User profiles and RBAC permissions |
| `_partners` | Partner/tenant configuration |
| `_app_settings` | Platform-wide configuration |
| `_archive_{masterName}_{timestamp}` | Point-in-time data snapshots |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `AIO_RUNTIME_NAMESPACE` | I/O Runtime namespace identifier |
| `DATABASE_NAME` | Database instance name |
| `DATABASE_REGION` | Database region (`apac`, `us`, `eu`) |
| `SERVICE_API_KEY` | Adobe service API key |
