import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initializePlatform } from './platform';
import './style.css';

const root = createRoot(document.getElementById('root')!);
void initializePlatform().then(() => root.render(<App />)).catch(() => {
  root.render(<p role="alert">Unable to initialize desktop storage. Restart UmaLytics to retry.</p>);
});
