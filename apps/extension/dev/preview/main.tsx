import { initializeUiSize, applyUiSize, initialUiSize } from '../../ui/common/uiSize';
import React from 'react';
import { createRoot } from 'react-dom/client';
import PreviewApp from './PreviewApp';

function mount() {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <PreviewApp />
    </React.StrictMode>
  );
}

void initializeUiSize(window.innerHeight, window.innerWidth).catch((error: unknown) => {
  console.error('Unable to load UI size', error);
  applyUiSize(initialUiSize(window.innerHeight, window.innerWidth));
}).then(mount);
