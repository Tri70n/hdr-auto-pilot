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
    Content, refreshRuntimeHdrSettings, applyCachedHdrForLaunch, pcgwLaunchCache,
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

function createHarness(initialEnabled, initialRuntimeRead) {
  let persisted = {
    auto_hdr_enabled: initialEnabled,
    restore_previous_hdr_state: true,
    mini_badges_enabled: true,
    mini_badges_library_enabled: false,
    mini_badges_home_enabled: true,
    override_appids: [],
  };
  const initialSettings = { ...persisted };
  const saves = [];
  const hdrWrites = [];
  const toasts = [];
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
    "@decky/ui": { DialogButton: { render: () => ({ type: "button" }) } },
    "@decky/api": {
      definePlugin: (factory) => factory,
      toaster: { toast: (message) => toasts.push(message.body) },
      callable: (name) => (...args) => {
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
  const context = {
    exports: {},
    require(name) {
      assert.ok(name in imports, `Unexpected import: ${name}`);
      return imports[name];
    },
    console: { log() {}, warn() {}, error() {} },
    document: { querySelectorAll: () => [] },
    window: {
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
    saves, toasts, initialSettings,
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
    async assertLaunch(enabled) {
      hdrWrites.length = 0;
      await runtime.applyCachedHdrForLaunch("123");
      assert.deepEqual(hdrWrites, enabled ? [["gamescope_hdr_enabled", true]] : []);
    },
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
