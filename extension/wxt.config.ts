import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'ScrollGate',
    description: 'A local focus gate for sites you choose to restrict.',
    permissions: [
      'alarms',
      'declarativeNetRequest',
      'declarativeNetRequestWithHostAccess',
      'storage',
      'tabs',
      'webNavigation',
    ],
    // Site access is requested from the popup, in response to an explicit user
    // action. The extension never reads page content; it only applies DNR rules
    // to the configured domains' top-level navigations.
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    minimum_chrome_version: '111',
    web_accessible_resources: [
      {
        resources: ['/gate.html'],
        matches: ['http://*/*', 'https://*/*'],
      },
    ],
  },
});
