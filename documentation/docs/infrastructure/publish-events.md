---
title: "Publish Events"
sidebar_position: 35
description: "Technical documentation for the Publish Events feature in DataHub Platform."
custom_edit_url: https://github.com/mayur434/pimapp/blob/main/actions/publish-events/index.js
---

> Publishes CloudEvents to Adobe I/O Events for downstream integration notifications on data mutations.

## Overview

The Publish Events action sends structured CloudEvents to Adobe I/O Events whenever data is mutated. This enables event-driven architectures where downstream systems can subscribe to data change notifications.

## Technical Specification

### Action Endpoint
| Property | Value |
|----------|-------|
| **Action Name** | `publish-events` |
| **Runtime** | Adobe I/O Runtime (Node.js 22) |
| **Authentication** | Adobe IMS (require-adobe-auth) |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `apiKey` | string | Yes | Adobe API key |
| `providerId` | string | Yes | Events provider ID |
| `eventCode` | string | Yes | Event type code |
| `payload` | object | Yes | Event data payload |

### Headers Required

| Header | Description |
|--------|-------------|
| `Authorization` | Bearer IMS token |
| `x-gw-ims-org-id` | Adobe IMS Organization ID |

### Response Structure

```json
{
  "statusCode": 200,
  "body": { "message": "Event published successfully" }
}
```

## Architecture & Data Flow

```
Mutation Action (record-crud, bulk-update, etc.)
    │
    ▼
publishMutationEvent(params, eventData)  ← Called internally
    │
    ▼
┌─────────────────────────────┐
│ Build CloudEvent            │
│ • id: UUID v4               │
│ • type: eventCode           │
│ • source: provider URI      │
│ • data: mutation payload    │
│ • time: ISO timestamp       │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ Adobe I/O Events SDK        │
│ Events.publishEvent(event)  │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ 200: Published              │
│ 204: No registrations       │
│ (event delivered to webhook │
│  or journal subscribers)    │
└─────────────────────────────┘
```

## Security Considerations

- **Internal Only**: Called by other actions, not directly by external clients
- **IMS Scoped**: Events published under the app's IMS org context
- **Non-Blocking**: Event publishing is fire-and-forget (failures don't block mutation)

## Related Features

- [Record CRUD](../data-management/record-crud.md) — Publishes events on mutations
- [MDM Data](../public-api/mdm-data.md) — Publishes events on partner mutations
- [Bulk Update](../data-management/bulk-update.md) — Publishes batch mutation events

---
*Last updated: 2025-05-08*
*Source: `actions/publish-events/index.js`*
