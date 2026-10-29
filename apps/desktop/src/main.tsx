import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initializePlatform } from './platform';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/barlow-semi-condensed/500.css';
import '@fontsource/barlow-semi-condensed/600.css';
import '@fontsource/barlow-semi-condensed/700.css';
import './style.css';

const root = createRoot(document.getElementById('root')!);
void initializePlatform().then(() => root.render(<App />)).catch(() => {
  root.render(<p role="alert">Unable to initialize desktop storage. Restart UmaLytics to retry.</p>);
});
