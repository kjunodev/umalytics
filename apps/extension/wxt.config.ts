import { defineConfig } from 'wxt';

// Community source cannot enable history-derived profiles through an environment flag.
if (process.env.UMALYTICS_PRIVATE_PROFILE_DATA === 'true') throw new Error('This repository supports public builds only.');
const privateProfileDataBuild = false;

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    browser_specific_settings: {
      gecko: { id: privateProfileDataBuild ? 'umalytics-private@kjunodev' : 'umalytics@kjunodev' }
    },
    name: privateProfileDataBuild ? 'UmaLytics Private' : 'UmaLytics',
    version: '0.3.9',
    version_name: privateProfileDataBuild ? '0.3.9-private.rc.1' : '0.3.9-public.open-beta.1',
    description: privateProfileDataBuild
      ? 'Private prematch scouting companion for Uma Drafter.'
      : 'Prematch scouting companion for Uma Drafter.',
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
  vite: () => ({
    define: {
      __UMALYTICS_PRIVATE_PROFILE_DATA__: JSON.stringify(privateProfileDataBuild)
    }
  }),
  modules: ['@wxt-dev/module-react']
});
