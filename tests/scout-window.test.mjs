import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadModule } from './support/harness.mjs';

function harness({ storedBounds, workArea, existingWindowId } = {}) {
  const storage = {};
  if (storedBounds !== undefined) storage.scoutWindowBounds = storedBounds;
  const calls = { create: [], update: [] };

  const browser = {
    runtime: { getURL: (relativePath) => `chrome-extension://umalytics${relativePath}` },
    storage: {
      local: {
        async get(key) {
          return key in storage ? { [key]: storage[key] } : {};
        },
        async set(values) {
          Object.assign(storage, values);
        }
      }
    },
    windows: {
      async create(options) {
        calls.create.push(options);
        return { id: 42 };
      },
      async update(windowId, options) {
        calls.update.push([windowId, options]);
        if (existingWindowId === undefined || windowId !== existingWindowId) {
          throw new Error('No window with id: ' + windowId + '.');
        }
      },
      async getLastFocused() {
        if (workArea === undefined) throw new Error('No last-focused window (e.g. no windows open yet).');
        return { ...workArea };
      }
    }
  };

  const c = vm.createContext({
    browser,
    setTimeout,
    clearTimeout
  });
  loadModule(c, 'scoutWindow');
  c.configureScoutWindow({
    handleLobbyReconnectRequested: async () => ({ activeLobby: false }),
    reportEnrichmentError: () => {}
  });
  return { c, calls, storage };
}

// Objects returned from code run in a vm context are created in that
// context's own realm, so assert.deepEqual (deepStrictEqual under
// node:assert/strict) reports them as unequal to an outer-realm object
// literal purely over prototype identity, even with identical own
// properties. Spreading into a fresh outer-realm object avoids that.
function plain(value) {
  return { ...value };
}

test('clampSizeToWorkArea caps width and height to the work area, never expanding them', () => {
  const { c } = harness();
  assert.deepEqual(plain(c.clampSizeToWorkArea({ width: 1500, height: 900 }, { left: 0, top: 0, width: 1920, height: 1080 })), { width: 1500, height: 900 });
  assert.deepEqual(plain(c.clampSizeToWorkArea({ width: 1500, height: 900 }, { left: 0, top: 0, width: 1280, height: 720 })), { width: 1280, height: 720 });
});

test('clampBoundsToWorkArea pulls an off-screen position back on screen without changing an in-bounds one', () => {
  const { c } = harness();
  const workArea = { left: 0, top: 0, width: 1920, height: 1080 };
  assert.deepEqual(
    plain(c.clampBoundsToWorkArea({ left: 100, top: 100, width: 1500, height: 900 }, workArea)),
    { left: 100, top: 100, width: 1500, height: 900 },
    'a bounds fully inside the work area is left untouched'
  );
  assert.deepEqual(
    plain(c.clampBoundsToWorkArea({ left: -400, top: -200, width: 1500, height: 900 }, workArea)),
    { left: 0, top: 0, width: 1500, height: 900 },
    'a negative (off the top-left) position is clamped back into the work area'
  );
  assert.deepEqual(
    plain(c.clampBoundsToWorkArea({ left: 1800, top: 1000, width: 1500, height: 900 }, workArea)),
    { left: 420, top: 180, width: 1500, height: 900 },
    'a position that would hang off the bottom-right is pulled back so the whole window stays visible'
  );
  assert.deepEqual(
    plain(c.clampBoundsToWorkArea({ left: 100, top: 100, width: 3000, height: 2000 }, workArea)),
    { left: 0, top: 0, width: 1920, height: 1080 },
    'a remembered size from a larger monitor is capped to the current work area'
  );
});

test('a first-ever open with no remembered bounds defaults to about 1500x900, capped to the screen', async () => {
  const { c } = harness({ workArea: { left: 0, top: 0, width: 1920, height: 1080 } });
  assert.deepEqual(plain(await c.resolveInitialScoutBounds()), { width: 1500, height: 900 });

  const { c: smallScreen } = harness({ workArea: { left: 0, top: 0, width: 1280, height: 800 } });
  assert.deepEqual(plain(await smallScreen.resolveInitialScoutBounds()), { width: 1280, height: 800 });
});

