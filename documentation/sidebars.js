/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  featuresSidebar: [
    {
      type: 'doc',
      id: 'intro',
      label: 'Getting Started',
    },
    {
      type: 'category',
      label: 'Core',
      collapsed: false,
      items: [
        'core/core-utils',
        'core/mdm-utils',
      ],
      description: 'Foundation modules shared by all actions',
    },
    {
      type: 'category',
      label: 'Data Management',
      collapsed: false,
      items: [
        'data-management/record-crud',
        'data-management/query-data',
        'data-management/bulk-update',
        'data-management/schema-update',
        'data-management/file-upload',
        'data-management/full-update',
        'data-management/delta-update',
        'data-management/visibility-update',
        'data-management/metadata-update',
        'data-management/file-operations',
      ],
      description: 'Actions for managing master data records, schemas, and files',
    },
    {
      type: 'category',
      label: 'Public API',
      collapsed: false,
      items: [
        'public-api/mdm-data',
        'public-api/mdm-facets',
      ],
      description: 'External-facing APIs for data consumers',
    },
    {
      type: 'category',
      label: 'Infrastructure',
      collapsed: false,
      items: [
        'infrastructure/dashboard',
        'infrastructure/archive-config',
        'infrastructure/archive-run',
        'infrastructure/archive-list',
        'infrastructure/infra-metrics',
        'infrastructure/publish-events',
      ],
      description: 'Platform infrastructure, monitoring, and event processing',
    },
    {
      type: 'category',
      label: 'Administration',
      collapsed: false,
      items: [
        'administration/user-management',
        'administration/partner-management',
        'administration/audit-list',
        'administration/audit-cleanup',
        'administration/app-settings',
      ],
      description: 'Admin tools for users, partners, auditing, and configuration',
    },
  ],
};

module.exports = sidebars;
