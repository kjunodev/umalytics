import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initializePlatform } from './platform';
import { UiServicesProvider } from '@umalytics/ui';
import { desktopUiServices } from './services';
import './style.css';
import './arena.css';

const root = createRoot(document.getElementById('root')!);
void initializePlatform().then(() => root.render(<UiServicesProvider services={desktopUiServices}><App /></UiServicesProvider>)).catch(() => {
  root.render(<p role="alert">Unable to initialize desktop storage. Restart UmaLytics to retry.</p>);
});
