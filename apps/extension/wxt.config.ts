import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    browser_specific_settings: {
      gecko: { id: 'umalytics@kjunodev' }
    },
    name: 'UmaLytics',
    version: '0.5.1',
    version_name: '0.5.1',
    description: 'Prematch scouting companion for Uma Drafter.',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png'
    },
    action: {
      default_title: 'Open UmaLytics Scout',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png'
      }
    },
    permissions: ['storage', 'scripting', 'alarms'],
    host_permissions: ['https://drafter-api.uma.guide/*', 'https://drafter.uma.guide/*'],
    web_accessible_resources: [
      {
        resources: ['pageHook.js'],
        matches: ['https://drafter.uma.guide/*']
      }
    ]
  },
  modules: ['@wxt-dev/module-react']
});
