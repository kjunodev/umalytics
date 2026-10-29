import { browser } from 'wxt/browser';
import { executeExplorerRequest, validateExplorerRequest, explorerError } from '@umalytics/core/explorer/explorerService';
import { EXPLORER_PORT, type ExplorerReply } from '@umalytics/core/explorer/explorerTypes';

export function registerExplorerService(ready: () => Promise<void>): void {
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== EXPLORER_PORT) return;
    // Only our extension page may request lookups; content scripts cannot use this channel.
    if (port.sender?.id !== browser.runtime.id || port.sender?.url?.split(/[?#]/)[0] !== browser.runtime.getURL('/scout.html')) {
      port.disconnect(); return;
    }
    const controller = new AbortController();
    let started = false;
    const send = (reply: ExplorerReply) => {
      if (controller.signal.aborted) return;
      try { port.postMessage(reply); } catch { controller.abort(); }
    };
    port.onDisconnect.addListener(() => controller.abort());
    port.onMessage.addListener((value: unknown) => {
      if (started) return;
      started = true;
      void ready().then(async () => {
        const result = await executeExplorerRequest(validateExplorerRequest(value), controller.signal,
          profiles => send({ type: 'progress', profiles }));
        send({ type: 'result', data: result });
      }).catch(error => send({ type: 'error', ...explorerError(error) }));
    });
  });
}
