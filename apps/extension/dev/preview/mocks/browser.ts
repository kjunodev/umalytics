// Stands in for `wxt/browser` inside the preview harness only (aliased in
// dev/preview/vite.config.ts). Every extension call that would normally go
// through chrome.* is answered here from dev/preview/fixtures.ts instead, so
// real ui/ components can render unmodified against fixture data.
import { PREVIEW_LEADERBOARD, PREVIEW_MANIFEST, PREVIEW_SEARCH_RESULT, previewHistoryPage } from '../fixtures';

type Listener = (...args: unknown[]) => void;

function listenerSet() {
  const listeners = new Set<Listener>();
  return {
    addListener: (fn: Listener) => listeners.add(fn),
    removeListener: (fn: Listener) => listeners.delete(fn),
    hasListeners: () => listeners.size > 0,
    listeners
  };
}

// Mirrors the browser.runtime.connect(name) port protocol that
// explorer/explorerClient.ts speaks to the background explorer service,
// answering each request kind from fixture data instead of a live API call.
function createExplorerPort() {
  const onMessage = listenerSet();
  const onDisconnect = listenerSet();

  return {
    postMessage(message: { kind: string }) {
      queueMicrotask(() => {
        try {
          const data = resolveExplorerRequest(message);
          for (const listener of onMessage.listeners) listener({ type: 'result', data });
        } catch (error) {
          const messageText = error instanceof Error ? error.message : 'Preview request failed.';
          for (const listener of onMessage.listeners) listener({ type: 'error', message: messageText });
        }
      });
    },
    disconnect() {},
    onMessage,
    onDisconnect
  };
}

function resolveExplorerRequest(message: { kind: string }): unknown {
  switch (message.kind) {
    case 'leaderboard':
      return PREVIEW_LEADERBOARD;
    case 'search':
      return PREVIEW_SEARCH_RESULT;
    case 'profiles':
      return {};
    default:
      throw new Error(`Preview harness has no fixture for explorer request "${message.kind}".`);
  }
}

function resolveRuntimeMessage(message: { type?: string; page?: number }): unknown {
  switch (message?.type) {
    case 'player-history-page-requested':
      return previewHistoryPage(message.page ?? 1);
    case 'player-profile-requested':
      return { title: null };
    case 'lobby-reconnect-requested':
      return { activeLobby: false };
    default:
      return undefined;
  }
}

const storage = new Map<string, unknown>(Object.entries(JSON.parse(localStorage.getItem('preview-storage') ?? '{}')));
const sizeOverride = new URLSearchParams(location.search).get('uiSize');
if (sizeOverride) storage.set('scoutUiSize', sizeOverride);

export const browser = {
  runtime: {
    getManifest: () => PREVIEW_MANIFEST,
    connect: () => createExplorerPort(),
    sendMessage: async (message: Parameters<typeof resolveRuntimeMessage>[0]) => resolveRuntimeMessage(message),
    onMessage: listenerSet()
  },
  storage: {
    local: {
      async get(keys?: string | string[]) {
        if (keys === undefined) return Object.fromEntries(storage);
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.map((key) => [key, storage.get(key)]).filter(([, value]) => value !== undefined));
      },
      async set(values: Record<string, unknown>) {
        for (const [key, value] of Object.entries(values)) storage.set(key, value);
        localStorage.setItem('preview-storage', JSON.stringify(Object.fromEntries(storage)));
      },
      async remove(keys: string | string[]) {
        for (const key of Array.isArray(keys) ? keys : [keys]) storage.delete(key);
      }
    },
    onChanged: listenerSet()
  },
  tabs: {
    async sendMessage() {
      return undefined;
    }
  },
  windows: {
    onRemoved: listenerSet(),
    onBoundsChanged: listenerSet()
  }
};
