import { configureCorePlatform, type KeyValueStorage } from '@umalytics/core';
import { browser } from 'wxt/browser';
import { recordDiagnostic } from './diagnosticRecorder';

function storageAdapter(area: KeyValueStorage): KeyValueStorage {
  return {
    get: key => area.get(key),
    set: values => area.set(values),
    remove: key => area.remove(key)
  };
}

configureCorePlatform({
  storage: {
    local: storageAdapter(browser.storage.local),
    session: browser.storage.session === undefined ? undefined : storageAdapter(browser.storage.session)
  },
  recordDiagnostic
});
