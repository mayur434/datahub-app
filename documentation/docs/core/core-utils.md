---
title: "Core Utilities"
sidebar_position: 1
description: "Technical documentation for the Core Utilities feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/pimapp/blob/main/actions/utils.js
---

> Shared utility functions providing standardized request validation, error handling, and response formatting across all DataHub actions.

## Overview

The Core Utilities module (`actions/utils.js`) provides foundational helper functions that every action in the DataHub platform depends on. It establishes consistent patterns for parameter validation, authentication token extraction, error response formatting, and secure logging.

This module is intentionally dependency-free (pure JavaScript) to minimize cold-start times and ensure reliability. Every serverless action imports these utilities as the first step in its execution pipeline.

## Technical Specification

### Module Location
| Property | Value |
|----------|-------|
| **File** | `actions/utils.js` |
| **Type** | CommonJS module |
| **Dependencies** | None (pure utility) |
| **Consumers** | All action `index.js` files |

### Exported Functions

| Function | Signature | Purpose |
|----------|-----------|---------|
| `stringParameters` | `(params) → string` | Sanitizes parameters for safe logging |
| `getMissingKeys` | `(obj, required) → string[]` | Validates presence of required keys |
| `checkMissingRequestInputs` | `(params, requiredParams, requiredHeaders) → string|null` | Full request validation |
| `getBearerToken` | `(params) → string` | Extracts Bearer token from headers |
| `errorResponse` | `(statusCode, message, logger) → object` | Creates standardized error response |

## Code Walkthrough

### `stringParameters(params)`

Converts action parameters to a loggable string while redacting sensitive values.

**Redacted fields:**
- `client_secret` — replaced with `<hidden>`
- `authorization` — replaced with `<hidden>`

```javascript
// Usage in any action:
logger.info(stringParameters(params))
// Output: "param1: value1, authorization: <hidden>, ..."
```

**Security Note:** This function prevents accidental token/secret leakage in logs. All actions MUST use this instead of `JSON.stringify(params)` for logging.

### `getMissingKeys(obj, required)`

Validates that an object contains all required keys. Supports **dot-notation** for nested key validation.

```javascript
// Flat keys
getMissingKeys({ name: 'test' }, ['name', 'email'])
// Returns: ['email']

// Nested keys (dot notation)
getMissingKeys({ __ow_headers: { authorization: 'Bearer ...' } }, ['__ow_headers.authorization'])
// Returns: [] (key exists)
```

**Implementation:** Splits dot-notation keys and traverses the object tree. Returns the full dot-path for any missing key.

### `checkMissingRequestInputs(params, requiredParams, requiredHeaders)`

High-level request validation combining parameter and header checks.

```javascript
const errorMessage = checkMissingRequestInputs(params, ['master', 'operation'], ['authorization'])
if (errorMessage) {
  return errorResponse(400, errorMessage, logger)
}
```

**Behavior:**
1. Checks `requiredParams` against top-level `params` keys
2. Checks `requiredHeaders` against `params.__ow_headers` (lowercased)
3. Returns formatted error string: `"missing parameter(s) 'master,operation' and missing header(s) 'authorization'"`
4. Returns `null` if all validations pass

### `getBearerToken(params)`

Extracts the raw JWT/access token from the Authorization header.

```javascript
const token = getBearerToken(params)
// From header "Bearer eyJhbG..." → returns "eyJhbG..."
```

**Implementation:** Reads `params.__ow_headers.authorization`, strips the `"Bearer "` prefix.

### `errorResponse(statusCode, message, logger)`

Creates the standard error response object used across all actions.

```javascript
return errorResponse(500, 'Database connection failed', logger)
// Returns:
// {
//   error: {
//     statusCode: 500,
//     body: { error: 'Database connection failed' }
//   }
// }
```

**Behavior:** Logs the error message at `info` level (for audit trail), then returns the structured error object that Adobe I/O Runtime translates into an HTTP response.

## Architecture & Data Flow

```
┌─────────────────────────────────────────────────────┐
│                   Action Entry Point                  │
│                     main(params)                      │
├─────────────────────────────────────────────────────┤
│  1. stringParameters(params)     → Safe logging      │
│  2. checkMissingRequestInputs()  → Validate request  │
│  3. getBearerToken(params)       → Extract auth      │
│  4. ... business logic ...                           │
│  5. errorResponse(code, msg)     → On failure        │
└─────────────────────────────────────────────────────┘
```

## Security Considerations

- **Token Redaction**: `stringParameters` ensures tokens never appear in logs
- **Header Case Normalization**: All header checks use lowercased keys (HTTP headers are case-insensitive)
- **No Token Validation**: This module only extracts tokens; validation is handled by `mdm-utils.js`

## Related Features

- [MDM Utilities](./mdm-utils.md) — Extended utilities for database, auth, and RBAC
- All action features depend on this module

---
*Last updated: 2025-05-08*
*Source: `actions/utils.js`*
