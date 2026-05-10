// @ts-check

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'DataHub Platform',
  tagline: 'Master Data Management — Technical Documentation',
  favicon: 'img/favicon.ico',

  url: 'https://mayur434.github.io',
  baseUrl: '/pimapp/',

  organizationName: 'mayur434',
  projectName: 'pimapp',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: '/',
          sidebarPath: require.resolve('./sidebars.js'),
          editUrl: 'https://github.com/mayur434/pimapp/tree/main/documentation/',
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/datahub-social-card.png',
      navbar: {
        title: 'DataHub Platform',
        logo: {
          alt: 'DataHub Logo',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'featuresSidebar',
            position: 'left',
            label: 'Features',
          },
          {
            href: 'https://github.com/mayur434/pimapp',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Documentation',
            items: [
              { label: 'Getting Started', to: '/' },
              { label: 'Core Utilities', to: '/core/core-utils' },
              { label: 'Public APIs', to: '/public-api/mdm-data' },
            ],
          },
          {
            title: 'Categories',
            items: [
              { label: 'Data Management', to: '/data-management/record-crud' },
              { label: 'Infrastructure', to: '/infrastructure/dashboard' },
              { label: 'Administration', to: '/administration/user-management' },
            ],
          },
          {
            title: 'More',
            items: [
              { label: 'GitHub', href: 'https://github.com/mayur434/pimapp' },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} DataHub Platform. Built with Docusaurus.`,
      },
      prism: {
        theme: require('prism-react-renderer').themes.github,
        darkTheme: require('prism-react-renderer').themes.dracula,
        additionalLanguages: ['bash', 'json'],
      },
      colorMode: {
        defaultMode: 'light',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },
      tableOfContents: {
        minHeadingLevel: 2,
        maxHeadingLevel: 4,
      },
    }),
};

module.exports = config;
