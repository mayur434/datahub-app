# DataHub — Admin Manual

> Complete administration guide for DataHub Enterprise MDM Platform.
> Use this manual to onboard clients, train team members, and demonstrate all platform capabilities.

---

## Table of Contents

- [1. Getting Started](#1-getting-started)
  - [1.1 Accessing DataHub](#11-accessing-datahub)
  - [1.2 First-Time Setup](#12-first-time-setup)
  - [1.3 Navigation Overview](#13-navigation-overview)
- [2. Dashboard](#2-dashboard)
  - [2.1 KPI Cards](#21-kpi-cards)
  - [2.2 Platform Status](#22-platform-status)
  - [2.3 Recent Activity](#23-recent-activity)
- [3. Importing Data](#3-importing-data)
  - [3.1 Preparing Your CSV](#31-preparing-your-csv)
  - [3.2 Upload Wizard](#32-upload-wizard)
  - [3.3 Schema Auto-Detection](#33-schema-auto-detection)
  - [3.4 Primary Key Selection](#34-primary-key-selection)
  - [3.5 Visibility & Access Settings](#35-visibility--access-settings)
  - [3.6 Facet Configuration During Import](#36-facet-configuration-during-import)
  - [3.7 Record-Level Audit Fields](#37-record-level-audit-fields)
  - [3.8 Import Validation & Error Handling](#38-import-validation--error-handling)
- [4. Entity Management](#4-entity-management)
  - [4.1 Entity List View](#41-entity-list-view)
  - [4.2 Entity Detail View](#42-entity-detail-view)
  - [4.3 Updating Entity Metadata](#43-updating-entity-metadata)
  - [4.4 Deleting an Entity](#44-deleting-an-entity)
- [5. Record Management](#5-record-management)
  - [5.1 Viewing Records](#51-viewing-records)
  - [5.2 Creating a Record](#52-creating-a-record)
  - [5.3 Editing a Record (Full Update)](#53-editing-a-record-full-update)
  - [5.4 Patching a Record (Partial Update)](#54-patching-a-record-partial-update)
  - [5.5 Deleting a Record](#55-deleting-a-record)
  - [5.6 Record-Level Audit Fields](#56-record-level-audit-fields)
- [6. Data Update Operations](#6-data-update-operations)
  - [6.1 Full Update (Replace All)](#61-full-update-replace-all)
  - [6.2 Delta Update (Merge/Upsert)](#62-delta-update-mergeupsert)
  - [6.3 Bulk Update (Batch Append)](#63-bulk-update-batch-append)
  - [6.4 Mixed-Action Delta (Advanced)](#64-mixed-action-delta-advanced)
- [7. Schema Management](#7-schema-management)
  - [7.1 Viewing the Schema](#71-viewing-the-schema)
  - [7.2 Adding a Field](#72-adding-a-field)
  - [7.3 Updating a Field](#73-updating-a-field)
  - [7.4 Renaming a Field](#74-renaming-a-field)
  - [7.5 Removing a Field](#75-removing-a-field)
  - [7.6 Schema Validation Rules](#76-schema-validation-rules)
  - [7.7 Field Visibility](#77-field-visibility)
- [8. Faceted Search Configuration](#8-faceted-search-configuration)
  - [8.1 What Are Facets](#81-what-are-facets)
  - [8.2 Enabling Facets on a Field](#82-enabling-facets-on-a-field)
  - [8.3 Facet Types](#83-facet-types)
  - [8.4 Facet Options](#84-facet-options)
  - [8.5 Testing Facets via Query Console](#85-testing-facets-via-query-console)
- [9. Version Control](#9-version-control)
  - [9.1 How Versioning Works](#91-how-versioning-works)
  - [9.2 Viewing Version History](#92-viewing-version-history)
  - [9.3 Rolling Back to a Previous Version](#93-rolling-back-to-a-previous-version)
  - [9.4 Version Auto-Pruning](#94-version-auto-pruning)
- [10. Archives & Backups](#10-archives--backups)
  - [10.1 How Archival Works](#101-how-archival-works)
  - [10.2 Configuring Archival per Entity](#102-configuring-archival-per-entity)
  - [10.3 Viewing Archive History](#103-viewing-archive-history)
  - [10.4 Downloading an Archive](#104-downloading-an-archive)
  - [10.5 Manual Archive Trigger](#105-manual-archive-trigger)
  - [10.6 Expired Archive Cleanup](#106-expired-archive-cleanup)
- [11. Query Console](#11-query-console)
  - [11.1 Building a Query](#111-building-a-query)
  - [11.2 Filter Syntax](#112-filter-syntax)
  - [11.3 Field Selection](#113-field-selection)
  - [11.4 Sorting & Pagination](#114-sorting--pagination)
  - [11.5 Enabling Facets in Query](#115-enabling-facets-in-query)
- [12. Activity Log (Audit)](#12-activity-log-audit)
  - [12.1 What Gets Logged](#121-what-gets-logged)
  - [12.2 Viewing the Audit Log](#122-viewing-the-audit-log)
  - [12.3 Searching & Filtering](#123-searching--filtering)
  - [12.4 Automatic Cleanup](#124-automatic-cleanup)
- [13. Partner Management](#13-partner-management)
  - [13.1 What Are Partners](#131-what-are-partners)
  - [13.2 Creating a Partner](#132-creating-a-partner)
  - [13.3 Partner Credentials](#133-partner-credentials)
  - [13.4 Managing Partner Access](#134-managing-partner-access)
  - [13.5 Suspending / Reactivating a Partner](#135-suspending--reactivating-a-partner)
  - [13.6 Deleting a Partner](#136-deleting-a-partner)
- [14. Public API (GraphQL via API Mesh)](#14-public-api-graphql-via-api-mesh)
  - [14.1 Endpoint & Authentication](#141-endpoint--authentication)
  - [14.2 Making an Entity Public](#142-making-an-entity-public)
  - [14.3 Enabling CRUD for External Consumers](#143-enabling-crud-for-external-consumers)
  - [14.4 Read Operations (No Auth)](#144-read-operations-no-auth)
  - [14.5 Write Operations (Partner Auth)](#145-write-operations-partner-auth)
  - [14.6 Bulk Operations](#146-bulk-operations)
  - [14.7 Facets via API](#147-facets-via-api)
  - [14.8 API Caching Behavior](#148-api-caching-behavior)
  - [14.9 Rate Limiting](#149-rate-limiting)
  - [14.10 Error Handling](#1410-error-handling)
- [15. Settings](#15-settings)
  - [15.1 General Settings](#151-general-settings)
  - [15.2 Data Management Settings](#152-data-management-settings)
  - [15.3 API Settings](#153-api-settings)
  - [15.4 Versioning Settings](#154-versioning-settings)
  - [15.5 Audit Settings](#155-audit-settings)
  - [15.6 Archival Settings](#156-archival-settings)
  - [15.7 Security Settings](#157-security-settings)
  - [15.8 UI Settings](#158-ui-settings)
  - [15.9 Performance Settings](#159-performance-settings)
  - [15.10 Notification Settings](#1510-notification-settings)
- [16. Role-Based Access Control (RBAC)](#16-role-based-access-control-rbac)
  - [16.1 Roles & Permissions](#161-roles--permissions)
  - [16.2 Per-Entity Role Overrides](#162-per-entity-role-overrides)
- [17. Scheduled Jobs (Automated Maintenance)](#17-scheduled-jobs-automated-maintenance)
- [18. Troubleshooting](#18-troubleshooting)
  - [18.1 Common Issues](#181-common-issues)
  - [18.2 Checking Action Logs](#182-checking-action-logs)
- [Appendix A: CSV Format Requirements](#appendix-a-csv-format-requirements)
- [Appendix B: Quick Reference Card](#appendix-b-quick-reference-card)

---

## 1. Getting Started

### 1.1 Accessing DataHub

DataHub runs inside **Adobe Experience Cloud**. To access it:

1. Open your browser and navigate to:
   ```
   https://experience.adobe.com/
   ```
2. Sign in with your Adobe IMS credentials (your organization's SSO).
3. From the Experience Cloud home, navigate to **Custom Apps** in the app switcher.
4. Click **DataHub** to launch the application.

> **For Development/Staging**: Use the dev mode URL:
> ```
> https://experience.adobe.com/?devMode=true#/@<your-org>/custom-apps/<namespace>
> ```

**Requirements**:
- Modern web browser (Chrome, Firefox, Edge, Safari)
- Valid Adobe IMS account with access to the organization
- Internet connectivity

### 1.2 First-Time Setup

When DataHub is freshly deployed, follow these steps:

1. **Review Settings**: Navigate to **Settings** (sidebar) and review all default configuration values. Key settings to check:
   - **Timezone**: Set your organization's timezone
   - **Default Page Size**: Records per page in all views
   - **Audit Retention**: How long to keep activity logs (default: 90 days)
   - **API Rate Limit**: Requests per minute for the public API

2. **Import Your First Dataset**: Navigate to **Import Data** and upload a CSV file. See [Section 3: Importing Data](#3-importing-data) for detailed instructions.

3. **Create Partners** (if using public API): Navigate to **Partners** and create integration partners. See [Section 13: Partner Management](#13-partner-management).

### 1.3 Navigation Overview

The application has a **sidebar** on the left for navigation and a **header bar** at the top showing breadcrumbs and the current user.

| Sidebar Item | Description |
|-------------|-------------|
| **Dashboard** | Overview: KPIs, platform status, recent activity |
| **Import Data** | Upload new CSV datasets |
| **Entities** | Browse and manage all data entities |
| **Query Console** | Ad-hoc query builder for data exploration |
| **Activity Log** | Complete audit trail of all operations |
| **Partners** | Manage external integration partners |
| **Settings** | Global application configuration |

When you drill into a specific entity, additional tabs appear:
- **Overview** — Entity details, record count, metadata
- **Records** — Data grid with CRUD operations
- **Schema** — Field definitions, types, validation rules
- **Versions** — Version history with rollback capability
- **Archives** — Archival configuration and download history

---

## 2. Dashboard

The Dashboard is the landing page when you open DataHub.

### 2.1 KPI Cards

The top section displays key metrics at a glance:

| Card | Description |
|------|-------------|
| **Total Entities** | Number of active data entities (masters) in the platform |
| **Total Records** | Sum of all records across all entities |
| **Public APIs** | Number of entities with `visibility: public` (accessible via API Mesh) |
| **Private APIs** | Number of entities with `visibility: private` (admin-only access) |
| **Total Versions** | Total version snapshots across all entities |
| **Audit Alerts** | Count of failed operations in the audit log |

### 2.2 Platform Status

Below the KPIs, status indicators show the health of connected services:

| Service | What It Checks |
|---------|---------------|
| **Database** | Connection to `@adobe/aio-lib-db` |
| **File Storage** | Connection to `@adobe/aio-lib-files` |
| **Authentication** | Adobe IMS token validation |
| **API Mesh** | GraphQL endpoint availability |

### 2.3 Recent Activity

Two panels show recent platform activity:

- **Recent Uploads**: Last 5 entities created or updated, with entity name, record count, and last modified date
- **Recent Logs**: Last 10 audit entries showing operation type, user, entity, and timestamp

> **Performance Note**: Dashboard data is cached for 15 minutes (configurable). Click the **Refresh** button to force a fresh computation. The cache badge indicates whether data is served from cache.

---

## 3. Importing Data

### 3.1 Preparing Your CSV

Before importing, ensure your CSV file meets these requirements:

| Requirement | Detail |
|------------|--------|
| **Format** | CSV (Comma-Separated Values) with a header row |
| **Encoding** | UTF-8 recommended |
| **Header Row** | First row must contain column names |
| **Data Rows** | At least one data row after the header |
| **Column Names** | Must not use reserved names: `_id`, `_entity`, `_version`, `_createdAt`, `_updatedAt`, `_createdBy`, `_updatedBy`, `_deleted`, `_status`, `_public` |
| **Unique Headers** | No duplicate column names allowed |
| **Quoted Fields** | Fields containing commas, quotes, or newlines must be wrapped in double-quotes. Escape internal quotes by doubling them (`""`) |

**Example CSV:**
```csv
master_id,sku,name,price,category,in_stock
P001,SKU-TSHIRT-BLK,Black T-Shirt,29.99,Apparel,true
P002,SKU-JEANS-BLU,Blue Jeans,79.99,Apparel,true
P003,SKU-SNEAKER-WHT,White Sneakers,129.99,Footwear,false
```

### 3.2 Upload Wizard

1. Navigate to **Import Data** from the sidebar or click the **Import** button on the Dashboard.
2. **Select your CSV file**: Drag and drop the file onto the upload area, or click to open the file picker.
3. **Enter an Entity Name** (Master Name):
   - Must be lowercase letters, numbers, and underscores only
   - Must start with a letter
   - Examples: `product_catalog`, `store_locations`, `customer_segments`
   - Cannot use reserved names or start with `mdm_`
4. **Optional: Display Name**: A human-readable label (e.g., "Product Catalog"). If omitted, the entity name is used.
5. **Optional: Description**: Brief description of the dataset.

### 3.3 Schema Auto-Detection

When you upload a CSV, DataHub automatically:
- Reads the header row to determine field names
- Infers field types (all fields default to `string` — you can change types later in Schema Manager)
- Marks the primary key field as `required`

No manual schema definition is needed. You can refine the schema after import.

### 3.4 Primary Key Selection

Every entity needs a **primary key** — a field that uniquely identifies each record.

**Options**:
- **Select from CSV columns**: Choose an existing column (e.g., `sku`, `product_id`). The column must have unique, non-empty values.
- **Auto-generate**: If you don't specify a primary key, DataHub automatically generates a `master_id` column with UUID values for every row.

**Rules**:
- The primary key column must exist in the CSV headers
- All primary key values must be unique within the dataset
- Primary key values cannot be empty
- The primary key field cannot be renamed or removed after creation

### 3.5 Visibility & Access Settings

During import, you can configure:

| Setting | Options | Default | Description |
|---------|---------|---------|-------------|
| **Visibility** | `private` / `public` | `private` | Private = admin-only. Public = accessible via API Mesh. |
| **CRUD Enabled** | `true` / `false` | `true` | Whether external consumers can create/update/delete records via the public API. |
| **Allowed Operations** | Object | All enabled | Fine-grained control: `read`, `create`, `update`, `patch`, `delete`, `bulkUpdate`, `fullUpdate`, `deltaUpdate` |

### 3.6 Facet Configuration During Import

You can pre-configure faceted search during import:

- **Facetable Fields**: Select which fields should be available as facets/aggregations in the API.
- **Facet Type**: `value` (distinct value counts), `range` (numeric buckets), `boolean` (true/false counts).
- **Sort**: By count or alphabetical.
- **Limit**: Maximum number of facet values to return.

Facets can also be configured after import via the Schema Manager.

### 3.7 Record-Level Audit Fields

Enable automatic audit trail fields injected into every record:

| Option | Field Added | Description |
|--------|------------|-------------|
| `createdAt` | `_createdAt` | Timestamp when the record was first created |
| `updatedAt` | `_updatedAt` | Timestamp of the last update |
| `createdBy` | `_createdBy` | User/partner who created the record |
| `updatedBy` | `_updatedBy` | User/partner who last updated the record |

These fields are automatically managed by the system and stripped if sent by external consumers.

### 3.8 Import Validation & Error Handling

After uploading, the system validates the CSV:

| Check | Error If |
|-------|----------|
| Minimum rows | CSV has fewer than 2 rows (header + 1 data row) |
| Reserved columns | Column names conflict with system fields |
| Duplicate headers | Two columns have the same name |
| Primary key present | Specified PK column not found in headers |
| PK uniqueness | Duplicate primary key values found |
| PK completeness | Empty primary key values found |
| Type validation | Number fields contain non-numeric values; boolean fields contain non-boolean values |
| Required fields | Required fields have empty values |
| Storage guardrail | Import would exceed platform storage limits |
| Duplicate entity | An entity with the same name already exists |

If validation fails, the system returns a detailed list of errors with row numbers. No data is written until all validations pass.

---

## 4. Entity Management

### 4.1 Entity List View

Navigate to **Entities** in the sidebar to see all imported entities.

**Features**:
- **Search**: Type in the search box to filter entities by name in real-time
- **Sort**: Click column headers to sort by name, record count, or last modified date
- **Bulk Delete**: Select multiple entities via checkboxes and delete them in batch
- **Per-Entity Actions** (click the three-dot menu on any row):
  - View Details
  - Manage Schema
  - Version History
  - Archives & Backups
  - Delete Entity

**Empty State**: If no entities exist, a friendly onboarding prompt appears with an "Import Data" button.

### 4.2 Entity Detail View

Click any entity name to open its detail view. This tabbed interface shows:

- **Overview Tab**: Entity metadata, record count, visibility, active version, creation/update timestamps, owner
- **Records Tab**: Paginated data grid with all records. See [Section 5: Record Management](#5-record-management).
- **Schema Tab**: Field definitions, types, validation rules. See [Section 7: Schema Management](#7-schema-management).
- **Versions Tab**: Version history timeline. See [Section 9: Version Control](#9-version-control).
- **Archives Tab**: Archival configuration and history. See [Section 10: Archives & Backups](#10-archives--backups).

### 4.3 Updating Entity Metadata

From the Entity Detail view, you can update:

- **Display Name**: Change the human-readable label
- **Description**: Update the entity description
- **Visibility**: Toggle between `private` and `public`
- **CRUD Enabled**: Enable/disable external CRUD operations
- **Allowed Operations**: Fine-tune which operations are permitted

Changes to metadata are versioned and logged in the audit trail.

### 4.4 Deleting an Entity

Deleting an entity performs a **cascade delete**:

1. The entity metadata document is removed
2. All records in the per-master collection (`mdm_<name>`) are deleted
3. All associated version snapshots are removed
4. An audit log entry is created

> **Warning**: Entity deletion is permanent and cannot be undone. Consider archiving data before deletion.

To delete:
1. From the Entity List, click the three-dot menu → **Delete Entity**
2. Confirm the deletion in the dialog
3. Or use bulk selection → **Delete Selected**

---

## 5. Record Management

### 5.1 Viewing Records

Navigate to an entity → **Records** tab to see all records in a paginated data grid.

**Features**:
- **Pagination**: Navigate through pages using Previous/Next controls. Page size is configurable.
- **Column Visibility**: Only fields marked as "visible" in the schema appear in the grid. Configure via Schema Manager.
- **Record Detail**: Click any row to view the full record as JSON.
- **Search**: Filter records by any visible field.

### 5.2 Creating a Record

1. In the Records tab, click **Add Record**.
2. Fill in the form fields. The form is auto-generated from the entity schema.
3. **Required fields** are marked with an asterisk (*).
4. The **primary key** field must be unique and non-empty.
5. Click **Create** to save.

**What happens behind the scenes**:
- The record is validated against the schema (types, required, patterns, min/max, enum)
- System audit fields are injected if configured (`_createdAt`, `_createdBy`)
- The record is inserted into the per-master collection
- The entity's record count is updated
- An audit log entry is created
- A mutation event is published (if event publishing is enabled)

### 5.3 Editing a Record (Full Update)

1. Click the **Edit** button on any record row.
2. Modify the field values. All fields must be provided (this is a full replacement).
3. Click **Save**.

The primary key cannot be changed during an update. The system automatically manages `_updatedAt` and `_updatedBy` fields.

### 5.4 Patching a Record (Partial Update)

1. Click the **Patch** button on any record row.
2. Only modify the fields you want to change.
3. Click **Save**.

Only the provided fields are merged into the existing record. Unmodified fields retain their current values.

### 5.5 Deleting a Record

1. Click the **Delete** button on any record row.
2. Confirm the deletion.

**Important**: Records are **soft-deleted** — they are flagged as `deleted: true` but not physically removed from the database. This means:
- Deleted records do not appear in query results
- Deleted records can potentially be recovered (database-level)
- The entity's record count is updated after deletion

### 5.6 Record-Level Audit Fields

If the entity has record-level audit enabled (configured during import or via settings), each record automatically includes:

| Field | Set On | Value |
|-------|--------|-------|
| `_createdAt` | Record creation | Timezone-adjusted timestamp |
| `_updatedAt` | Every update/patch | Timezone-adjusted timestamp |
| `_createdBy` | Record creation | User email or partner name |
| `_updatedBy` | Every update/patch | User email or partner name |

These fields are visible in the data grid and API responses. They cannot be manually set — any values sent by users are stripped and replaced with system-generated values.

---

## 6. Data Update Operations

DataHub supports three modes for updating existing entity data via CSV upload.

### 6.1 Full Update (Replace All)

**What it does**: Deletes all existing records and replaces them with the new CSV data.

**When to use**: When you have a complete, fresh dataset and want to replace everything.

**How to use**:
1. Navigate to the entity detail view
2. Click **Full Update** (or use the Import page with the entity name)
3. Upload your new CSV file
4. Confirm the replacement

**Behavior**:
- All existing records are deleted
- All records from the new CSV are inserted
- A new version snapshot is created
- The entity's record count is updated
- Storage guardrails are checked (net change = new records - old records)

> **Safety**: New records are inserted before old records are deleted, ensuring data is never lost even if the operation is interrupted.

### 6.2 Delta Update (Merge/Upsert)

**What it does**: Merges new/changed records into the existing dataset based on primary key matching.

**When to use**: When you have incremental changes — new records to add and existing records to update.

**Modes**:

| Mode | Behavior |
|------|----------|
| **upsert** (default) | If record exists → UPDATE. If new → INSERT. |
| **insert-only** | Only INSERT new records. Existing records are skipped. |
| **update-only** | Only UPDATE existing records. New records are skipped. |
| **mixed** | Use the `_action` column to specify per-row action. See [Section 6.4](#64-mixed-action-delta-advanced). |

**How to use**:
1. Navigate to the entity detail view
2. Click **Delta Update**
3. Upload your CSV file
4. Select the merge mode
5. Confirm

**Result**: Returns a summary with counts of inserted, updated, skipped, and errored records.

### 6.3 Bulk Update (Batch Append)

**What it does**: Appends records to the entity without deduplication.

**When to use**: When you want to add records in bulk without checking for duplicates.

### 6.4 Mixed-Action Delta (Advanced)

The most powerful update mode. Add a special `_action` column to your CSV to control what happens to each row individually.

**CSV format**:
```csv
_action,master_id,sku,name,price
CREATE,NEW-001,SKU-NEW,New Product,49.99
UPDATE,P001,SKU-TSHIRT-BLK,Updated T-Shirt,34.99
PATCH,P002,,,89.99
DELETE,P003,,,
```

**Supported actions**:

| `_action` | Behavior |
|-----------|----------|
| `CREATE` | Insert as a new record. Fails if primary key already exists. |
| `UPDATE` | Full replace of the existing record. All fields must be provided. |
| `PATCH` | Merge only the non-empty fields into the existing record. |
| `DELETE` | Soft-delete the record matching the primary key. |

The `_action` column is stripped from the actual record data — it is not stored.

---

## 7. Schema Management

### 7.1 Viewing the Schema

Navigate to an entity → **Schema** tab to see all field definitions.

Each field shows:
| Property | Description |
|----------|-------------|
| **Name** | Field name (matches CSV column header) |
| **Type** | `string`, `number`, `boolean`, `date` |
| **Required** | Whether the field must have a value |
| **Queryable** | Whether the field is indexed for fast filtering |
| **Facetable** | Whether the field is available for faceted search |
| **Editable** | Whether the field can be modified (primary key is always non-editable) |

The **Schema Version** is shown at the top (e.g., `schema-v3`). Every schema change increments this version.

### 7.2 Adding a Field

1. Click **Add Field** in the Schema tab.
2. Provide:
   - **Field Name** (required): Lowercase alphanumeric with underscores
   - **Type**: string, number, boolean, or date
   - **Required**: Whether this field must have a value in every record
   - **Default Value** (optional): If provided, all existing records are backfilled with this value
3. Click **Save**.

**Limits**: The maximum number of schema fields is configurable in Settings (default: 200).

**Data Migration**: If you provide a default value, DataHub iterates through all existing records and adds the new field with the default value. This happens automatically during the add operation.

### 7.3 Updating a Field

1. Click the **Edit** button on any field row.
2. You can change: `type`, `required`, `queryable`, `facetable`, `editable`.
3. **Restriction**: You cannot change the type of the primary key field.
4. Click **Save**.

### 7.4 Renaming a Field

1. Click the **Rename** button on any field row.
2. Enter the new field name.
3. Click **Confirm**.

**Important**: Renaming a field triggers a **data migration** — the system updates every record in the collection to replace the old field name with the new one. For large datasets, this may take several seconds.

**Restriction**: You cannot rename the primary key field.

### 7.5 Removing a Field

1. Click the **Remove** button on any field row.
2. Confirm the deletion.

**Restriction**: You cannot remove the primary key field.

**Note**: Removing a field from the schema does not delete the data from existing records — it only removes the field definition. The data remains in the records but is no longer validated or displayed.

### 7.6 Schema Validation Rules

Each field can have optional validation rules that are enforced on record creation and updates:

| Rule | Applies To | Description |
|------|-----------|-------------|
| **pattern** | string | Regular expression the value must match |
| **minLength** | string | Minimum string length |
| **maxLength** | string | Maximum string length |
| **min** | number | Minimum numeric value |
| **max** | number | Maximum numeric value |
| **enum** | any | Array of allowed values (whitelist) |
| **required** | any | Field must be non-empty |

**Example**: A `sku` field with:
```json
{
  "pattern": "^SKU-[A-Z0-9]{3,}$",
  "minLength": 7,
  "required": true
}
```
This ensures every SKU starts with "SKU-" followed by at least 3 uppercase alphanumeric characters, is at least 7 characters long, and is always present.

### 7.7 Field Visibility

Control which fields appear in the default data grid:

1. Navigate to the Schema tab.
2. Toggle the **Visible** switch on each field.
3. Hidden fields are not removed — they still exist in records and API responses. They are just hidden from the default grid view.

This is useful for entities with many fields where you want to show only the most relevant columns.

---

## 8. Faceted Search Configuration

### 8.1 What Are Facets

Facets provide aggregated counts for field values, similar to the left-sidebar filters on e-commerce sites. For example:

```
Brand:            Category:         Price Range:
  Nike (120)        Shoes (89)        $0-$50 (145)
  Adidas (89)       Apparel (76)      $50-$100 (89)
  Puma (45)         Accessories (23)  $100+ (34)
```

Facets are available both in the Admin Query Console and through the public GraphQL API.

### 8.2 Enabling Facets on a Field

1. Navigate to an entity → **Schema** tab.
2. Click the **Facet** toggle on a field to enable it.
3. Or configure facets in bulk via the **Update Facets** button.

### 8.3 Facet Types

| Type | Use Case | Example |
|------|----------|---------|
| **value** | Distinct value counts | Brand: Nike(120), Adidas(89) |
| **range** | Numeric range buckets | Price: 0-50(100), 50-100(50), 100+(25) |
| **boolean** | True/false counts | In Stock: Yes(200), No(15) |

### 8.4 Facet Options

Each facetable field has configurable options:

| Option | Default | Description |
|--------|---------|-------------|
| **label** | Field name | Display label in the API response |
| **sortBy** | `count` | Sort values by `count` (most frequent first) or `alpha` (alphabetical) |
| **sortOrder** | `desc` | `asc` or `desc` |
| **limit** | 50 | Maximum number of facet values to return |
| **showCount** | true | Include the count number with each value |
| **collapsed** | false | UI hint — whether the facet group should be collapsed by default |

### 8.5 Testing Facets via Query Console

1. Navigate to **Query Console**.
2. Select your entity.
3. Enable the **Facets** toggle.
4. Run the query.
5. The response includes an `aggregations` section with live facet values and counts.

---

## 9. Version Control

### 9.1 How Versioning Works

Every mutation that changes entity data or schema creates an **immutable version snapshot**. Versions are never modified — only new ones are added.

**Operations that create versions**:
- Initial CSV import (v1)
- Full update (dataset replacement)
- Delta update (merge/upsert)
- Schema changes (add, update, remove, rename field)
- Rollback (creates a new version pointing to the rollback target)

Each version records:
- **Version ID** (e.g., `v1`, `v2`, `v3`)
- **Operation type** (e.g., `initial-upload`, `full-update`, `schema-update-add`, `rollback`)
- **Created by** (user email)
- **Created at** (timestamp)
- **Record count** at the time of the version
- **Change summary** (e.g., `{ inserted: 500, updated: 0, deleted: 100 }`)

### 9.2 Viewing Version History

1. Navigate to an entity → **Versions** tab.
2. The version timeline shows all versions in reverse chronological order (newest first).
3. The **active version** is highlighted with a badge.
4. Each version shows: version ID, operation, user, timestamp, and record count.

### 9.3 Rolling Back to a Previous Version

1. In the Versions tab, find the version you want to restore.
2. Click the **Rollback** button next to that version.
3. Confirm the rollback in the dialog.

**What happens**:
- A new version is created (e.g., `v8`) with operation type `rollback`
- The entity's `activeVersionId` is updated to point to the new version
- The change summary records which version was rolled back to
- An audit log entry is created

> **Note**: Rollback changes the version pointer but does not currently restore record data to a previous snapshot. It creates a new version marker for tracking purposes.

### 9.4 Version Auto-Pruning

To prevent unlimited version accumulation, DataHub automatically prunes old versions:

- The maximum number of versions per entity is configurable in Settings (default configurable via `MAX_VERSIONS_PER_ENTITY` environment variable)
- When a new version is created and the count exceeds the limit, the oldest versions are deleted
- Pruning is best-effort — it never blocks the main operation

---

## 10. Archives & Backups

### 10.1 How Archival Works

The archival system manages entities that grow beyond a configurable threshold by:

1. **Detecting**: Checking if an entity's record count exceeds the configured threshold
2. **Extracting**: Selecting the oldest records (keeping the most recent `keepLatest` records)
3. **Storing**: Serializing extracted records to a file (CSV or JSON format) and uploading to blob storage
4. **Cleaning**: Deleting archived records from the active database to free space
5. **Tracking**: Recording archive metadata with a pre-signed download URL
6. **Notifying**: Sending a notification (if email is configured)

This runs automatically every day at **3:00 AM UTC** and can also be triggered manually.

### 10.2 Configuring Archival per Entity

1. Navigate to an entity → **Archives** tab.
2. Click **Configure Archival**.
3. Set the following:

| Setting | Default | Description |
|---------|---------|-------------|
| **Enabled** | false | Whether automatic archival is active for this entity |
| **Threshold** | 50,000 | Archive when record count exceeds this number |
| **Keep Latest** | 10,000 | Number of most recent records to retain after archival |
| **Retention Days** | 90 | How long to keep the archive file (days until download link expires) |
| **Archive Format** | csv | `csv` or `json` format for the archive file |
| **Notify Email** | (empty) | Email address for archive completion notifications |

**Example**: If threshold = 50,000 and keepLatest = 10,000:
- When an entity reaches 50,001 records, the next archive run will archive the 40,001 oldest records
- The 10,000 most recent records remain in the active database

### 10.3 Viewing Archive History

1. Navigate to an entity → **Archives** tab.
2. The archive history shows all completed archives with:
   - Archive ID
   - File name
   - Records archived
   - File size
   - Archived at (timestamp)
   - Expires at (when the download link expires)
   - Status (`active` or `expired`)

### 10.4 Downloading an Archive

Each active archive has a **pre-signed download URL**. Click the **Download** button to open the URL in a new tab.

**URL characteristics**:
- Pre-signed: No authentication required to download
- Time-limited: Expires after the configured retention period
- Served from `@adobe/aio-lib-files` blob storage

**File contents**:
- **CSV format**: Header row + data rows matching the entity schema
- **JSON format**: 
  ```json
  {
    "exportedAt": "2026-05-01T03:00:00+05:30",
    "recordCount": 40001,
    "records": [ { "field1": "value1", ... }, ... ]
  }
  ```

### 10.5 Manual Archive Trigger

You can trigger an archive run on-demand without waiting for the scheduled job:

1. Navigate to an entity → **Archives** tab.
2. Click **Run Archive Now**.
3. The archive runs immediately for this entity (if threshold conditions are met).

### 10.6 Expired Archive Cleanup

Archives that have passed their retention period are automatically cleaned up:
- The archive file is deleted from blob storage
- The archive metadata status is changed to `expired`
- Cleanup runs during the daily archive job (Phase 2)

---

## 11. Query Console

The Query Console is an administrative tool for ad-hoc data exploration.

### 11.1 Building a Query

1. Navigate to **Query Console** in the sidebar.
2. **Select Entity**: Choose an entity from the dropdown.
3. **Set Filters** (optional): Enter filter conditions.
4. **Set Pagination**: Page number and page size.
5. **Set Sort** (optional): Choose sort field and order.
6. **Select Fields** (optional): Specify which fields to return.
7. Click **Execute Query**.

The results appear in the output panel as formatted JSON with a size indicator showing the response payload size.

### 11.2 Filter Syntax

Enter filters as key-value pairs separated by `&`:

```
status=active&country=US&category=Electronics
```

Each filter matches records where the specified field equals the specified value.

**Supported filter operators** (via `key=value` syntax):
- Exact match: `sku=SKU-001`
- Multiple filters (AND logic): `brand=Nike&category=Shoes`

### 11.3 Field Selection

Specify a comma-separated list of field names to return only those fields:

```
master_id,sku,name,price
```

If omitted, all fields are returned.

### 11.4 Sorting & Pagination

| Parameter | Default | Description |
|-----------|---------|-------------|
| **Page** | 1 | Page number (1-based) |
| **Page Size** | Settings default | Records per page |
| **Sort Field** | Primary key | Field to sort by |
| **Sort Order** | asc | `asc` (ascending) or `desc` (descending) |

### 11.5 Enabling Facets in Query

Toggle the **Facets** switch to include aggregation data in the query response. This adds an `aggregations` section showing live facet values and counts for all configured facetable fields.

---

## 12. Activity Log (Audit)

### 12.1 What Gets Logged

Every platform operation is automatically logged in the audit trail:

| Category | Operations |
|----------|-----------|
| **Data Import** | `upload`, `full-update`, `delta-update`, `bulk-update` |
| **Record CRUD** | `create-record`, `update-record`, `patch-record`, `delete-record` |
| **Schema** | `schema-add-field`, `schema-update-field`, `schema-remove-field`, `schema-rename-field` |
| **Versioning** | `rollback` |
| **Entity** | `entity-delete`, `metadata-update`, `visibility-update` |
| **Archival** | `archive` |
| **Settings** | `settings-update` |
| **Partners** | `partner-create`, `partner-update`, `partner-delete` |

Each log entry includes:
- **Timestamp**: When the operation occurred
- **Operation**: What was done
- **Entity**: Which entity was affected
- **Actor**: Who performed the operation (user email or `system:scheduler`)
- **Status**: `success` or `failure`
- **Affected Records**: How many records were affected
- **Changes**: Field-level change details (old value → new value) for record updates
- **Record ID**: For single-record operations

### 12.2 Viewing the Audit Log

1. Navigate to **Activity Log** in the sidebar.
2. The log displays entries in reverse chronological order (newest first).

### 12.3 Searching & Filtering

- **Search**: Full-text search across all audit fields
- **Filter by Operation**: Select specific operation types
- **Filter by Entity**: Select specific entities
- **Filter by Date Range**: Narrow results to a time period
- **Pagination**: Navigate through large audit histories

### 12.4 Automatic Cleanup

Audit entries older than the configured retention period are automatically purged:

- **Schedule**: Daily at 2:00 AM UTC
- **Retention Period**: Configurable in Settings → Audit → Retention Days (default: 90 days)
- **What's deleted**: All audit entries with a timestamp older than the cutoff date

---

## 13. Partner Management

### 13.1 What Are Partners

Partners are external systems or teams that need programmatic access to your data via the GraphQL API. Each partner has:
- Unique credentials (ID + secret key)
- A list of entities they are authorized to access
- A status (active, suspended)

### 13.2 Creating a Partner

1. Navigate to **Partners** in the sidebar.
2. Click **Create Partner**.
3. Fill in:
   - **Name** (required): Descriptive name (e.g., "Commerce Frontend", "Mobile App")
   - **Description**: Brief description of the integration
   - **Contact Email**: Contact person for this integration
   - **Allowed Masters**: Select which entities this partner can access (at least one required)
4. Click **Create**.

### 13.3 Partner Credentials

Upon creation, the system generates:

| Credential | Format | Example |
|-----------|--------|---------|
| **Partner ID** | `ptr_<12 hex chars>` | `ptr_8d0bbe200cc3` |
| **Partner Key** | `pk_<45 random chars>` | `pk_a1B2c3D4e5F6...` (48 chars total) |

> **CRITICAL**: The Partner Key is **displayed only once** — at the moment of creation. Copy it immediately and store it securely. It cannot be retrieved later. If lost, you must delete the partner and create a new one.

### 13.4 Managing Partner Access

To change which entities a partner can access:

1. Navigate to **Partners**.
2. Find the partner in the list.
3. Click **Edit**.
4. Modify the **Allowed Masters** list.
5. Click **Save**.

Changes take effect immediately. If a partner loses access to an entity, their next API call to that entity will return a 403 Forbidden error.

### 13.5 Suspending / Reactivating a Partner

To temporarily disable a partner without deleting them:

1. Navigate to **Partners**.
2. Click **Edit** on the partner.
3. Change **Status** to `suspended`.
4. Click **Save**.

Suspended partners cannot make any API calls — all requests return 401 Unauthorized.

To reactivate: change status back to `active`.

### 13.6 Deleting a Partner

1. Navigate to **Partners**.
2. Click **Delete** on the partner row.
3. Confirm the deletion.

This is a **soft delete** — the partner record is flagged as deleted. Their credentials are permanently invalidated.

---

## 14. Public API (GraphQL via API Mesh)

### 14.1 Endpoint & Authentication

**GraphQL Endpoint**:
```
POST https://edge-sandbox-graph.adobe.io/api/<mesh-id>/graphql
```

**Authentication for Read Operations**: No authentication required for public entities.

**Authentication for Write Operations**: Send partner credentials as HTTP headers:

| Header | Value |
|--------|-------|
| `x-partner-id` | Partner ID (e.g., `ptr_8d0bbe200cc3`) |
| `x-partner-key` | Partner Key (e.g., `pk_a1B2c3...`) |
| `Content-Type` | `application/json` |

### 14.2 Making an Entity Public

For an entity to be accessible via the public API:

1. Navigate to the entity → **Overview** tab.
2. Change **Visibility** to `public`.
3. Save.

Once public, anyone can query the entity's data via the GraphQL API without authentication.

### 14.3 Enabling CRUD for External Consumers

For external partners to create, update, or delete records:

1. Set the entity **Visibility** to `public`.
2. Enable **CRUD** on the entity.
3. Create a **Partner** with the entity in their `allowedMasters` list.
4. Share the Partner ID and Key with the integration team.

All three conditions must be met, or write operations will be rejected.

### 14.4 Read Operations (No Auth)

**Query Records (list with filters)**:
```graphql
{
  mdmQuery(
    master: "productcatalog"
    page: 1
    pageSize: 10
    sort: "name"
    order: "asc"
    fields: "master_id,sku,name,price"
    filters: "category=Apparel"
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

**Get Single Record**:
```graphql
{
  mdmRecord(master: "productcatalog", id: "P001") {
    master
    data
  }
}
```

**Bulk Fetch (multiple IDs)**:
```graphql
{
  mdmBulkFetch(master: "productcatalog", ids: "P001,P002,P003") {
    master
    count
    requested
    data
    notFound
  }
}
```

### 14.5 Write Operations (Partner Auth)

**Create Record**:
```graphql
mutation {
  mdmCreate(
    master: "productcatalog"
    input: {
      data: "{\"master_id\":\"NEW-001\",\"sku\":\"SKU-NEW\",\"name\":\"New Product\",\"price\":\"99.99\"}"
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

**Update Record (full replace)**:
```graphql
mutation {
  mdmUpdate(
    master: "productcatalog"
    id: "NEW-001"
    input: {
      data: "{\"master_id\":\"NEW-001\",\"sku\":\"SKU-NEW\",\"name\":\"Updated Name\",\"price\":\"149.99\"}"
    }
  ) {
    success
    record
    error
  }
}
```

**Patch Record (partial update)**:
```graphql
mutation {
  mdmPatch(
    master: "productcatalog"
    id: "NEW-001"
    input: {
      data: "{\"price\":\"199.99\"}"
    }
  ) {
    success
    record
    error
  }
}
```

**Delete Record**:
```graphql
mutation {
  mdmDelete(master: "productcatalog", id: "NEW-001") {
    success
    id
    error
  }
}
```

> **Note**: The `data` field in mutations is always a **JSON-encoded string**, not a raw JSON object. This is required by the API Mesh schema.

### 14.6 Bulk Operations

All bulk mutations accept a `data` field containing a **JSON-encoded string of an array**.

**Bulk Create**:
```graphql
mutation {
  mdmBulkCreate(
    master: "productcatalog"
    input: {
      data: "[{\"master_id\":\"BLK-001\",\"sku\":\"S1\",\"name\":\"P1\"},{\"master_id\":\"BLK-002\",\"sku\":\"S2\",\"name\":\"P2\"}]"
    }
  ) {
    total
    succeeded
    failed
    results { success id error }
  }
}
```

**Bulk Update** (full replace per item):
```graphql
mutation {
  mdmBulkUpdate(
    master: "productcatalog"
    input: {
      data: "[{\"id\":\"BLK-001\",\"data\":{\"master_id\":\"BLK-001\",\"name\":\"Updated\"}}]"
    }
  ) { total succeeded failed results { success id error } }
}
```

**Bulk Patch** (partial update per item):
```graphql
mutation {
  mdmBulkPatch(
    master: "productcatalog"
    input: {
      data: "[{\"id\":\"BLK-001\",\"data\":{\"price\":\"555\"}}]"
    }
  ) { total succeeded failed results { success id error } }
}
```

**Bulk Delete**:
```graphql
mutation {
  mdmBulkDelete(
    master: "productcatalog"
    input: {
      data: "[\"BLK-001\",\"BLK-002\"]"
    }
  ) { total succeeded failed results { success id error } }
}
```

**Important**: Bulk operations process each item independently. If some items fail, the successful ones are NOT rolled back. The response includes per-item results.

### 14.7 Facets via API

```graphql
{
  mdmFacets(
    master: "productcatalog"
    values: "true"
    filters: "category=Apparel"
  ) {
    master
    facetsEnabled
    facetableFields
    totalRecords
    facets {
      field
      label
      type
      values { value count }
    }
  }
}
```

Pass `values: "true"` to get live aggregated counts. Without it, only the facet configuration is returned.

### 14.8 API Caching Behavior

| Operation Type | Cache Policy |
|---------------|-------------|
| Read queries (GET) | CDN cached: browser 60s, edge 120s |
| Mutations (POST/PUT/PATCH/DELETE) | Never cached (`no-store`) |

After a mutation, read queries may return stale data for up to **2 minutes** due to CDN caching. If fresh data is critical, advise consumers to add cache-busting parameters or use direct action URLs.

### 14.9 Rate Limiting

The public API enforces rate limiting per client IP address:

- **Window**: 60 seconds (sliding window)
- **Default Limit**: Configurable in Settings → API → Rate Limit Per Minute
- **Response when exceeded**: HTTP 429 with message "Rate limit exceeded. Try again later."
- **Header**: No `X-RateLimit-*` headers currently returned

### 14.10 Error Handling

| HTTP Code | Meaning | Example |
|-----------|---------|---------|
| 200 | Success | Successful query or mutation |
| 201 | Created | Single record created |
| 400 | Bad Request | Missing parameters, invalid JSON |
| 401 | Unauthorized | Invalid or missing partner credentials |
| 403 | Forbidden | Private master, CRUD disabled, partner not authorized |
| 404 | Not Found | Master or record doesn't exist |
| 405 | Method Not Allowed | Unsupported HTTP method |
| 409 | Conflict | Duplicate primary key on create |
| 422 | Validation Failed | CSV or record validation errors |
| 429 | Rate Limited | Too many requests per minute |
| 507 | Storage Full | Platform storage limit reached |

All error responses have this format:
```json
{
  "error": "Human-readable error message"
}
```

---

## 15. Settings

Navigate to **Settings** in the sidebar to configure global platform behavior.

### 15.1 General Settings

| Setting | Default | Description |
|---------|---------|-------------|
| App Name | AEM MDM Console | Display name in the UI |
| Environment | production | Current environment label |
| Default Visibility | private | Default visibility for new entities |
| Default CRUD Enabled | true | Whether CRUD is enabled by default for new entities |
| Timezone | From env | Timezone for all timestamps |

### 15.2 Data Management Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Max Records Per File | 50,000 | Maximum records allowed in a single CSV import |
| Max File Size MB | 10 | Maximum upload file size |
| Allowed File Types | csv | Accepted file formats |
| Primary Key Required | true | Whether every entity must have a primary key |
| Auto Generate Schema | true | Auto-detect schema from CSV headers |
| Default Field Type | string | Default type for auto-detected fields |
| Max Schema Fields | 200 | Maximum fields per entity schema |

### 15.3 API Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Default Page Size | From env | Records per page in API responses |
| Max Page Size | From env | Maximum allowed page size |
| Rate Limit Per Minute | From env | Max API requests per minute per client |
| Enable CORS | true | Allow cross-origin requests |
| CORS Origins | * | Allowed origins |
| API Mesh Cache TTL | From env | CDN cache duration in seconds |
| Enable Field Selection | true | Allow `fields` parameter in queries |
| Enable Sorting | true | Allow `sort`/`order` parameters |
| Enable Filtering | true | Allow `filters` parameter |

### 15.4 Versioning Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enabled | true | Whether versioning is active |
| Retention Policy | last-10-versions | How many versions to keep |
| Max Versions Per Entity | From env | Auto-prune when exceeded |
| Auto Version On Upload | true | Create version on every import |
| Enable Rollback | true | Allow version rollback |

### 15.5 Audit Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enabled | true | Whether audit logging is active |
| Retention Days | From env (default: 90) | How long to keep audit entries |
| Cleanup Schedule | 0 2 * * * | Cron expression for cleanup job |
| Log Read Operations | false | Log read operations (increases volume significantly) |
| Log Level | operations | Detail level: `operations` or `verbose` |
| Alert On Failure | false | Generate alerts for failed operations |
| Alert Threshold | 10 | Number of failures before alerting |

### 15.6 Archival Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enabled | true | Whether archival system is active globally |
| Default Threshold | 50,000 | Default archive trigger threshold |
| Default Retention Days | 90 | Default archive file retention |
| Default Keep Latest | 10,000 | Default records to keep after archival |
| Archive Format | csv | Default file format (csv or json) |
| Notify Email | (empty) | Default notification email |
| Schedule Time | 0 3 * * * | Cron expression for archive job |
| Max Archive Size MB | 50 | Maximum archive file size |
| Auto Cleanup Expired | true | Automatically clean up expired archives |

### 15.7 Security Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Require IMS Auth | true | Require Adobe IMS authentication for admin actions |
| Allow S2S Auth | true | Allow service-to-service authentication |
| Token Validation | strict | Token validation mode |
| Default Role | admin | Default role for users without explicit assignment |
| Enable IP Whitelist | false | Restrict access to specific IPs |
| IP Whitelist | [] | Allowed IP addresses |
| Session Timeout | 3600 | Session timeout in seconds |

### 15.8 UI Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Theme | auto | UI theme: `auto`, `light`, `dark` |
| Default Page Size | From env | Records per page in the admin UI |
| Show System Entities | false | Show internal system collections in the entity list |
| Enable Export | true | Allow data export from the UI |
| Enable Bulk Operations | true | Allow bulk select/delete in the UI |
| Date Format | YYYY-MM-DD HH:mm:ss | Date display format |
| Max Inline Edit Fields | 20 | Max fields in the inline record editor |

### 15.9 Performance Settings

| Setting | Default | Description |
|---------|---------|-------------|
| DB Region | apac | Database region |
| Connection Pool Size | 10 | DB connection pool size |
| Query Timeout | From env | Query timeout in milliseconds |
| Enable Indexing | true | Create DB indexes for queryable fields |
| Bulk Batch Size | From env | Number of records per batch in bulk operations |

### 15.10 Notification Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enabled | false | Enable notification system |
| Channels | [ui] | Notification channels: `ui`, `email`, `webhook` |
| Notify On Upload | true | Send notification on data import |
| Notify On Delete | true | Send notification on entity/record deletion |
| Notify On Schema Change | true | Send notification on schema changes |
| Notify On Error | true | Send notification on operation errors |
| Webhook URL | (empty) | External webhook URL for notifications |
| Webhook Secret | (empty) | Secret for webhook signature verification |
| Enable Event Publishing | false | Publish mutation events for async processing |

---

## 16. Role-Based Access Control (RBAC)

### 16.1 Roles & Permissions

DataHub supports four roles with increasing levels of access:

| Role | Permissions |
|------|------------|
| **admin** | All operations (wildcard `*` permission) |
| **editor** | read, create, update, patch, delete, bulk-update, delta-update, full-update, upload, export |
| **viewer** | read, export |
| **api-consumer** | read |

The default role (for users without explicit assignment) is configurable in Settings → Security → Default Role.

### 16.2 Per-Entity Role Overrides

A user can have different roles for different entities. For example:

```
User: john@company.com
Global Role: viewer
Entity Overrides:
  products: editor      ← Can edit products
  customers: admin      ← Full access to customers
  (all others): viewer  ← Read-only for everything else
```

This is configured via the `roles` collection with `entityRoles` overrides.

---

## 17. Scheduled Jobs (Automated Maintenance)

Two scheduled jobs run automatically after deployment:

| Job | Schedule | Action | Description |
|-----|----------|--------|-------------|
| **Audit Cleanup** | Daily at 2:00 AM UTC | `audit-cleanup` | Deletes audit log entries older than the configured retention period |
| **Archive Run** | Daily at 3:00 AM UTC | `archive-run` | Archives records from entities over threshold + cleans up expired archive files |

These jobs are implemented as **OpenWhisk alarm triggers** and are deployed automatically by the `post-app-deploy` hook every time you run `aio app deploy`.

**Monitoring**: Check audit log entries with `actor: system:scheduler` to verify scheduled jobs are running.

**Manual Trigger**: Both jobs can be triggered manually from the admin UI (Archive Manager for archive-run, or via direct action invocation for audit-cleanup).

---

## 18. Troubleshooting

### 18.1 Common Issues

| Symptom | Likely Cause | Solution |
|---------|-------------|----------|
| "401 Unauthorized" in the UI | IMS token expired | Refresh the page or re-authenticate via Experience Cloud |
| Query returns 0 records | Filters too restrictive, or data not imported yet | Verify entity has records in the dashboard; check filter syntax |
| CSV import fails with validation errors | CSV formatting issues | Check for duplicate headers, reserved column names, or type mismatches. See error details for row numbers. |
| Entity name rejected | Invalid format | Master names must be lowercase, start with a letter, contain only letters/numbers/underscores. No hyphens. |
| API returns "CRUD operations disabled" | Entity not configured for external writes | Enable CRUD on the entity: Entity Detail → toggle "CRUD Enabled" |
| API returns "Partner not authorized" | Partner doesn't have this entity in allowedMasters | Edit the partner and add the entity to their allowed list |
| Partner key "Invalid partner key" | Wrong key or key was for a different partner | Verify the partner ID and key match. If key is lost, create a new partner. |
| Dashboard shows stale data | Cached metrics | Click the Refresh button or wait for cache TTL to expire (15 min default) |
| Archival didn't run | Entity archival not enabled, or threshold not exceeded | Check entity's archival config: enabled=true, record count > threshold |
| "Storage guardrail" error | Platform storage limit reached | Archive or delete old data. Check Settings → Guardrails → Max Storage MB. |
| Schema changes not reflected in API | API Mesh CDN cache | Wait up to 2 minutes for CDN cache to expire, or redeploy the Mesh |
| "Max schema fields" error | Too many fields | Remove unused fields, or increase the limit in Settings → Data Management |

### 18.2 Checking Action Logs

For deeper debugging, check the Adobe I/O Runtime action logs:

```bash
# List recent action activations
aio runtime activation list --limit 20

# View logs for a specific activation
aio runtime activation logs <activation-id>

# Invoke an action directly for testing
aio runtime action invoke datahub/dashboard --result

# Check deployed actions
aio runtime action list

# Check trigger status
aio runtime trigger list

# Check rule status
aio runtime rule list
```

---

## Appendix A: CSV Format Requirements

### Valid CSV Example

```csv
product_id,name,category,price,in_stock,description
P001,Classic T-Shirt,Apparel,29.99,true,"Comfortable cotton t-shirt"
P002,Running Shoes,Footwear,129.99,true,"Lightweight running shoes, great for trails"
P003,Leather Belt,Accessories,45.00,false,"Genuine leather, 32"" waist"
```

### Rules

| Rule | Requirement |
|------|------------|
| Delimiter | Comma (`,`) |
| Encoding | UTF-8 |
| Header Row | Required (first row) |
| Minimum Rows | 2 (header + 1 data row) |
| Quoting | Fields with commas, quotes, or newlines must be double-quoted |
| Escaped Quotes | Use `""` inside quoted fields (e.g., `"32"" waist"`) |
| Empty Fields | Allowed (treated as empty string) |
| Trailing Commas | Not recommended |

### Reserved Column Names (Cannot Be Used)

```
_id, _entity, _version, _createdAt, _updatedAt,
_createdBy, _updatedBy, _deleted, _status, _public
```

### Special Column: `_action` (Delta Update Only)

When using **mixed-action delta update**, add a `_action` column with values:
`CREATE`, `UPDATE`, `PATCH`, or `DELETE`.

---

## Appendix B: Quick Reference Card

### Entity Lifecycle

```
Create (CSV Import) → Active → Update (Full/Delta/Record CRUD) → Archive → Delete
                         ↑                                          |
                         └────── Rollback (Version) ────────────────┘
```

### Data Access Paths

| Consumer | Path | Auth |
|----------|------|------|
| Admin User | React UI → Runtime Actions | Adobe IMS token |
| External Read | GraphQL → API Mesh → mdm-data | None (public) or IMS (private) |
| External Write | GraphQL → API Mesh → mdm-data | Partner ID + Key |
| Scheduled Job | Alarm Trigger → Runtime Action | System (no user auth) |

### API Operations Summary

| # | Operation | GraphQL Field | Type | Auth |
|---|-----------|--------------|------|------|
| 1 | List records | `mdmQuery` | Query | None |
| 2 | Get record | `mdmRecord` | Query | None |
| 3 | Bulk fetch | `mdmBulkFetch` | Query | None |
| 4 | Get facets | `mdmFacets` | Query | None |
| 5 | Create | `mdmCreate` | Mutation | Partner |
| 6 | Update (full) | `mdmUpdate` | Mutation | Partner |
| 7 | Patch (partial) | `mdmPatch` | Mutation | Partner |
| 8 | Delete | `mdmDelete` | Mutation | Partner |
| 9 | Bulk create | `mdmBulkCreate` | Mutation | Partner |
| 10 | Bulk update | `mdmBulkUpdate` | Mutation | Partner |
| 11 | Bulk patch | `mdmBulkPatch` | Mutation | Partner |
| 12 | Bulk delete | `mdmBulkDelete` | Mutation | Partner |

### Key Limits (Defaults)

| Limit | Default Value |
|-------|--------------|
| Max file size | 10 MB |
| Max records per import | 50,000 |
| Max schema fields | 200 |
| Audit retention | 90 days |
| Archive retention | 90 days |
| Version retention | Configurable per env |
| API rate limit | Configurable per env |
| CDN cache (read) | 60s browser, 120s edge |
| Archive threshold | 50,000 records |

### Keyboard Shortcuts & Tips

- **Dashboard Refresh**: Click the refresh icon for real-time data (bypasses cache)
- **Entity Search**: Start typing in the entity list to filter in real-time
- **Query Console**: Press Enter or click Execute to run the query
- **Bulk Select**: Use checkboxes in entity/record list for batch operations

---

*DataHub Admin Manual v1.0 — Last updated: May 2026*
