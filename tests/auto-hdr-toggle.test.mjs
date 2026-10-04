import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the real Content callback and launch path, without loading Steam's UI.
// Only expose entrypoints in the in-memory test build; production exports stay intact.
const source = readFileSync(new URL("../src/index.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(`${source}
  export const toggleTest = {
    Content, refreshRuntimeHdrSettings, applyCachedHdrForLaunch,
    handleAppLifetimeNotification, stopSteamLaunchRuntime, pcgwLaunchCache,
    beginHdrCacheClear: typeof beginHdrCacheClear === "function"
      ? beginHdrCacheClear
      : () => pcgwLaunchCache.clear(),
    miniBadgeToast: {
      reset({ gamepadUiActive, networkActive, total, targetIds, queue, queueRunning }) {
        hdrMiniBadgeGamepadUiActive = gamepadUiActive;
        hdrMiniBadgeNotifyNetworkActive = networkActive;
        hdrMiniBadgeNotifyTotal = total;
        hdrMiniBadgeNotifyStartShown = false;
        hdrMiniBadgeTargetIds.clear();
        for (const appid of targetIds) hdrMiniBadgeTargetIds.add(appid);
        hdrMiniBadgeQueue.length = 0;
        hdrMiniBadgeQueue.push(...queue);
        hdrMiniBadgeQueueRunning = queueRunning;
        hdrMiniBadgeQueuedIds.clear();
        hdrMiniBadgeCompletedIds.clear();
      },
      setWorkerState(queue, queueRunning) {
        hdrMiniBadgeQueue.length = 0;
        hdrMiniBadgeQueue.push(...queue);
        hdrMiniBadgeQueueRunning = queueRunning;
      },
      setNetworkActive(active) {
        hdrMiniBadgeNotifyNetworkActive = active;
      },
      show: showHdrMiniBadgeLoadingToast,
      update: updateHdrMiniBadgeProgress,
      queueApp: queueHdrMiniBadgeApp,
      startUiModeTracking: startHdrMiniBadgeUiModeTracking,
    },
  };
`, {
  fileName: "index.tsx",
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

const flush = () => new Promise(setImmediate);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function findToggle(node, title) {
  if (!node || typeof node !== "object") return undefined;
  if (node.props?.title === title) return node.props;
  const children = [node.props?.children].flat();
  return children.map((child) => findToggle(child, title)).find(Boolean);
}

function createHarness(initialEnabled, initialRuntimeRead, options = {}) {
  let persisted = {
    auto_hdr_enabled: initialEnabled,
    restore_previous_hdr_state: true,
    mini_badges_enabled: true,
    mini_badges_library_enabled: false,
    mini_badges_home_enabled: true,
    override_appids: options.overrideAppIds ?? [],
  };
  const initialSettings = { ...persisted };
  const saves = [];
  const hdrWrites = [];
  const toasts = [];
  const toastMessages = [];
  const cacheOnlyCalls = [];
  const networkCalls = [];
  let uiModeHandler;
  let uiModeUnregisters = 0;
  let reads = 0;
  let slots = [];
  let cursor = 0;
  let effects = [];
  let cleanups = [];

  const react = {
    useState(initial) {
      const slot = cursor++;
      const mountedSlots = slots;
      if (!(slot in mountedSlots)) {
        mountedSlots[slot] = typeof initial === "function" ? initial() : initial;
      }
      return [mountedSlots[slot], (value) => {
        mountedSlots[slot] = typeof value === "function" ? value(mountedSlots[slot]) : value;
      }];
    },
    useEffect(effect, deps) {
      const slot = cursor++;
      assert.deepEqual(Array.from(deps), [], "Content currently has a mount-only effect");
      if (!(slot in slots)) {
        slots[slot] = true;
        effects.push(effect);
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-dom": {},
    "react-icons/fa": {},
    "@decky/ui": {
      DialogButton: { render: () => ({ type: "button" }) },
      staticClasses: { Title: "title" },
    },
    "@decky/api": {
      definePlugin: (factory) => factory,
      routerHook: {
        addPatch: () => ({}),
        removePatch() {},
      },
      toaster: {
        toast: (message) => {
          toastMessages.push(message);
          toasts.push(message.body);
          return { data: message, dismiss() {} };
        },
      },
      callable: (name) => (...args) => {
        if (name === "get_cached_hdr_info") {
          const [appid] = args;
          cacheOnlyCalls.push(appid);
          if (options.cacheOnlyError) {
            return Promise.reject(options.cacheOnlyError);
          }
          if (options.cacheOnlyDeferred) {
            return options.cacheOnlyDeferred.promise;
          }
          return Promise.resolve(options.persistentCache?.[appid] ?? null);
        }
        if (name === "get_hdr_info") {
          networkCalls.push(args[0]);
          if (options.networkResult) {
            return Promise.resolve(options.networkResult);
          }
          return Promise.reject(new Error("network lookup forbidden on launch path"));
        }
        if (name === "get_settings") {
          reads += 1;
          return reads === 1 && initialRuntimeRead
            ? initialRuntimeRead.promise
            : Promise.resolve({ ...persisted });
        }
        if (name === "set_auto_hdr_enabled") {
          const pending = deferred();
          const [enabled] = args;
          saves.push({
            enabled,
            resolve() {
              persisted = { ...persisted, auto_hdr_enabled: enabled };
              pending.resolve({ ...persisted });
            },
            reject() { pending.reject(new Error("settings write failed")); },
          });
          return pending.promise;
        }
        const otherSetting = {
          set_restore_previous_hdr_state: "restore_previous_hdr_state",
          set_mini_badges_enabled: "mini_badges_enabled",
          set_mini_badges_library_enabled: "mini_badges_library_enabled",
          set_mini_badges_home_enabled: "mini_badges_home_enabled",
        }[name];
        if (otherSetting) {
          persisted = { ...persisted, [otherSetting]: args[0] };
          return Promise.resolve({ ...persisted });
        }
        assert.fail(`Unexpected RPC: ${name}`);
      },
    },
  };
  const steamClient = {
    UI: {
      GetUIMode: () => Promise.resolve(options.uiMode ?? 4),
      RegisterForUIModeChanged: (handler) => {
        uiModeHandler = handler;
        return {
          unregister() {
            uiModeUnregisters += 1;
            uiModeHandler = undefined;
          },
        };
      },
    },
  };
  class MutationObserver {
    observe() {}
    disconnect() {}
  }
  const context = {
    exports: {},
    require(name) {
      assert.ok(name in imports, `Unexpected import: ${name}`);
      return imports[name];
    },
    console: { log() {}, warn() {}, error() {} },
    document: { body: {}, querySelectorAll: () => [] },
    MutationObserver,
    SteamClient: steamClient,
    window: {
      SteamClient: steamClient,
      location: { pathname: "/routes/library/home" },
      setInterval: () => 1,
      clearInterval() {},
      setTimeout: (callback) => {
        callback();
        return 1;
      },
      settingsStore: { clientSettings: { gamescope_hdr_enabled: false } },
      webpackChunksteamui: {
        push([, , initialize]) {
          initialize(() => ({
            qt(setting, enabled) { hdrWrites.push([setting, enabled]); },
          }));
        },
      },
    },
  };
  vm.runInNewContext(compiled, context, { filename: "index.test.cjs" });
  const runtime = context.exports.toggleTest;
  runtime.pcgwLaunchCache.set("123", {
    appid: "123", hdr: "true", automatic_action: "enable", cached: true,
  });

  function render() {
    cursor = 0;
    return runtime.Content();
  }

  return {
    saves, toasts, toastMessages, initialSettings, cacheOnlyCalls, networkCalls, hdrWrites,
    get persisted() { return persisted; },
    initialize: () => runtime.refreshRuntimeHdrSettings(),
    async mount() {
      render();
      for (const effect of effects.splice(0)) cleanups.push(effect());
      await flush();
      assert.equal(findToggle(render(), "Automatic HDR switching").disabled, false);
    },
    unmount() {
      for (const cleanup of cleanups) cleanup?.();
      cleanups = [];
      slots = [];
    },
    change: (enabled) => findToggle(render(), "Automatic HDR switching").onChange(enabled),
    changeOther: (title, enabled) => findToggle(render(), title).onChange(enabled),
    otherValue: (title) => findToggle(render(), title).value,
    value: () => findToggle(render(), "Automatic HDR switching").value,
    clearLaunchCache: () => runtime.pcgwLaunchCache.clear(),
    setLaunchCache: (appid, info) => runtime.pcgwLaunchCache.set(appid, info),
    beginCacheClear: () => runtime.beginHdrCacheClear(),
    stopLaunchRuntime: () => runtime.stopSteamLaunchRuntime(),
    miniBadgeToast: runtime.miniBadgeToast,
    changeUiMode: (mode) => uiModeHandler?.(mode),
    uiModeUnregisters: () => uiModeUnregisters,
    loadPlugin: () => context.exports.default(),
    cachedLaunchInfo: (appid) => runtime.pcgwLaunchCache.get(appid),
    exitApp: async (appid) => {
      runtime.handleAppLifetimeNotification({ unAppID: Number(appid), bRunning: false });
      await flush();
    },
    async assertLaunch(enabled, appid = "123") {
      hdrWrites.length = 0;
      await runtime.applyCachedHdrForLaunch(appid);
      assert.deepEqual(hdrWrites, enabled ? [["gamescope_hdr_enabled", true]] : []);
    },
    async assertLaunchWrite(expected, appid = "123") {
      hdrWrites.length = 0;
      await runtime.applyCachedHdrForLaunch(appid);
      assert.deepEqual(
        hdrWrites,
        expected === null ? [] : [["gamescope_hdr_enabled", expected]]
      );
    },
    clearHdrWrites: () => { hdrWrites.length = 0; },
    runLaunch: (appid = "123") => runtime.applyCachedHdrForLaunch(appid),
  };
}

async function ready(enabled) {
  const harness = createHarness(enabled);
  await harness.initialize();
  await harness.mount();
  return harness;
}

for (const initial of [false, true]) {
  test(`initial setting ${initial} governs launch without a toggle`, async () => {
    const h = await ready(initial);
    assert.equal(h.value(), initial);
    await h.assertLaunch(initial);
  });

  test(`toggle ${initial} -> ${!initial} affects launch before the save completes`, async () => {
    const h = await ready(initial);
    const change = h.change(!initial);
    assert.equal(h.value(), !initial);
    await h.assertLaunch(!initial);
    await flush();
    assert.equal(h.saves[0].enabled, !initial);
    h.saves[0].resolve();
    await change;
    h.unmount();
    await h.assertLaunch(!initial);
    await h.mount();
    assert.equal(h.value(), !initial);
    assert.deepEqual(h.persisted, { ...h.initialSettings, auto_hdr_enabled: !initial });
    assert.deepEqual(h.toasts, [
      !initial ? "Automatic HDR switching enabled" : "Automatic HDR switching disabled",
    ]);
  });

  test(`failed toggle from ${initial} restores UI and launch behavior`, async () => {
    const h = await ready(initial);
    const change = h.change(!initial);
    await h.assertLaunch(!initial);
    await flush();
    h.saves[0].reject();
    await change;
    assert.equal(h.value(), initial);
    await h.assertLaunch(initial);
    assert.deepEqual(h.persisted, h.initialSettings);
    assert.deepEqual(h.toasts, ["Could not save setting"]);
  });
}

test("rapid on/off keeps the latest choice while the older save completes", async () => {
  const h = await ready(false);
  const first = h.change(true);
  const last = h.change(false);
  await h.assertLaunch(false);
  await flush();
  h.saves[0].resolve();
  await first;
  await flush();
  assert.equal(h.value(), false);
  await h.assertLaunch(false);
  assert.deepEqual(h.saves.map((save) => save.enabled), [true, false]);
  h.saves[1].resolve();
  await last;
  assert.equal(h.value(), false);
  assert.equal(h.persisted.auto_hdr_enabled, false);
  await h.assertLaunch(false);
  assert.deepEqual(h.toasts, [
    "Automatic HDR switching enabled", "Automatic HDR switching disabled",
  ]);
});

for (const firstSucceeds of [false, true]) {
  test(`rapid on/off with last save failing rolls back to the confirmed value (${firstSucceeds})`, async () => {
    const h = await ready(false);
    const first = h.change(true);
    const last = h.change(false);
    await flush();
    h.saves[0][firstSucceeds ? "resolve" : "reject"]();
    await first;
    await flush();
    assert.equal(h.value(), false);
    await h.assertLaunch(false);
    h.saves[1].reject();
    await last;
    assert.equal(h.value(), firstSucceeds);
    assert.equal(h.persisted.auto_hdr_enabled, firstSucceeds);
    await h.assertLaunch(firstSucceeds);
  });
}

for (const readFails of [false, true]) {
  test(`late startup settings ${readFails ? "failure" : "response"} cannot undo a toggle`, async () => {
    const initialRead = deferred();
    const h = createHarness(false, initialRead);
    const initialization = h.initialize();
    await h.mount();
    const change = h.change(true);
    await flush();
    h.saves[0].resolve();
    await change;
    if (readFails) initialRead.reject(new Error("late settings read failure"));
    else initialRead.resolve(h.initialSettings);
    await initialization;
    assert.equal(h.value(), true);
    await h.assertLaunch(true);
  });
}

for (const saveSucceeds of [false, true]) {
  test(`reopened panel stays synchronized when a pending save ${saveSucceeds ? "succeeds" : "fails"}`, async () => {
    const h = await ready(false);
    const change = h.change(true);
    h.unmount();
    await h.mount();
    assert.equal(h.value(), true);
    await h.assertLaunch(true);
    h.saves[0][saveSucceeds ? "resolve" : "reject"]();
    await change;
    assert.equal(h.value(), saveSucceeds);
    await h.assertLaunch(saveSucceeds);
  });
}

for (const title of ["Restore previous HDR state", "Mini badges", "Library", "Home"]) {
  for (const initial of [false, true]) {
    test(`${title} response preserves the pending Auto HDR choice ${!initial}`, async () => {
      const h = await ready(initial);
      const otherValue = !h.otherValue(title);
      const change = h.change(!initial);
      await h.changeOther(title, otherValue);
      assert.equal(h.otherValue(title), otherValue);
      assert.equal(h.value(), !initial);
      await h.assertLaunch(!initial);
      await flush();
      h.saves[0].resolve();
      await change;
      assert.equal(h.otherValue(title), otherValue);
      assert.equal(h.value(), !initial);
      assert.equal(h.persisted.auto_hdr_enabled, !initial);
    });
  }
}

test("another setting response between queued Auto HDR saves cannot resurrect the older choice", async () => {
  const h = await ready(false);
  const first = h.change(true);
  const last = h.change(false);
  await flush();
  h.saves[0].resolve();
  // The backend has saved true, but the latest frontend choice is already false.
  await h.changeOther("Restore previous HDR state", false);
  await first;
  await flush();
  assert.equal(h.value(), false);
  assert.equal(h.otherValue("Restore previous HDR state"), false);
  await h.assertLaunch(false);
  h.saves[1].resolve();
  await last;
  assert.equal(h.value(), false);
  assert.equal(h.persisted.auto_hdr_enabled, false);
});

test("another successful setting save preserves a failed Auto HDR toggle's rollback", async () => {
  const h = await ready(false);
  const change = h.change(true);
  await flush();
  h.saves[0].reject();
  await change;
  await h.changeOther("Mini badges", false);
  assert.equal(h.value(), false);
  assert.equal(h.otherValue("Mini badges"), false);
  assert.equal(h.persisted.auto_hdr_enabled, false);
  await h.assertLaunch(false);
});

const nativePersistentInfo = {
  appid: "456",
  game: "Cached HDR Game",
  page: "Cached_HDR_Game",
  hdr: "true",
  source: "PCGamingWiki",
  cached: true,
  automatic_action: "enable",
};

const sdrPersistentInfo = {
  ...nativePersistentInfo,
  hdr: "false",
  automatic_action: "disable",
};

test("launch uses a persistent cache hit when the frontend map is empty", async () => {
  const h = createHarness(true, undefined, {
    persistentCache: { "456": nativePersistentInfo },
  });
  await h.initialize();
  h.clearLaunchCache();
  await h.assertLaunchWrite(true, "456");
  assert.deepEqual(h.cacheOnlyCalls, ["456"]);
  assert.deepEqual(h.networkCalls, []);
  assert.equal(h.cachedLaunchInfo("456")?.hdr, "true");
});

test("launch treats a persistent cache miss as SDR without a network lookup", async () => {
  const h = createHarness(true);
  await h.initialize();
  h.clearLaunchCache();
  await h.assertLaunchWrite(false, "456");
  assert.deepEqual(h.cacheOnlyCalls, ["456"]);
  assert.deepEqual(h.networkCalls, []);
});

test("launch treats a cache-only RPC failure as SDR without a network lookup", async () => {
  const h = createHarness(true, undefined, {
    cacheOnlyError: new Error("cache unavailable"),
  });
  await h.initialize();
  h.clearLaunchCache();
  await h.assertLaunchWrite(false, "456");
  assert.deepEqual(h.cacheOnlyCalls, ["456"]);
  assert.deepEqual(h.networkCalls, []);
});

test("launch keeps using a frontend cache hit without another backend request", async () => {
  const h = createHarness(true);
  await h.initialize();
  await h.assertLaunch(true, "123");
  assert.deepEqual(h.cacheOnlyCalls, []);
  assert.deepEqual(h.networkCalls, []);
});

test("disabled Auto HDR and unavailable AppIDs do not request any cache or network data", async () => {
  const disabled = createHarness(false);
  await disabled.initialize();
  disabled.clearLaunchCache();
  await disabled.assertLaunchWrite(null, "456");
  assert.deepEqual(disabled.cacheOnlyCalls, []);
  assert.deepEqual(disabled.networkCalls, []);

  const unavailable = createHarness(true);
  await unavailable.initialize();
  unavailable.clearLaunchCache();
  await unavailable.assertLaunchWrite(null, "-");
  assert.deepEqual(unavailable.cacheOnlyCalls, []);
  assert.deepEqual(unavailable.networkCalls, []);
});

test("override still reverses a persistent HDR cache decision", async () => {
  const h = createHarness(true, undefined, {
    overrideAppIds: ["456"],
    persistentCache: { "456": nativePersistentInfo },
  });
  await h.initialize();
  h.clearLaunchCache();
  await h.assertLaunchWrite(false, "456");
  assert.deepEqual(h.cacheOnlyCalls, ["456"]);
  assert.deepEqual(h.networkCalls, []);
});

test("override can enable HDR from a persistent SDR cache decision", async () => {
  const h = createHarness(true, undefined, {
    overrideAppIds: ["456"],
    persistentCache: { "456": sdrPersistentInfo },
  });
  await h.initialize();
  h.clearLaunchCache();
  await h.assertLaunchWrite(true, "456");
  assert.deepEqual(h.cacheOnlyCalls, ["456"]);
  assert.deepEqual(h.networkCalls, []);
});

test("game exit while the persistent cache RPC is pending cancels the HDR change", async () => {
  const cacheRead = deferred();
  const h = createHarness(true, undefined, { cacheOnlyDeferred: cacheRead });
  await h.initialize();
  h.clearLaunchCache();
  const launch = h.assertLaunchWrite(null, "456");
  await flush();
  await h.exitApp("456");
  cacheRead.resolve(nativePersistentInfo);
  await launch;
  assert.equal(h.cachedLaunchInfo("456"), undefined);
  assert.deepEqual(h.networkCalls, []);
});

test("disabling Auto HDR while the persistent cache RPC is pending cancels the HDR change", async () => {
  const cacheRead = deferred();
  const h = createHarness(true, undefined, { cacheOnlyDeferred: cacheRead });
  await h.initialize();
  await h.mount();
  h.clearLaunchCache();
  const launch = h.assertLaunchWrite(null, "456");
  await flush();
  const disable = h.change(false);
  cacheRead.resolve(nativePersistentInfo);
  await launch;
  assert.equal(h.cachedLaunchInfo("456"), undefined);
  await flush();
  h.saves[0].resolve();
  await disable;
  assert.deepEqual(h.networkCalls, []);
});

test("clearing the cache while its launch RPC is pending rejects the stale result", async () => {
  const cacheRead = deferred();
  const h = createHarness(true, undefined, { cacheOnlyDeferred: cacheRead });
  await h.initialize();
  h.clearLaunchCache();
  const launch = h.assertLaunchWrite(false, "456");
  await flush();
  h.beginCacheClear();
  cacheRead.resolve(nativePersistentInfo);
  await launch;
  assert.equal(h.cachedLaunchInfo("456"), undefined);
  assert.deepEqual(h.networkCalls, []);
});

test("persistent cache launch creates one restore context and restores the previous HDR state", async () => {
  const h = createHarness(true, undefined, {
    persistentCache: { "456": nativePersistentInfo },
  });
  await h.initialize();
  h.clearLaunchCache();
  await h.assertLaunchWrite(true, "456");
  await h.exitApp("456");
  assert.deepEqual(h.hdrWrites, [
    ["gamescope_hdr_enabled", true],
    ["gamescope_hdr_enabled", false],
  ]);
  await h.exitApp("456");
  assert.equal(h.hdrWrites.length, 2);
});

test("plugin unload while the persistent cache RPC is pending cancels the HDR change", async () => {
  const cacheRead = deferred();
  const h = createHarness(true, undefined, { cacheOnlyDeferred: cacheRead });
  await h.initialize();
  h.clearLaunchCache();
  const launch = h.runLaunch("456");
  await flush();
  h.stopLaunchRuntime();
  cacheRead.resolve(nativePersistentInfo);
  await launch;
  assert.deepEqual(h.hdrWrites, []);
  assert.equal(h.cachedLaunchInfo("456"), undefined);
});

test("a newer launch for the same AppID supersedes a pending cache lookup", async () => {
  const cacheRead = deferred();
  const h = createHarness(true, undefined, { cacheOnlyDeferred: cacheRead });
  await h.initialize();
  h.clearLaunchCache();
  h.clearHdrWrites();
  const first = h.runLaunch("456");
  const second = h.runLaunch("456");
  await flush();
  cacheRead.resolve(nativePersistentInfo);
  await Promise.all([first, second]);
  assert.deepEqual(h.cacheOnlyCalls, ["456", "456"]);
  assert.deepEqual(h.hdrWrites, [["gamescope_hdr_enabled", true]]);
});

test("a frontend cache entry completed during the local RPC is used immediately", async () => {
  const cacheRead = deferred();
  const h = createHarness(true, undefined, { cacheOnlyDeferred: cacheRead });
  await h.initialize();
  h.clearLaunchCache();
  h.clearHdrWrites();
  const launch = h.runLaunch("456");
  await flush();
  h.setLaunchCache("456", nativePersistentInfo);
  cacheRead.resolve(null);
  await launch;
  assert.deepEqual(h.hdrWrites, [["gamescope_hdr_enabled", true]]);
  assert.deepEqual(h.networkCalls, []);
});

test("mini-badge preload shows fixed start and completion toasts only at worker completion", () => {
  const h = createHarness(true);
  h.miniBadgeToast.reset({
    gamepadUiActive: true,
    networkActive: true,
    total: 3,
    targetIds: ["1", "2", "3"],
    queue: ["2", "3"],
    queueRunning: true,
  });

  h.miniBadgeToast.update();
  h.miniBadgeToast.update();
  h.miniBadgeToast.setWorkerState(["3"], false);
  h.miniBadgeToast.update();
  h.miniBadgeToast.setWorkerState([], true);
  h.miniBadgeToast.update();
  assert.deepEqual(h.toastMessages.map(({ body, duration }) => ({ body, duration })), [
    { body: "Loading HDR data for 3 games", duration: 5000 },
  ]);

  h.miniBadgeToast.setWorkerState([], false);
  h.miniBadgeToast.update();
  assert.deepEqual(h.toastMessages.map(({ body, duration }) => ({ body, duration })), [
    { body: "Loading HDR data for 3 games", duration: 5000 },
    { body: "HDR data loaded for 3 games", duration: 4500 },
  ]);
});

test("mini-badge preload remains toast-free in Desktop Mode", () => {
  const h = createHarness(true);
  h.miniBadgeToast.reset({
    gamepadUiActive: false,
    networkActive: true,
    total: 2,
    targetIds: ["1", "2"],
    queue: ["2"],
    queueRunning: true,
  });

  h.miniBadgeToast.update();
  h.miniBadgeToast.setWorkerState([], false);
  h.miniBadgeToast.update();
  assert.deepEqual(h.toastMessages, []);
});

test("cache-only mini-badge queue work does not show network progress toasts", async () => {
  const h = createHarness(true, undefined, {
    networkResult: {
      appid: "1",
      hdr: "true",
      automatic_action: "enable",
      cached: true,
    },
  });
  h.miniBadgeToast.reset({
    gamepadUiActive: true,
    networkActive: false,
    total: 1,
    targetIds: ["1"],
    queue: [],
    queueRunning: false,
  });

  h.miniBadgeToast.queueApp("1");
  await flush();
  assert.deepEqual(h.toastMessages, []);
  assert.deepEqual(h.networkCalls, ["1"]);
});

test("mini-badge network queue work drives the start and completion toasts", async () => {
  const h = createHarness(true, undefined, {
    networkResult: {
      appid: "1",
      hdr: "true",
      automatic_action: "enable",
      cached: false,
    },
  });
  h.miniBadgeToast.reset({
    gamepadUiActive: true,
    networkActive: false,
    total: 1,
    targetIds: ["1"],
    queue: [],
    queueRunning: false,
  });

  h.miniBadgeToast.queueApp("1");
  await flush();
  assert.deepEqual(h.toasts, [
    "Loading HDR data for 1 game",
    "HDR data loaded for 1 game",
  ]);
  assert.deepEqual(h.networkCalls, ["1"]);
});

test("entering Game Mode during a running preload shows the start toast", async () => {
  const h = createHarness(true, undefined, { uiMode: 7 });
  h.miniBadgeToast.reset({
    gamepadUiActive: false,
    networkActive: true,
    total: 4,
    targetIds: ["1", "2", "3", "4"],
    queue: ["2", "3", "4"],
    queueRunning: true,
  });

  h.miniBadgeToast.startUiModeTracking();
  await flush();
  assert.deepEqual(h.toastMessages, []);
  h.changeUiMode(4);
  assert.deepEqual(h.toastMessages.map(({ body, duration }) => ({ body, duration })), [
    { body: "Loading HDR data for 4 games", duration: 5000 },
  ]);
});

test("leaving Game Mode during a running preload suppresses the completion toast", async () => {
  const h = createHarness(true, undefined, { uiMode: 4 });
  h.miniBadgeToast.reset({
    gamepadUiActive: true,
    networkActive: true,
    total: 2,
    targetIds: ["1", "2"],
    queue: ["2"],
    queueRunning: true,
  });

  h.miniBadgeToast.startUiModeTracking();
  await flush();
  h.miniBadgeToast.update();
  h.changeUiMode(7);
  h.miniBadgeToast.setWorkerState([], false);
  h.miniBadgeToast.update();

  assert.deepEqual(h.toasts, ["Loading HDR data for 2 games"]);
});

test("a completed mini-badge preload allows a later preload to notify again", () => {
  const h = createHarness(true);
  h.miniBadgeToast.reset({
    gamepadUiActive: true,
    networkActive: true,
    total: 1,
    targetIds: ["1"],
    queue: ["1"],
    queueRunning: true,
  });
  h.miniBadgeToast.update();
  h.miniBadgeToast.setWorkerState([], false);
  h.miniBadgeToast.update();

  h.miniBadgeToast.setNetworkActive(true);
  h.miniBadgeToast.setWorkerState(["1"], true);
  h.miniBadgeToast.update();
  h.miniBadgeToast.setWorkerState([], false);
  h.miniBadgeToast.update();

  assert.deepEqual(h.toasts, [
    "Loading HDR data for 1 game",
    "HDR data loaded for 1 game",
    "Loading HDR data for 1 game",
    "HDR data loaded for 1 game",
  ]);
});

test("plugin dismount unregisters mini-badge UI mode tracking", () => {
  const h = createHarness(true);
  const plugin = h.loadPlugin();
  assert.equal(h.uiModeUnregisters(), 0);
  plugin.onDismount();
  assert.equal(h.uiModeUnregisters(), 1);

  h.miniBadgeToast.reset({
    gamepadUiActive: false,
    networkActive: true,
    total: 1,
    targetIds: ["1"],
    queue: ["1"],
    queueRunning: true,
  });
  h.changeUiMode(4);
  assert.deepEqual(h.toastMessages, []);
});
