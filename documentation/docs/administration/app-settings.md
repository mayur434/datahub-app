---
title: "App Settings"
sidebar_position: 44
description: "Technical documentation for the App Settings feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/pimapp/blob/main/actions/app-settings/index.js
---

> Application-wide configuration management with environment-variable defaults, database overrides, deep-merge strategy, and active session tracking.

## Overview

The App Settings action manages all platform-wide configuration. Settings are structured in categories and follow a three-layer merge strategy: **Environment Variables** (highest priority, infrastructure) → **Database Stored** (admin-configurable) → **Defaults** (code-defined fallbacks).

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `app-settings` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `settings` (write); read open to authenticated users |

### Settings Categories

| Category | Settings |
|----------|----------|
| `general` | App name, timezone, environment label |
| `guardrails` | Max storage MB, max collections, max docs per collection, max doc size |
| `dataManagement` | Default page size, max page size, bulk batch size, query timeout |
| `api` | Rate limit per minute, cache TTL, CORS origins |
| `audit` | Retention days, archive format, max log size |
| `security` | Session timeout, max sessions, token cache TTL |
| `ui` | Theme, date format, records per page |
| `notifications` | Email notifications enabled, alert thresholds |
| `performance` | Metrics cache TTL, dashboard cache TTL |
| `archival` | Global archival defaults (threshold, retention, format) |

### Merge Strategy

```
┌─────────────────────────────────┐
│ ENV VARS (highest priority)     │ ← Infrastructure values NEVER overridden
│ MDM_MAX_STORAGE_MB, DB_REGION,  │
│ RATE_LIMIT_PER_MINUTE, etc.     │
├─────────────────────────────────┤
│ DATABASE STORED (admin writes)  │ ← Configurable via Admin UI
│ Everything else                 │
├─────────────────────────────────┤
│ CODE DEFAULTS (fallback)        │ ← Applied when no DB value exists
└─────────────────────────────────┘
```

### Session Management

| Operation | Description |
|-----------|-------------|
| `sessionOperation: 'register'` | Track active user session |
| `sessionOperation: 'deregister'` | Remove session on logout/close |

## Security Considerations

- **Env-Var Protection**: Infrastructure values (storage limits, rate limits) cannot be overridden via the API
- **Bound Validation**: Numeric settings validated within safe ranges
- **Cache Invalidation**: Settings cache cleared on write to ensure immediate propagation

## Related Features

- [MDM Utilities](../core/mdm-utils.md) — Consumes settings via `getCachedSettings()`
- [Infra Metrics](../infrastructure/infra-metrics.md) — Reports against configured guardrails
- [User Management](./user-management.md) — Settings piggybacked on resolve

---
*Last updated: 2025-05-08*
*Source: `actions/app-settings/index.js`*
