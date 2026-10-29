import { UiServicesProvider } from '@umalytics/ui';
import { extensionUiServices } from '../../ui/services';
import { initializeUiSize, applyUiSize, initialUiSize } from '../../ui/common/uiSize';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@umalytics/ui/common/base.css';

function mount() {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <UiServicesProvider services={extensionUiServices}>
        <App />
      </UiServicesProvider>
    </React.StrictMode>
  );
}

void initializeUiSize(window.innerHeight, window.innerWidth).catch((error: unknown) => {
  console.error('Unable to load UI size', error);
  applyUiSize(initialUiSize(window.innerHeight, window.innerWidth));
}).then(mount);