test('a remembered size and position is restored on the next open, clamped to the current screen', async () => {
  const { c } = harness({
    storedBounds: { left: 200, top: 150, width: 1600, height: 1000 },
    workArea: { left: 0, top: 0, width: 1920, height: 1080 }
  });
  // top is pulled up from 150 to 80: at height 1000 in a 1080-tall screen, a
  // top of 150 would hang the window's bottom edge 70px off screen.
  assert.deepEqual(plain(await c.resolveInitialScoutBounds()), { left: 200, top: 80, width: 1600, height: 1000 });
});

test('remembered bounds from a since-unplugged second monitor are guarded back on screen instead of opening off-screen', async () => {
  const { c } = harness({
    storedBounds: { left: 2400, top: 300, width: 1600, height: 1000 },
    workArea: { left: 0, top: 0, width: 1920, height: 1080 }
  });
  const bounds = await c.resolveInitialScoutBounds();
  assert.equal(bounds.left + bounds.width <= 1920, true, 'clamped window must fit within the current screen width');
  assert.equal(bounds.left >= 0, true);
});

test('focusing an existing scout window only focuses it: it never resizes or repositions a window the user already sized', async () => {
  const { c, calls } = harness({ existingWindowId: 42 });
  // Seed scoutWindowId via a first create, then focus it a second time.
  await c.createOrFocusScoutWindow();
  calls.update.length = 0;
  calls.create.length = 0;

  await c.createOrFocusScoutWindow();

  assert.equal(calls.create.length, 0, 'no new window is created while the existing one is still open');
  assert.equal(calls.update.length, 1);
  assert.deepEqual(plain(calls.update[0][1]), { focused: true }, 'update is called with focus only, no width/height/left/top');
});

test('a new scout window is created with the resolved default bounds when none exists yet', async () => {
  const { c, calls } = harness({ workArea: { left: 0, top: 0, width: 1920, height: 1080 } });
  await c.createOrFocusScoutWindow();
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].width, 1500);
  assert.equal(calls.create[0].height, 900);
  assert.equal(calls.create[0].focused, true);
  assert.equal(calls.create[0].type, 'popup');
});

test('window-removed clears the tracked window id, so the next open creates a fresh window instead of trying to focus a closed one', async () => {
  const { c, calls } = harness({ existingWindowId: 42 });
  await c.createOrFocusScoutWindow();
  c.handleScoutWindowRemoved(42);
  calls.create.length = 0;
  await c.createOrFocusScoutWindow();
  assert.equal(calls.create.length, 1, 'a new window is created since the tracked one was removed');
});

test('bounds-changed events are debounced: rapid updates while dragging only persist once, with the final bounds', async () => {
  const { c, calls, storage } = harness({ existingWindowId: 42 });
  await c.createOrFocusScoutWindow();
  calls.create.length = 0;

  c.handleScoutWindowBoundsChanged({ id: 42, left: 10, top: 10, width: 1500, height: 900 });
  c.handleScoutWindowBoundsChanged({ id: 42, left: 20, top: 20, width: 1510, height: 910 });
  c.handleScoutWindowBoundsChanged({ id: 42, left: 30, top: 30, width: 1520, height: 920 });
  assert.equal(storage.scoutWindowBounds, undefined, 'nothing is persisted until the debounce settles');

  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.deepEqual(plain(storage.scoutWindowBounds), { left: 30, top: 30, width: 1520, height: 920 });
});

test('bounds-changed events for a window that is not the tracked scout window are ignored', async () => {
  const { c, storage } = harness({ existingWindowId: 42 });
  await c.createOrFocusScoutWindow();
  c.handleScoutWindowBoundsChanged({ id: 99, left: 10, top: 10, width: 1500, height: 900 });
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(storage.scoutWindowBounds, undefined);
});

test('default sizing is capped to the last-focused browser window, not chrome.system.display (no permission for it, and Firefox has no equivalent)', async () => {
  const { c } = harness({ workArea: { left: 0, top: 0, width: 1280, height: 800 } });
  assert.deepEqual(plain(await c.resolveInitialScoutBounds()), { width: 1280, height: 800 });
});

test('no last-focused window available (e.g. browser.windows.getLastFocused rejects) falls back to the plain 1500x900 default', async () => {
  const { c } = harness();
  assert.deepEqual(plain(await c.resolveInitialScoutBounds()), { width: 1500, height: 900 });
});
