import { installPageHook } from '../utils/pageHookRuntime';

// Install before the site's own scripts can construct their realtime socket.
export default defineContentScript({
  matches: ['https://drafter.uma.guide/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main: installPageHook
});
