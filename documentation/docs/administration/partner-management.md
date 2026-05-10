---
title: "Partner Management"
sidebar_position: 41
description: "Technical documentation for the Partner Management feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/datahub-app/blob/main/actions/partner-management/index.js
---

> CRUD for integration partners with secure credential generation, master-level access scoping, and key lifecycle management.

## Overview

The Partner Management action handles onboarding and lifecycle management of external integration partners. Partners are external systems that access the public API (`mdm-data`) using API keys rather than Adobe IMS tokens.

Each partner receives a unique ID (`ptr_...`) and secret key (`pk_...`) at creation time. The key is shown **only once** (at creation) and stored hashed. Partners are scoped to specific masters via `allowedMasters`.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `partner-management` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `partners` |

### Operations

| Operation (`op`) | Description |
|-----------------|-------------|
| `list` (default) | List all partners (keys stripped) |
| `create` | Create new partner with generated credentials |
| `update` | Modify partner properties, optionally regenerate key |
| `delete` | Soft-delete partner |

### Input Parameters

**create:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Partner display name |
| `description` | string | No | Purpose description |
| `contactEmail` | string | Yes | Partner contact |
| `allowedMasters` | array | Yes | Masters this partner can access |
| `status` | string | No | `active` or `inactive` (default: active) |

### Response Structure

**Create (one-time key disclosure):**
```json
{
  "status": "success",
  "partner": {
    "partnerId": "ptr_a1b2c3d4e5f6",
    "name": "ERP Integration",
    "partnerKey": "pk_abcdef123456...48chars...",
    "allowedMasters": ["products", "inventory"],
    "status": "active",
    "createdAt": "2025-05-08T10:30:00Z"
  },
  "message": "Partner created. Save the partnerKey — it will not be shown again."
}
```

**List (keys never exposed):**
```json
{
  "partners": [
    {
      "partnerId": "ptr_a1b2c3d4e5f6",
      "name": "ERP Integration",
      "keyConfigured": true,
      "allowedMasters": ["products"],
      "status": "active"
    }
  ]
}
```

## Architecture & Data Flow

### Credential Generation

```javascript
// Partner ID: 12 random chars prefixed with ptr_
const partnerId = 'ptr_' + crypto.randomBytes(6).toString('hex')

// Partner Key: 48 random chars prefixed with pk_
const partnerKey = 'pk_' + crypto.randomBytes(24).toString('hex')

// Store hashed key (never store plaintext)
const keyHash = crypto.createHash('sha256').update(partnerKey).digest('hex')
```

### Key Regeneration

On `update` with `regenerateKey: true`:
1. Generate new key
2. Hash and store
3. Return new key (one-time)
4. Old key immediately invalidated

## Security Considerations

- **One-Time Key Display**: Key shown only at creation/regeneration
- **Hashed Storage**: Keys stored as SHA-256 hash
- **Master Scoping**: Partner can only access explicitly listed masters
- **Soft Delete**: Deactivated partners cannot authenticate
- **Key Stripping**: List operations never return key data

## Related Features

- [MDM Data](../public-api/mdm-data.md) — Where partner credentials are used for authentication
- [User Management](./user-management.md) — Internal user access (complement)

---
*Last updated: 2025-05-08*
*Source: `actions/partner-management/index.js`*
