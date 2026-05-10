---
title: "User Management"
sidebar_position: 40
description: "Technical documentation for the User Management feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/datahub-app/blob/main/actions/user-management/index.js
---

> Full CRUD for application users and custom roles with dynamic granular permissions, bulk user creation, and session management.

## Overview

The User Management action handles all operations related to application users and their access roles. It implements a flexible RBAC system where custom roles define feature-level permissions, and users are assigned roles.

The `resolve` operation is special — it's called on every page load to determine the current user's permissions and is cached aggressively for performance.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `user-management` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS Token |
| **RBAC Permission** | `user_management` (except `resolve` which is open) |

### Operations

| Operation (`op`) | Permission Required | Description |
|-----------------|-------------------|-------------|
| `resolve` | Any authenticated user | Returns current user's permissions + settings |
| `users` | `user_management` | List all users |
| `roles` | `user_management` | List all roles |
| `create-user` | `user_management` | Create single user |
| `bulk-create-users` | `user_management` | Create up to 500 users |
| `update-user` | `user_management` | Modify user properties |
| `delete-user` | `user_management` | Soft-delete user |
| `create-role` | `user_management` | Create custom role |
| `update-role` | `user_management` | Modify role permissions |
| `delete-role` | `user_management` | Delete role (if no users assigned) |

### Input Parameters (varies by operation)

**create-user:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `email` | string | Yes | User email (validated format) |
| `firstName` | string | Yes | First name |
| `lastName` | string | Yes | Last name |
| `roleId` | string | Yes | Assigned role ID |

**create-role:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Role name (unique) |
| `description` | string | No | Role description |
| `permissions` | object | Yes | Feature permission map |

### Response Structure

**resolve:**
```json
{
  "user": {
    "email": "user@company.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "Super Admin",
    "permissions": {
      "dashboard": true,
      "masters": true,
      "import_data": true,
      "query_console": true,
      "activity_log": true,
      "partners": true,
      "admin_console": true,
      "settings": true,
      "record_management": true,
      "schema_management": true,
      "archive_management": true,
      "user_management": true
    }
  },
  "settings": { "...app settings..." }
}
```

## Architecture & Data Flow

### Resolve Flow (on every page load)

```
1. Extract email from IMS token
2. Check state cache: `user-resolve-<email>` (2-min TTL)
3. If cached → return immediately
4. If miss:
   a. Seed system roles (idempotent, 1-hour cache flag)
   b. Find user in app_users collection
   c. If not found + email matches INITIAL_ADMIN_EMAIL → auto-create as Super Admin
   d. If not found → return "Access Denied"
   e. Fetch user's role from app_roles
   f. Compute permissions from role
   g. Cache result (2-min TTL)
   h. Return user + piggybacked settings
```

### Auto-Provisioning (Bootstrap)

The first user (matching `INITIAL_ADMIN_EMAIL` env var) is automatically created as Super Admin on first resolve. This bootstraps the system without requiring manual DB access.

## Security Considerations

- **Email Validation**: Strict format validation prevents invalid entries
- **Duplicate Prevention**: Unique constraint on email field
- **Role Deletion Safety**: Cannot delete role with assigned users
- **Permission Key Validation**: All permission keys validated against `APP_FEATURES` enum
- **Bulk Limit**: Max 500 users per bulk-create to prevent abuse
- **Cache Invalidation**: User/role changes invalidate resolve cache immediately

## Related Features

- [MDM Utilities](../core/mdm-utils.md) — RBAC enforcement implementation
- [App Settings](./app-settings.md) — Piggybacked in resolve response
- [Partner Management](./partner-management.md) — External system access (complement to user access)

---
*Last updated: 2025-05-08*
*Source: `actions/user-management/index.js`*
