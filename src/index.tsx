import {
  ButtonItem,
  DialogButton,
  Field,
  Navigation,
  PanelSection,
  PanelSectionRow,
  Toggle,
  afterPatch,
  appDetailsClasses,
  appDetailsHeaderClasses,
  createReactTreePatcher,
  findInReactTree,
  staticClasses,
} from "@decky/ui";

import {
  callable,
  definePlugin,
  routerHook,
  toaster,
} from "@decky/api";

import {
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

import { createPortal } from "react-dom";
import { appActionButtonClasses, playSectionClasses, GamepadButton } from "@decky/ui";

import {
  FaTv,
} from "react-icons/fa";


type HdrInfo = {
  appid: string;
  game: string;
  page: string;
  hdr: string;
  source?: string;
  source_detail?: string;
  cached: boolean;
  automatic_action: "enable" | "disable";
};


type PluginSettings = {
  auto_hdr_enabled: boolean;
  restore_previous_hdr_state: boolean;
  override_appids: string[];
};


const getHdrInfo =
  callable<
    [appid: string],
    HdrInfo
  >("get_hdr_info");


const clearCache =
  callable<
    [],
    boolean
  >("clear_cache");


const getSettings =
  callable<
    [],
    PluginSettings
  >("get_settings");


const setAutoHdrEnabled =
  callable<
    [enabled: boolean],
    PluginSettings
  >("set_auto_hdr_enabled");


const setRestorePreviousHdrState =
  callable<
    [enabled: boolean],
    PluginSettings
  >("set_restore_previous_hdr_state");


const setHdrOverrideForApp =
  callable<
    [appid: string, enabled: boolean],
    PluginSettings
  >("set_hdr_override_for_app");


function SettingsToggle({
  title,
  description,
  value,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Field
      label={title}
      description={description}
    >
      <Toggle
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    </Field>
  );
}

function getSteamWebpackRequire(): any | null {
  try {
    const steamWindow = window as any;
    const chunks =
      steamWindow.webpackChunksteamui;

    if (!chunks?.push) {
      return null;
    }

    let req: any = null;

    chunks.push([
      [`decky-hdr-native-${Date.now()}`],
      {},
      (r: any) => {
        req = r;
      },
    ]);

    return req;

  } catch (e) {
    console.error(
      "Decky HDR: Steam webpack access failed",
      e
    );

    return null;
  }
}


let runtimeAutoHdrEnabled = false;

let runtimeHdrOverrideAppIds =
  new Set<string>();


type HdrRestoreContext = {
  appid: string;
  previousHdr: boolean;
};


const hdrRestoreContexts =
  new Map<string, HdrRestoreContext>();


function getCurrentSteamHdrState():
  boolean | null {
  const value =
    (window as any)
      .settingsStore
      ?.clientSettings
      ?.gamescope_hdr_enabled;

  return typeof value === "boolean"
    ? value
    : null;
}




async function refreshRuntimeHdrSettings() {
  try {
    const settings =
      await getSettings();

    runtimeAutoHdrEnabled =
      !!settings.auto_hdr_enabled;

    runtimeHdrOverrideAppIds =
      new Set(
        settings.override_appids ?? []
      );

    console.log(
      "Decky HDR: runtime Auto HDR",
      runtimeAutoHdrEnabled
    );

    console.log(
      "Decky HDR: runtime HDR override apps",
      Array.from(runtimeHdrOverrideAppIds)
    );

  } catch (e) {
    console.error(
      "Decky HDR: runtime settings load failed",
      e
    );

    runtimeAutoHdrEnabled = false;
    runtimeHdrOverrideAppIds.clear();
  }
}


function setSteamHdrPluginLevel(
  enabled: boolean
): Promise<any> {
  const req =
    getSteamWebpackRequire();

  if (!req) {
    return Promise.reject(
      new Error(
        "Steam Webpack runtime unavailable"
      )
    );
  }

  const module =
    req("33867");

  if (
    !module ||
    typeof module.qt !== "function"
  ) {
    return Promise.reject(
      new Error(
        "Steam settings qt setter unavailable"
      )
    );
  }

  console.log(
    "Decky HDR: plugin-level HDR request",
    enabled
  );

  return Promise.resolve(
    module.qt(
      "gamescope_hdr_enabled",
      enabled
    )
  );
}





async function applyCachedHdrForLaunch(
  appid: string
) {
  if (!runtimeAutoHdrEnabled) {
    console.log(
      "Decky HDR: launch HDR informational only",
      appid
    );

    return;
  }

  if (
    !appid ||
    appid === "-"
  ) {
    console.warn(
      "Decky HDR: launch AppID unavailable"
    );

    return;
  }

  const info =
    pcgwLaunchCache.get(appid);

  const previousHdr =
    getCurrentSteamHdrState();

  if (previousHdr !== null) {
    hdrRestoreContexts.set(
      appid,
      {
        appid,
        previousHdr,
      }
    );

    console.log(
      "Decky HDR: previous HDR state captured",
      appid,
      previousHdr
    );
  } else {
    console.warn(
      "Decky HDR: previous HDR state unavailable",
      appid
    );
  }

  /*
   * Safety rule:
   * Missing cache entry is treated as SDR.
   * No network request is allowed here.
   */
  const automaticDesired =
    info?.automatic_action === "enable";

  const hdrOverride =
    runtimeHdrOverrideAppIds.has(appid);


  const desired =
    hdrOverride
      ? !automaticDesired
      : automaticDesired;

  console.log(
    "Decky HDR: FIRST START HDR decision",
    {
      appid,
      hdr:
        info?.hdr ?? "missing",
      desired:
        desired ? "ON" : "OFF",
      automaticDesired:
        automaticDesired ? "ON" : "OFF",
      hdrOverride,
      cached:
        !!info,
    }
  );

  try {
    await setSteamHdrPluginLevel(
      desired
    );

    console.log(
      "Decky HDR: FIRST START HDR applied",
      appid,
      desired
    );

  } catch (e) {
    console.error(
      "Decky HDR: FIRST START HDR failed",
      appid,
      e
    );
  }
}



async function restoreHdrAfterGameExit(
  appid: string
) {
  const context =
    hdrRestoreContexts.get(appid);

  if (!context) {
    return;
  }

  /*
   * Context immediately consume so duplicate lifetime
   * notifications cannot trigger multiple restores.
   */
  hdrRestoreContexts.delete(appid);

  let settings: PluginSettings;

  try {
    settings =
      await getSettings();

  } catch (e) {
    console.error(
      "Decky HDR: restore settings read failed",
      e
    );

    return;
  }

  if (
    !settings.restore_previous_hdr_state
  ) {
    console.log(
      "Decky HDR: HDR restore disabled",
      appid
    );

    return;
  }

  try {
    await setSteamHdrPluginLevel(
      context.previousHdr
    );

    console.log(
      "Decky HDR: HDR state restored",
      appid,
      context.previousHdr
    );

  } catch (e) {
    console.error(
      "Decky HDR: HDR restore failed",
      appid,
      e
    );
  }
}


function handleAppLifetimeNotification(
  event: any
) {
  const appid =
    String(
      event?.unAppID ?? ""
    );

  const running =
    event?.bRunning;

  if (
    !appid ||
    appid === "0"
  ) {
    return;
  }

  console.log(
    "Decky HDR: app lifetime",
    appid,
    running
  );

  if (running === false) {
    void restoreHdrAfterGameExit(
      appid
    );
  }
}


type SteamLaunchCycle = {
  cycleId: number;
  gameId: string;
  firstStartArgs: any[];
  launchActionEnded: boolean;
};


let steamLaunchCycleCounter = 0;

let steamActiveLaunchCycle:
  SteamLaunchCycle | null = null;

let steamLaunchRegistrations: any[] = [];

let steamLaunchRuntimeStarted = false;


function normalizeSteamLaunchArgs(
  eventArgs: any[]
): any[] {
  return eventArgs.map(
    (value) => {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        return value;
      }

      try {
        return JSON.parse(
          JSON.stringify(value)
        );
      } catch {
        return String(value);
      }
    }
  );
}


function probableSteamGameId(
  eventArgs: any[]
): string {
  const value = eventArgs?.[1];

  if (
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return String(value);
  }

  return "-";
}


function beginSteamLaunchCycle(
  eventArgs: any[]
) {
  /*
   * FIRST START wins.
   *
   * Additional START events belonging to the
   * same active Steam launch action must not
   * replace the AppID or start arguments.
   */
  if (
    steamActiveLaunchCycle &&
    !steamActiveLaunchCycle.launchActionEnded
  ) {
    console.log(
      "Decky HDR: additional START ignored",
      ...eventArgs
    );

    return;
  }

  steamLaunchCycleCounter += 1;

  const cycle: SteamLaunchCycle = {
    cycleId: steamLaunchCycleCounter,
    gameId:
      probableSteamGameId(
        eventArgs
      ),
    firstStartArgs:
      normalizeSteamLaunchArgs(
        eventArgs
      ),
    launchActionEnded: false,
  };

  steamActiveLaunchCycle = cycle;

  console.log(
    "Decky HDR: FIRST START captured",
    cycle
  );

  void applyCachedHdrForLaunch(
    cycle.gameId
  );

}


function finishSteamLaunchAction() {
  if (!steamActiveLaunchCycle) {
    return;
  }

  steamActiveLaunchCycle = {
    ...steamActiveLaunchCycle,
    launchActionEnded: true,
  };

  /*
   * Important:
   * GameActionEnd only means Steam's launch
   * action finished. It is NOT game exit.
   *
   * We retain the completed cycle for the UI
   * and for later HDR/restore logic.
   */
}


function disposeSteamRegistration(
  registration: any
) {
  try {
    if (
      typeof registration === "function"
    ) {
      registration();
      return;
    }

    if (
      typeof registration?.unregister ===
      "function"
    ) {
      registration.unregister();
      return;
    }

    if (
      typeof registration?.Unregister ===
      "function"
    ) {
      registration.Unregister();
    }

  } catch (e) {
    console.warn(
      "Decky HDR: Steam listener cleanup failed",
      e
    );
  }
}


function startSteamLaunchRuntime() {
  if (steamLaunchRuntimeStarted) {
    return;
  }

  steamLaunchRuntimeStarted = true;

  const steamClient =
    (window as any).SteamClient;

  const apps =
    steamClient?.Apps;

  if (!apps) {
    return;
  }


  const register = (
    name: string,
    type: string,
    handler?: (
      eventArgs: any[]
    ) => void
  ) => {
    const method =
      apps[name];

    if (typeof method !== "function") {
      console.warn(
        `Decky HDR: ${name} missing`
      );

      return;
    }

    try {
      const registration =
        method.call(
          apps,
          (...eventArgs: any[]) => {
            console.log(
              `Decky HDR: persistent ${type}`,
              ...eventArgs
            );

            handler?.(
              eventArgs
            );
          }
        );

      steamLaunchRegistrations.push(
        registration
      );

    } catch (e) {
      console.warn(
        `Decky HDR: ${name} registration failed`,
        e
      );
    }
  };


  register(
    "RegisterForGameActionStart",
    "START",
    (eventArgs) => {
      beginSteamLaunchCycle(
        eventArgs
      );
    }
  );


  register(
    "RegisterForGameActionTaskChange",
    "TASK"
  );


  register(
    "RegisterForGameActionUserRequest",
    "REQUEST"
  );


  register(
    "RegisterForGameActionEnd",
    "END",
    () => {
      finishSteamLaunchAction();
    }
  );


  const gameSessions =
    steamClient?.GameSessions;

  const lifetimeRegister =
    gameSessions
      ?.RegisterForAppLifetimeNotifications;

  if (
    typeof lifetimeRegister === "function"
  ) {
    try {
      const lifetimeRegistration =
        lifetimeRegister.call(
          gameSessions,
          handleAppLifetimeNotification
        );

      steamLaunchRegistrations.push(
        lifetimeRegistration
      );

      console.log(
        "Decky HDR: app lifetime listener ready"
      );

    } catch (e) {
      console.error(
        "Decky HDR: app lifetime listener failed",
        e
      );
    }
  } else {
    console.warn(
      "Decky HDR: app lifetime listener unavailable"
    );
  }


  if (
    steamLaunchRegistrations.length === 0
  ) {
    return;
  }

  console.log(
    "Decky HDR: FIRST-START launch runtime ready"
  );
}


function stopSteamLaunchRuntime() {
  for (
    const registration of
    steamLaunchRegistrations
  ) {
    disposeSteamRegistration(
      registration
    );
  }

  steamLaunchRegistrations = [];
  steamLaunchRuntimeStarted = false;

  console.log(
    "Decky HDR: launch runtime stopped"
  );
}


const pcgwLaunchCache =
  new Map<string, HdrInfo>();


type PcgwWarmupStats = {
  status: string;
  totalQueued: number;
  completed: number;
  cacheHits: number;
  fetched: number;
  failed: number;
  currentAppId: string;
  currentGame: string;
};


let pcgwWarmupStats: PcgwWarmupStats = {
  status: "IDLE",
  totalQueued: 0,
  completed: 0,
  cacheHits: 0,
  fetched: 0,
  failed: 0,
  currentAppId: "-",
  currentGame: "-",
};


const pcgwWarmupSubscribers =
  new Set<() => void>();


const pcgwWarmupQueue:
  InstalledSteamGame[] = [];


const pcgwWarmupQueuedIds =
  new Set<number>();


let pcgwWarmupRunning = false;

let pcgwInitialLibraryQueued = false;


function notifyPcgwWarmupSubscribers() {
  for (
    const subscriber of
    pcgwWarmupSubscribers
  ) {
    try {
      subscriber();
    } catch (e) {
      console.warn(
        "Decky HDR: PCGW warmup subscriber failed",
        e
      );
    }
  }
}


function updatePcgwWarmupStats(
  update: Partial<PcgwWarmupStats>
) {
  pcgwWarmupStats = {
    ...pcgwWarmupStats,
    ...update,
  };

  notifyPcgwWarmupSubscribers();
}


function sleepPcgwWarmup(
  milliseconds: number
) {
  return new Promise<void>(
    (resolve) => {
      window.setTimeout(
        resolve,
        milliseconds
      );
    }
  );
}


function queueInstalledGameForPcgw(
  game: InstalledSteamGame
) {
  if (
    !game ||
    !Number.isInteger(game.appid) ||
    game.appid <= 0
  ) {
    return;
  }

  if (
    pcgwWarmupQueuedIds.has(
      game.appid
    )
  ) {
    return;
  }

  pcgwWarmupQueuedIds.add(
    game.appid
  );

  pcgwWarmupQueue.push({
    ...game,
  });

  updatePcgwWarmupStats({
    totalQueued:
      pcgwWarmupStats.totalQueued + 1,
  });

  void runPcgwWarmupQueue();
}


function queueInstalledGamesForPcgw(
  games: InstalledSteamGame[]
) {
  for (const game of games) {
    queueInstalledGameForPcgw(
      game
    );
  }
}


async function runPcgwWarmupQueue() {
  if (pcgwWarmupRunning) {
    return;
  }

  pcgwWarmupRunning = true;

  try {
    while (
      pcgwWarmupQueue.length > 0
    ) {
      const game =
        pcgwWarmupQueue.shift();

      if (!game) {
        continue;
      }

      updatePcgwWarmupStats({
        status: "RUNNING",
        currentAppId:
          String(game.appid),
        currentGame:
          game.name,
      });

      try {
        const result =
          await getHdrInfo(
            String(game.appid)
          );

        pcgwLaunchCache.set(
          String(game.appid),
          result
        );

        updatePcgwWarmupStats({
          completed:
            pcgwWarmupStats.completed + 1,
          cacheHits:
            pcgwWarmupStats.cacheHits +
            (
              result.cached
                ? 1
                : 0
            ),
          fetched:
            pcgwWarmupStats.fetched +
            (
              result.cached
                ? 0
                : 1
            ),
        });

        console.log(
          "Decky HDR: PCGW library warmup",
          {
            appid:
              game.appid,
            game:
              game.name,
            hdr:
              result.hdr,
            cached:
              result.cached,
            automaticAction:
              result.automatic_action,
          }
        );

      } catch (e) {
        console.error(
          "Decky HDR: PCGW library warmup failed",
          game,
          e
        );

        updatePcgwWarmupStats({
          completed:
            pcgwWarmupStats.completed + 1,
          failed:
            pcgwWarmupStats.failed + 1,
        });
      }

      /*
       * PCGamingWiki rate limit is 30/min.
       * Cached requests are local, but keeping one
       * conservative cadence also protects first-run
       * scans of larger libraries.
       */
      if (
        pcgwWarmupQueue.length > 0
      ) {
        await sleepPcgwWarmup(
          2200
        );
      }
    }

    updatePcgwWarmupStats({
      status: "READY",
      currentAppId: "-",
      currentGame: "-",
    });

  } finally {
    pcgwWarmupRunning = false;

    /*
     * Something could have been queued between
     * the final loop check and clearing the flag.
     */
    if (
      pcgwWarmupQueue.length > 0
    ) {
      void runPcgwWarmupQueue();
    }
  }
}


function handleInstalledLibraryForPcgw(
  games: InstalledSteamGame[],
  added: number[]
) {
  /*
   * First complete library snapshot:
   * warm every installed game's persistent
   * backend cache.
   */
  if (!pcgwInitialLibraryQueued) {
    pcgwInitialLibraryQueued = true;

    queueInstalledGamesForPcgw(
      games
    );

    return;
  }

  /*
   * Afterwards only newly installed AppIDs are
   * queued automatically.
   */
  if (!added.length) {
    return;
  }

  const addedIds =
    new Set(added);

  const addedGames =
    games.filter(
      (game) =>
        addedIds.has(
          game.appid
        )
    );

  queueInstalledGamesForPcgw(
    addedGames
  );
}


function PcgwLibraryWarmupStatus() {
  const [
    stats,
    setStats,
  ] = useState<PcgwWarmupStats>(
    () => ({
      ...pcgwWarmupStats,
    })
  );


  useEffect(() => {
    const update = () => {
      setStats({
        ...pcgwWarmupStats,
      });
    };

    pcgwWarmupSubscribers.add(
      update
    );

    update();

    return () => {
      pcgwWarmupSubscribers.delete(
        update
      );
    };
  }, []);


  return (
    <div
      style={{
        width: "100%",
        fontSize: "0.82em",
        lineHeight: "1.45",
      }}
    >
      <div>
        PCGW preload: {
          stats.status
        }
      </div>

      <div>
        Progress: {
          stats.completed
        } / {
          stats.totalQueued
        }
      </div>

      <div>
        Cache hits: {
          stats.cacheHits
        }
      </div>

      <div>
        Network fetches: {
          stats.fetched
        }
      </div>

      <div>
        Failed: {
          stats.failed
        }
      </div>

      <div>
        Current: {
          stats.currentGame
        } ({
          stats.currentAppId
        })
      </div>

      <div
        style={{
          marginTop: "8px",
        }}
      >
        <ButtonItem
          layout="below"
          onClick={async () => {
            await clearCache();

            pcgwLaunchCache.clear();
            pcgwWarmupQueue.length = 0;
            pcgwWarmupQueuedIds.clear();

            pcgwWarmupStats = {
              status: "IDLE",
              totalQueued: 0,
              completed: 0,
              cacheHits: 0,
              fetched: 0,
              failed: 0,
              currentAppId: "-",
              currentGame: "-",
            };

            notifyPcgwWarmupSubscribers();

            queueInstalledGamesForPcgw(
              installedSteamGames
            );

            /*
             * The mini-badge runtime has its own completion/queue state.
             * Clearing PCGW data without resetting that state makes every
             * library AppID look already finished, so nothing is queued again.
             * Reuse the existing target snapshot here. Do not rediscover the
             * library, restart observers, or add any startup work.
             */
            dismissHdrMiniBadgeLoadingToast();
            hdrMiniBadgeQueue.length = 0;
            hdrMiniBadgeQueuedIds.clear();
            hdrMiniBadgeCompletedIds.clear();
            hdrMiniBadgeNotifyNetworkActive = false;
            hdrMiniBadgeNotifyStartShown = false;
            for (const appid of hdrMiniBadgeTargetIds) {
              queueHdrMiniBadgeApp(appid);
            }

            toaster.toast({
              title: "HDR Auto Pilot",
              body: "Refreshing HDR data",
              playSound: false,
              showToast: true,
            });
          }}
        >
          Refresh installed HDR data
        </ButtonItem>
      </div>
    </div>
  );
}


type InstalledSteamGame = {
  appid: number;
  name: string;
};


let installedSteamGames:
  InstalledSteamGame[] = [];

let installedLibraryStatus =
  "NOT INITIALIZED";

let installedLibraryChangeCount = 0;

let installedLibraryLastReason = "-";

let installedLibraryAdded: number[] = [];

let installedLibraryRemoved: number[] = [];

const installedLibrarySubscribers =
  new Set<() => void>();

let installedLibraryRegistration:
  any = null;

let installedLibraryRuntimeStarted =
  false;


function notifyInstalledLibrarySubscribers() {
  for (
    const subscriber of
    installedLibrarySubscribers
  ) {
    try {
      subscriber();
    } catch (e) {
      console.warn(
        "Decky HDR: library subscriber failed",
        e
      );
    }
  }
}


function readInstalledSteamGames():
  InstalledSteamGame[] {
  const appStore =
    (window as any).appStore;

  if (!appStore) {
    return [];
  }

  const allApps =
    Array.isArray(appStore.allApps)
      ? appStore.allApps
      : [];

  const games =
    allApps
      .filter(
        (app: any) => {
          if (!app) {
            return false;
          }

          /*
           * app_type 1 = normal Steam game.
           *
           * Use LOCAL per-client state rather than
           * "most available", so remote-streamable
           * games are not counted as locally installed.
           */
          return (
            app.app_type === 1 &&
            app.local_per_client_data
              ?.installed === true &&
            Number.isInteger(app.appid) &&
            app.appid > 0
          );
        }
      )
      .map(
        (app: any) => ({
          appid: app.appid,
          name:
            String(
              app.display_name ??
              `App ${app.appid}`
            ),
        })
      );

  games.sort(
    (a: InstalledSteamGame,
     b: InstalledSteamGame) =>
      a.name.localeCompare(b.name)
  );

  return games;
}


function refreshInstalledSteamGames(
  reason: string
) {
  const appStore =
    (window as any).appStore;

  if (!appStore) {
    installedLibraryStatus =
      "appStore MISSING";

    notifyInstalledLibrarySubscribers();
    return;
  }

  const previousIds =
    new Set(
      installedSteamGames.map(
        (game) => game.appid
      )
    );

  const next =
    readInstalledSteamGames();

  const nextIds =
    new Set(
      next.map(
        (game) => game.appid
      )
    );

  installedLibraryAdded =
    next
      .filter(
        (game) =>
          !previousIds.has(
            game.appid
          )
      )
      .map(
        (game) => game.appid
      );

  installedLibraryRemoved =
    installedSteamGames
      .filter(
        (game) =>
          !nextIds.has(
            game.appid
          )
      )
      .map(
        (game) => game.appid
      );

  installedSteamGames = next;

  installedLibraryLastReason =
    reason;

  installedLibraryChangeCount += 1;

  installedLibraryStatus =
    appStore.m_bIsInitialized === false
      ? "WAITING FOR APP STORE"
      : "READY";

  console.log(
    "Decky HDR: installed library refresh",
    {
      reason,
      count:
        installedSteamGames.length,
      added:
        installedLibraryAdded,
      removed:
        installedLibraryRemoved,
    }
  );

  /*
   * Only queue once Steam's AppStore has a
   * complete initialized snapshot.
   */
  if (
    installedLibraryStatus === "READY"
  ) {
    handleInstalledLibraryForPcgw(
      installedSteamGames,
      installedLibraryAdded
    );
  }

  notifyInstalledLibrarySubscribers();
}


function startInstalledLibraryRuntime() {
  if (installedLibraryRuntimeStarted) {
    return;
  }

  installedLibraryRuntimeStarted = true;

  refreshInstalledSteamGames(
    "plugin-start"
  );

  const steamClient =
    (window as any).SteamClient;

  const apps =
    steamClient?.Apps;

  const register =
    apps?.RegisterForAppOverviewChanges;

  if (typeof register !== "function") {
    installedLibraryStatus =
      "APP CHANGE LISTENER MISSING";

    notifyInstalledLibrarySubscribers();
    return;
  }

  try {
    installedLibraryRegistration =
      register.call(
        apps,
        () => {
          /*
           * Steam's own AppStore also consumes this
           * event. Defer our scan one tick so we read
           * the updated appStore rather than racing it.
           */
          window.setTimeout(
            () => {
              refreshInstalledSteamGames(
                "app-overview-change"
              );
            },
            0
          );
        }
      );

  } catch (e) {
    console.error(
      "Decky HDR: app overview listener failed",
      e
    );

    installedLibraryStatus =
      `LISTENER ERROR: ${String(e)}`;

    notifyInstalledLibrarySubscribers();
  }
}


function stopInstalledLibraryRuntime() {
  try {
    if (
      typeof installedLibraryRegistration ===
      "function"
    ) {
      installedLibraryRegistration();

    } else if (
      typeof installedLibraryRegistration
        ?.unregister === "function"
    ) {
      installedLibraryRegistration
        .unregister();

    } else if (
      typeof installedLibraryRegistration
        ?.Unregister === "function"
    ) {
      installedLibraryRegistration
        .Unregister();
    }

  } catch (e) {
    console.warn(
      "Decky HDR: library listener cleanup failed",
      e
    );
  }

  installedLibraryRegistration = null;
  installedLibraryRuntimeStarted = false;
}


function SteamInstalledLibraryScanner() {
  const [
    status,
    setStatus,
  ] = useState(
    installedLibraryStatus
  );

  const [
    games,
    setGames,
  ] = useState<
    InstalledSteamGame[]
  >(
    () =>
      installedSteamGames.map(
        (game) => ({...game})
      )
  );

  const [
    details,
    setDetails,
  ] = useState({
    reason:
      installedLibraryLastReason,
    changes:
      installedLibraryChangeCount,
    added:
      [...installedLibraryAdded],
    removed:
      [...installedLibraryRemoved],
  });


  useEffect(() => {
    const update = () => {
      setStatus(
        installedLibraryStatus
      );

      setGames(
        installedSteamGames.map(
          (game) => ({...game})
        )
      );

      setDetails({
        reason:
          installedLibraryLastReason,
        changes:
          installedLibraryChangeCount,
        added:
          [...installedLibraryAdded],
        removed:
          [...installedLibraryRemoved],
      });
    };

    installedLibrarySubscribers.add(
      update
    );

    update();

    return () => {
      installedLibrarySubscribers.delete(
        update
      );
    };
  }, []);


  return (
    <div
      style={{
        width: "100%",
        fontSize: "0.82em",
        lineHeight: "1.45",
      }}
    >
      <div>
        Scanner: {status}
      </div>

      <div>
        Installed games: {
          games.length
        }
      </div>

      <div>
        Last refresh: {
          details.reason
        }
      </div>

      <div>
        Refresh count: {
          details.changes
        }
      </div>

      <div>
        Added: {
          details.added.length
            ? details.added.join(", ")
            : "-"
        }
      </div>

      <div>
        Removed: {
          details.removed.length
            ? details.removed.join(", ")
            : "-"
        }
      </div>

      <div
        style={{
          marginTop: "10px",
          maxHeight: "320px",
          overflowY: "auto",
        }}
      >
        {games.slice(0, 80).map(
          (game) => (
            <div
              key={game.appid}
            >
              {game.name}: {
                game.appid
              }
            </div>
          )
        )}

        {games.length > 80 && (
          <div>
            ... plus {
              games.length - 80
            } more
          </div>
        )}
      </div>
    </div>
  );
}



function AdvancedHdrCacheSummary() {
  const [
    cachedCount,
    setCachedCount,
  ] = useState(
    () => pcgwLaunchCache.size
  );


  useEffect(() => {
    const update = () => {
      setCachedCount(
        pcgwLaunchCache.size
      );
    };

    installedLibrarySubscribers.add(
      update
    );

    pcgwWarmupSubscribers.add(
      update
    );

    update();

    return () => {
      installedLibrarySubscribers.delete(
        update
      );

      pcgwWarmupSubscribers.delete(
        update
      );
    };
  }, []);


  return (
    <div
      style={{
        width: "100%",
        fontSize: "0.82em",
        opacity: 0.8,
      }}
    >
      {cachedCount} HDR cache entries
    </div>
  );
}



function captureHdrNavContext(el: HTMLElement | null): any {
  if (!el || !el.isConnected) return null;
  try {
    const key = Object.keys(el).find(k => k.startsWith("__reactFiber$"));
    if (!key) return null;
    let fiber: any = (el as any)[key];
    let node: any = null;
    for (let i = 0; fiber && i < 40; i++) {
      const props = fiber.memoizedProps;
      if (!node && props?.node?.m_rgChildren && typeof props.node.AddChild === "function") node = props.node;
      if (node && props?.value === node) {
        const t: any = fiber.type;
        const ctx = t?._context?.Provider ? t._context : t?.Provider ? t : null;
        if (ctx) return { ctx, node };
      }
      fiber = fiber.return;
    }
  } catch {}
  return null;
}


function HdrNavBridge({ capture, children }: { capture: any; children: any }) {
  if (!capture) return children;
  const Provider = capture.ctx.Provider ?? capture.ctx;
  return <Provider value={capture.node}>{children}</Provider>;
}


const DeckyHdrButton =
  (DialogButton as any).render({}).type as any;


function HdrLibraryBadge({
  appid,
}: {
  appid: string;
}) {
  const anchorRef =
    useRef<HTMLDivElement | null>(null);

  const [heroTarget, setHeroTarget] =
    useState<HTMLElement | null>(null);

  const [heroNavCapture, setHeroNavCapture] =
    useState<any>(null);

  const [info, setInfo] =
    useState<HdrInfo | undefined>(
      () => pcgwLaunchCache.get(appid)
    );

  const [
    visible,
    setVisible,
  ] = useState(false);

  const [
    active,
    setActive,
  ] = useState(false);

  const isInstalled =
    installedSteamGames.some(
      (game) =>
        String(game.appid) === appid
    );

  const [
    forceHdr,
    setForceHdr,
  ] = useState(
    () =>
      runtimeHdrOverrideAppIds.has(appid)
  );

  const [overrideFocused, setOverrideFocused] =
    useState(false);

  const [overrideNotice, setOverrideNotice] =
    useState<{
      first: string;
      second: string;
    } | null>(null);

  const overrideNoticeTimerRef =
    useRef<number | null>(null);

  const showOverrideNotice = (
    overrideEnabled: boolean
  ) => {
    const autoWouldEnable =
      info?.automatic_action === "enable";

    const first = overrideEnabled
      ? (
          autoWouldEnable
            ? "Override active · HDR Auto Pilot would enable HDR."
            : "Override active · HDR Auto Pilot would disable HDR."
        )
      : "Override disabled · HDR Auto Pilot resumes normal control.";

    const second = overrideEnabled
      ? (
          autoWouldEnable
            ? "This game will start in SDR instead."
            : "This game will start with HDR instead."
        )
      : (
          autoWouldEnable
            ? "This game will start with HDR."
            : "This game will start in SDR."
        );

    setOverrideNotice({
      first,
      second,
    });

    if (overrideNoticeTimerRef.current !== null) {
      window.clearTimeout(
        overrideNoticeTimerRef.current
      );
    }

    overrideNoticeTimerRef.current =
      window.setTimeout(() => {
        setOverrideNotice(null);
        overrideNoticeTimerRef.current = null;
      }, 5500);
  };


  const lastLowerFocusRef =
    useRef<HTMLElement | null>(null);


  useEffect(() => {
    let cancelled = false;

    const update = () => {
      setInfo(
        pcgwLaunchCache.get(appid)
      );
    };

    const loadIfMissing = async () => {
      if (pcgwLaunchCache.has(appid)) {
        return;
      }

      try {
        console.log(
          "Decky HDR: lazy library HDR lookup start",
          appid
        );

        const result =
          await getHdrInfo(appid);

        /*
         * Keep a completed lookup even if the user
         * already navigated away while it was running.
         */
        pcgwLaunchCache.set(
          appid,
          result
        );

        notifyPcgwWarmupSubscribers();

        console.log(
          "Decky HDR: lazy library HDR lookup complete",
          {
            appid,
            hdr: result.hdr,
            cached: result.cached,
          }
        );

        if (!cancelled) {
          setInfo(result);
        }

      } catch (e) {
        console.warn(
          "Decky HDR: lazy library HDR lookup failed",
          appid,
          e
        );
      }
    };

    pcgwWarmupSubscribers.add(update);
    update();
    void loadIfMissing();

    return () => {
      cancelled = true;
      pcgwWarmupSubscribers.delete(update);
    };
  }, [appid]);


  /*
   * Find the real Hero / TopCapsule DOM node.
   *
   * The route patch itself stays in the stable
   * InnerContainer. The visible badge is portaled
   * into the Hero once that DOM node exists.
   */
  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const findHero = () => {
      if (cancelled) {
        return;
      }

      const anchor =
        anchorRef.current;

      let header:
        HTMLElement | null = null;


      /*
       * Preferred path:
       * inspect siblings around our stable
       * InnerContainer anchor.
       */
      const siblings =
        anchor
          ?.parentElement
          ?.children;

      if (siblings) {
        for (const child of siblings) {
          const element =
            child as HTMLElement;

          const className =
            String(
              element.className ?? ""
            );

          if (
            className.includes(
              appDetailsClasses.Header
            )
          ) {
            header = element;
            break;
          }
        }
      }


      /*
       * Fallback for Steam UI tree variations.
       */
      if (!header) {
        const candidates =
          Array.from(
            document.querySelectorAll(
              `.${appDetailsClasses.Header}`
            )
          ) as HTMLElement[];

        header =
          candidates[0] ?? null;
      }


      if (header) {
        const hero =
          Array.from(
            header.querySelectorAll("*")
          ).find((element) => {
            const className =
              String(
                (element as HTMLElement)
                  .className ?? ""
              );

            return className.includes(
              appDetailsHeaderClasses
                .TopCapsule
            );
          }) as HTMLElement | undefined;


        if (hero) {
          setHeroNavCapture(captureHdrNavContext(hero));
          setHeroTarget(hero);

          window.requestAnimationFrame(
            () => {
              if (!cancelled) {
                setVisible(true);
              }
            }
          );

          return;
        }
      }


      timer =
        window.setTimeout(
          findHero,
          150
        );
    };


    findHero();


    return () => {
      cancelled = true;

      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, []);


  useEffect(() => {
    if (!heroTarget) {
      return;
    }

    const doc =
      heroTarget.ownerDocument;

    const win =
      doc.defaultView as any;

    const findNavNode = (
      target: HTMLElement
    ): any => {
      const controller =
        win?.FocusNavController ??
        (globalThis as any)
          .FocusNavController;

      if (!controller) {
        return null;
      }

      const trees: any[] = [];

      for (
        const context of [
          controller.m_ActiveContext,
          controller.m_LastActiveContext,
        ]
      ) {
        for (
          const tree of
            context
              ?.m_rgGamepadNavigationTrees ??
            []
        ) {
          if (!trees.includes(tree)) {
            trees.push(tree);
          }
        }
      }

      const walk = (
        node: any
      ): any => {
        if (!node) {
          return null;
        }

        const element =
          node.m_element ??
          node.Element ??
          node.m_Element ??
          node.m_pElement ??
          node.element;

        if (element === target) {
          return node;
        }

        const children =
          node.m_rgChildren ??
          node.m_children ??
          node.children ??
          [];

        for (const child of children) {
          const found =
            walk(child);

          if (found) {
            return found;
          }
        }

        return null;
      };

      for (const tree of trees) {
        const root =
          tree.m_Root ??
          tree.Root ??
          tree.m_root ??
          tree;

        const found =
          walk(root);

        if (found) {
          return found;
        }
      }

      return null;
    };


    const nearestVerticalNavElement = (
      source: HTMLElement,
      direction: "up" | "down"
    ): HTMLElement | null => {
      const sourceNode = findNavNode(source);
      const tree =
        sourceNode?.m_Tree ??
        sourceNode?.Tree;

      const root =
        tree?.m_Root ??
        tree?.Root ??
        tree?.m_root;

      if (!root) return null;

      const sourceRect =
        source.getBoundingClientRect();

      const sx =
      source.id === "decky-hdr-library-badge" &&
      direction === "up"
        ? heroTarget.getBoundingClientRect().left +
          20 +
          sourceRect.width / 2
        : sourceRect.left +
          sourceRect.width / 2;
    const sy =
        sourceRect.top +
        sourceRect.height / 2;

      let best: HTMLElement | null = null;
      let bestScore = Infinity;

      const walk = (node: any) => {
        if (!node) return;

        const el =
          node.m_element ??
          node.Element ??
          node.m_Element ??
          node.m_pElement ??
          node.element;

        if (
          el instanceof win.HTMLElement &&
          el !== source &&
          el.isConnected &&
          typeof node.BTakeFocus === "function"
        ) {
          const r =
            el.getBoundingClientRect();

          if (r.width > 0 && r.height > 0) {
            const x =
              r.left + r.width / 2;
            const y =
              r.top + r.height / 2;

            const vertical =
              direction === "up"
                ? sy - y
                : y - sy;

            if (vertical > 2) {
              const horizontal =
                Math.abs(sx - x);

              const score =
                vertical +
                horizontal * 1.5;

              if (score < bestScore) {
                bestScore = score;
                best = el;
              }
            }
          }
        }

        for (
          const child of
            node.m_rgChildren ??
            node.m_children ??
            node.children ??
            []
        ) {
          walk(child);
        }
      };

      walk(root);
      return best;
    };


    const takeFocus = (
      target: HTMLElement
    ) => {
      const navNode =
        findNavNode(target);

      try {
        if (
          typeof navNode?.BTakeFocus ===
          "function"
        ) {
          navNode.BTakeFocus(2);
          return;
        }

        if (
          typeof navNode
            ?.m_Tree
            ?.TakeFocus ===
          "function"
        ) {
          navNode.m_Tree.TakeFocus(
            2,
            navNode
          );
          return;
        }
      } catch (e) {
        console.warn(
          "Decky HDR: gamepad focus failed",
          e
        );
      }

      try {
        target.focus();
      } catch {}
    };


    const hasClassInParents = (
      element: HTMLElement,
      className: string
    ) => {
      let current:
        HTMLElement | null =
          element;

      while (current) {
        if (
          String(
            current.className ?? ""
          )
            .split(/\s+/)
            .includes(className)
        ) {
          return true;
        }

        current =
          current.parentElement;
      }

      return false;
    };


    const handler = (
      event: Event
    ) => {
      const detail =
        (event as CustomEvent<any>)
          .detail;

      const focused =
        (
          doc.querySelector(
            ".gpfocus"
          ) ??
          doc.activeElement
        ) as HTMLElement | null;

      if (!focused) {
        return;
      }

      const badge =
        doc.getElementById(
          "decky-hdr-library-badge"
        ) as HTMLElement | null;

      const isHdr =
        !!badge &&
        (
          focused === badge ||
          badge.contains(focused)
        );


    const override =
      doc.getElementById(
        "decky-hdr-force-toggle"
      ) as HTMLElement | null;

    const isOverride =
      !!override &&
      (
        focused === override ||
        override.contains(focused)
      );

      const proton =
        badge
          ? nearestVerticalNavElement(
              badge,
              "up"
            )
          : null;

      const isProton =
        !!proton &&
        (
          focused === proton ||
          proton.contains(focused)
        );

      const redirectFocus = (
        target: HTMLElement | null
      ) => {
        if (!target) return false;

        event.preventDefault();
        event.stopPropagation();
        (event as any)
          .stopImmediatePropagation?.();

        takeFocus(target);
        return true;
      };

      if (isOverride) {
        if (
          detail?.button ===
          GamepadButton.DIR_LEFT
        ) {
          redirectFocus(badge);
          return;
        }

        if (
          detail?.button ===
          GamepadButton.DIR_DOWN
        ) {
          redirectFocus(
            nearestVerticalNavElement(
              override!,
              "down"
            )
          );
          return;
        }

        if (
          detail?.button ===
          GamepadButton.DIR_UP
        ) {
          event.preventDefault();
          event.stopPropagation();
          (event as any)
            .stopImmediatePropagation?.();
          return;
        }

        /*
         * DIR_RIGHT bleibt absichtlich
         * unangetastet.
         */
        return;
      }

    if (isHdr) {
      if (
        detail?.button ===
        GamepadButton.DIR_RIGHT
      ) {
        redirectFocus(override);
        return;
      }

        if (
          detail?.button ===
          GamepadButton.DIR_UP
        ) {
          redirectFocus(proton);
          return;
        }

        if (
          detail?.button ===
          GamepadButton.DIR_DOWN
        ) {
          redirectFocus(
            nearestVerticalNavElement(
              badge!,
              "down"
            )
          );
          return;
        }

        return;
      }

      if (isProton) {
        if (
          detail?.button ===
          GamepadButton.DIR_UP
        ) {
          redirectFocus(
            nearestVerticalNavElement(
              proton!,
              "up"
            )
          );
          return;
        }

        if (
          detail?.button ===
          GamepadButton.DIR_DOWN
        ) {
          redirectFocus(badge);
          return;
        }

        return;
      }

      if (
        detail?.button !==
        GamepadButton.DIR_UP
      ) {
        return;
      }

      const isLowerAction =
        hasClassInParents(
          focused,
          appActionButtonClasses
            .PlayButton
        ) ||
        hasClassInParents(
          focused,
          appActionButtonClasses
            .PlayButtonContainer
        ) ||
        hasClassInParents(
          focused,
          playSectionClasses
            .ControllerConfigButton
        ) ||
        hasClassInParents(
          focused,
          playSectionClasses
            .MenuButton
        ) ||
        hasClassInParents(
          focused,
          playSectionClasses
            .MenuButtonContainer
        );

      if (!isLowerAction) {
        return;
      }

      if (!badge) {
        return;
      }

      const overrideLowerTarget =
        override
          ? nearestVerticalNavElement(
              override,
              "down"
            )
          : null;

      const isOverrideLowerTarget =
        !!overrideLowerTarget &&
        (
          focused === overrideLowerTarget ||
          overrideLowerTarget.contains(focused)
        );

      if (isOverrideLowerTarget) {
        redirectFocus(override);
        return;
      }

      lastLowerFocusRef.current =
        focused;

      /*
       * Diesen einen Übergang übernehmen:
       *
       * Spielen + UP -> HDR
       *
       * Proton darf ihn nicht vorher abfangen.
       */
      event.preventDefault();
      event.stopPropagation();

      const anyEvent =
        event as any;

      anyEvent.stopImmediatePropagation
        ?.();

      takeFocus(badge);
    };


    doc.addEventListener(
      "vgp_ondirection",
      handler,
      true
    );

    return () => {
      doc.removeEventListener(
        "vgp_ondirection",
        handler,
        true
      );
    };
  }, [heroTarget]);


  if (!info) {
    return (
      <div
        ref={anchorRef}
        style={{
          display: "none",
        }}
      />
    );
  }


  let label = "No data";
  let title =
    "PCGamingWiki: HDR support unknown";
  let statusColor =
    "#7d8792";
  switch (info.hdr) {
    case "true":
      label = "HDR";
      title =
        "PCGamingWiki: HDR supported";
      statusColor =
        "#2bea68";
      break;

    case "false":
    case "n/a":
      label = "No HDR";
      title =
        "PCGamingWiki: HDR not supported";
      statusColor =
        "#ff4e5f";
      break;

    case "hackable":
      label = "Workaround";
      title =
        "PCGamingWiki: HDR available via workaround";
      statusColor =
        "#5c8fff";
      break;

    case "unknown":
    default:
      label = "No data";
      title =
        "PCGamingWiki: HDR support unknown";
      statusColor =
        "#7d8792";
      break;
  }


  const pcgwUrl = (() => {
    const page =
      String(
        info.page ?? ""
      ).trim();

    if (!page) {
      return null;
    }

    if (
      page.startsWith("https://") ||
      page.startsWith("http://")
    ) {
      return page;
    }

    return (
      "https://www.pcgamingwiki.com/wiki/" +
      encodeURIComponent(
        page.replace(/ /g, "_")
      )
    );
  })();


  const openPcgw = () => {
    if (!pcgwUrl) {
      return;
    }


    Navigation.NavigateToExternalWeb(
      pcgwUrl
    );
  };


  const badgeNode =
    heroTarget
      ? createPortal(
          <HdrNavBridge capture={heroNavCapture}>
            <div
              style={{
                position: "absolute",
                right: "0px",
                bottom: "12px",
                zIndex: 20,
                height: "46px",
                display: "flex",
                alignItems: "center",
                padding: isInstalled ? "0 64px 0 0" : "0 22px 0 0",
                borderRadius: "10px 0 0 10px",
                background: statusColor,
                boxShadow: "none",
                overflow: "visible",
              }}
            >
            <DeckyHdrButton
            id="decky-hdr-library-badge"
            type="button"

            title={
              `${title} · Data from ${info.source ?? "PCGamingWiki"}`
            }

            onClick={openPcgw}

            onMouseEnter={() =>
              setActive(true)
            }

            onMouseLeave={() =>
              setActive(false)
            }

            onFocus={() =>
              setActive(true)
            }

            onBlur={() =>
              setActive(false)
            }

            style={{
              position: "relative",

              opacity:
                visible ? 1 : 0,

              transition:
                [
                  "opacity 450ms ease-out",
                  "transform 140ms ease-out",
                  "filter 140ms ease-out",
                  "box-shadow 140ms ease-out",
                ].join(", "),

              transform: "translateX(0)",

              filter:
                active
                  ? "brightness(1.10)"
                  : "brightness(1)",

              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",

              height: "46px",
              minHeight: "46px",
              minWidth: "124px",

              width: "auto",
              padding: "0 18px 0 16px",
              gap: "0",

              borderRadius: "10px 0 0 10px",
              overflow: "visible",

              background:
                "linear-gradient(180deg, rgba(28,32,39,0.99), rgba(12,14,18,0.99))",
              color: "#ffffff",

              boxShadow:
                active
                  ? "inset 0 0 0 2px rgba(255,255,255,0.95)"
                  : "none",

              border: "none",
              borderRight:
                active || overrideFocused
                  ? "2px solid rgba(255,255,255,0.95)"
                  : "2px solid rgba(255,255,255,0.18)",
              outline: "none",

              fontFamily: "inherit",
              fontSize: "16px",
              fontWeight: 700,
              lineHeight: 1,

              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: "2px",
              }}
            >
              <span>
                {label}
              </span>

              <span
                style={{
                  fontSize: "9px",
                  fontWeight: 500,
                  letterSpacing: "0.03em",
                  opacity: 0.72,
                }}
              >
                {info.source ?? "PCGamingWiki"}
              </span>
            </span>
            </DeckyHdrButton>

            {isInstalled && (
              <DeckyHdrButton
                id="decky-hdr-force-toggle"
                type="button"
                title={
                  forceHdr
                    ? "HDR override enabled for this game"
                    : "Override automatic HDR decision"
                }
                onClick={async () => {
                  const next = !forceHdr;

                  try {
                    const settings =
                      await setHdrOverrideForApp(
                        appid,
                        next
                      );

                    runtimeHdrOverrideAppIds =
                      new Set(
                        settings.override_appids ?? []
                      );

                    setForceHdr(
                      runtimeHdrOverrideAppIds.has(
                        appid
                      )
                    );

                  showOverrideNotice(next);
                  } catch (e) {
                    console.error(
                      "Decky HDR: Force HDR update failed",
                      appid,
                      e
                    );
                  }
                }}
                onFocus={() => setOverrideFocused(true)}
                onBlur={() => setOverrideFocused(false)}
                style={{
                  position: "absolute",
                  right: "0",
                  top: "0",
                  width: "64px",
                  height: "46px",
                  padding: "0",
                  margin: "0",

                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "7px",

                  border: "none",
                  borderRadius: "0",
                  outline: "none",

                  background: "transparent",
                boxShadow:
                  overrideFocused
                    ? "inset 0 0 0 2px rgba(255,255,255,0.95)"
                    : "none",
                  color: "#ffffff",

                  fontFamily: "inherit",
                  fontSize: "12px",
                  fontWeight: 700,
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: "38px",
                    height: "20px",
                    borderRadius: "999px",
                    padding: "3px",
                    boxSizing: "border-box",

                    display: "flex",
                    alignItems: "center",
                    justifyContent:
                      forceHdr
                        ? "flex-end"
                        : "flex-start",

                    background:
                      forceHdr
                        ? "rgba(255,255,255,0.88)"
                        : "rgba(0,0,0,0.34)",

                    boxShadow:
                      "inset 0 0 0 1px rgba(255,255,255,0.20)",
                  }}
                >
                  <span
                    style={{
                      width: "14px",
                      height: "14px",
                      borderRadius: "50%",
                      background:
                        forceHdr
                          ? statusColor
                          : "rgba(255,255,255,0.72)",
                    }}
                  />
                </span>
              </DeckyHdrButton>
            )}

          {overrideNotice && (
            <div
              style={{
                position: "absolute",
                right: "8px",
                bottom: "54px",
                zIndex: 30,
                maxWidth: "360px",
                padding: "9px 12px",
                borderRadius: "7px",
                background: "rgba(15,18,23,0.96)",
                boxShadow:
                  "0 4px 18px rgba(0,0,0,0.42)",
                border:
                  "1px solid rgba(255,255,255,0.22)",
                color: "#ffffff",
                fontSize: "12px",
                fontWeight: 400,
                lineHeight: 1.35,
                pointerEvents: "none",
              }}
            >
              <div>
                {overrideNotice.first}
              </div>
              <div
                style={{
                  marginTop: "7px",
                  fontWeight: 700,
                }}
              >
                {overrideNotice.second}
              </div>
            </div>
          )}


            </div>
          </HdrNavBridge>,
          heroTarget
        )
      : null;


  return (
    <>
      <div
        ref={anchorRef}
        style={{
          display: "none",
        }}
      />

      {badgeNode}
    </>
  );
}



/* -------------------------------------------------------------------------
 * Mini HDR badges + Steam notification preload status
 * ---------------------------------------------------------------------- */

let hdrMiniBadgeObserver: MutationObserver | null = null;
let hdrMiniBadgeObservedDocument: Document | null = null;
let hdrMiniBadgeCheckInterval = 0;

let hdrMiniBadgeProcessedImages =
  new WeakSet<HTMLImageElement>();

const hdrMiniBadgeQueue: string[] = [];

const hdrMiniBadgeQueuedIds =
  new Set<string>();

const hdrMiniBadgeTargetIds =
  new Set<string>();

const hdrMiniBadgeCompletedIds =
  new Set<string>();

let hdrMiniBadgeQueueRunning = false;
let hdrMiniBadgeTargetsInitialized = false;
let hdrMiniBadgeTargetsInitializing = false;

let hdrMiniBadgeNotifyNetworkActive = false;
let hdrMiniBadgeLoadingToast: ReturnType<typeof toaster.toast> | null = null;

let hdrMiniBadgeLibrarySubscriber:
  (() => void) | null = null;


function getHdrSteamUiDocument():
  Document | null {
  try {
    const popupManager =
      (globalThis as any).g_PopupManager;

    const popups =
      Array.from(
        popupManager?.GetPopups?.() ?? []
      ) as any[];

    const steamPopup =
      popups.find(
        (popup: any) =>
          popup?.m_strName?.startsWith("SP") &&
          !popup.m_strName.includes("Keyboard")
      );

    return (
      steamPopup?.m_popup?.document ??
      document ??
      null
    );

  } catch {
    return document ?? null;
  }
}


function getHdrMiniBadgeAppId(
  src: string
): string | null {
  if (!src) {
    return null;
  }

  if (
    !/library_(?:600x900|capsule)/i.test(src)
  ) {
    return null;
  }

  const modern =
    src.match(
      /\/(?:assets|apps)\/(\d+)\//
    );

  if (modern) {
    return modern[1];
  }

  const legacy =
    src.match(
      /\/(\d+)_library_(?:600x900|capsule)/i
    );

  return legacy?.[1] ?? null;
}


function getHdrMiniBadgePresentation(
  info: HdrInfo
): {
  label: string;
  color: string;
} {
  switch (info.hdr) {
    case "true":
      return {
        label: "HDR",
        color: "#2bea68",
      };

    case "false":
    case "n/a":
      return {
        label: "NO HDR",
        color: "#ff4e5f",
      };

    case "hackable":
      return {
        label: "WORKAROUND",
        color: "#5c8fff",
      };

    case "unknown":
    default:
      return {
        label: "NO DATA",
        color: "#7d8792",
      };
  }
}


function removeHdrMiniBadge(
  parent: HTMLElement
) {
  parent
    .querySelectorAll(
      ".decky-hdr-mini-badge"
    )
    .forEach(
      (badge) => badge.remove()
    );
}


function renderHdrMiniBadge(
  img: HTMLImageElement,
  info: HdrInfo
) {
  if (!img.isConnected) {
    return;
  }

  const parent =
    img.parentElement;

  if (!parent) {
    return;
  }

  removeHdrMiniBadge(parent);

  const doc =
    parent.ownerDocument;

  const presentation =
    getHdrMiniBadgePresentation(info);

  const computed =
    doc.defaultView
      ?.getComputedStyle(parent);

  if (
    !computed ||
    computed.position === "static"
  ) {
    parent.style.position = "relative";
  }

  const badge =
    doc.createElement("div");

  badge.className =
    "decky-hdr-mini-badge";

  badge.title =
    `${presentation.label} · ${
      info.source ?? "PCGamingWiki"
    }`;

  Object.assign(
    badge.style,
    {
      position: "absolute",
      left: "6px",
      bottom: "6px",
      zIndex: "20",

      height: "22px",
      padding: "0 4px 0 0",
      borderRadius: "6px",

      display: "flex",
      alignItems: "stretch",

      background:
        presentation.color,

      boxShadow:
        "0 2px 7px rgba(0,0,0,0.42)",

      pointerEvents: "none",
      overflow: "hidden",
      boxSizing: "border-box",
    } as Partial<CSSStyleDeclaration>
  );

  const body =
    doc.createElement("div");

  Object.assign(
    body.style,
    {
      height: "22px",
      padding: "0 7px",

      display: "flex",
      alignItems: "center",
      gap: "5px",

      borderRadius: "6px 2px 2px 6px",

      background:
        "linear-gradient(180deg, rgba(28,32,39,0.99), rgba(12,14,18,0.99))",

      border:
        "1px solid rgba(255,255,255,0.16)",

      borderRight:
        "1px solid rgba(255,255,255,0.12)",

      color: "#ffffff",
      fontSize: "10px",
      fontWeight: "700",
      lineHeight: "1",
      letterSpacing: "0.02em",
      whiteSpace: "nowrap",
      boxSizing: "border-box",
    } as Partial<CSSStyleDeclaration>
  );

  const dot =
    doc.createElement("span");

  Object.assign(
    dot.style,
    {
      width: "7px",
      height: "7px",
      minWidth: "7px",
      borderRadius: "50%",
      background:
        presentation.color,
    } as Partial<CSSStyleDeclaration>
  );

  const text =
    doc.createElement("span");

  text.textContent =
    presentation.label;

  body.appendChild(dot);
  body.appendChild(text);

  badge.appendChild(body);

  parent.appendChild(badge);
}


function renderHdrMiniBadgesForApp(
  appid: string
) {
  const info =
    pcgwLaunchCache.get(appid);

  if (!info) {
    return;
  }

  const doc =
    getHdrSteamUiDocument();

  if (!doc) {
    return;
  }

  doc
    .querySelectorAll("img")
    .forEach((node) => {
      const img =
        node as HTMLImageElement;

      if (
        getHdrMiniBadgeAppId(
          img.src
        ) === appid
      ) {
        renderHdrMiniBadge(
          img,
          info
        );
      }
    });
}


async function getHdrAllSteamLibraryIds():
  Promise<string[]> {
  const appStore =
    (window as any).appStore;

  const ids =
    new Set<string>();

  const addEntries = (
    entries: any[],
    requireGameType: boolean
  ) => {
    for (const entry of entries) {
      const numericId =
        Number(
          entry?.appid ??
          entry
        );

      if (
        !Number.isInteger(numericId) ||
        numericId <= 0
      ) {
        continue;
      }

      if (requireGameType) {
        const appType =
          entry?.app_type;

        if (
          appType !== undefined &&
          appType !== 1
        ) {
          continue;
        }
      }

      ids.add(
        String(numericId)
      );
    }
  };

  /*
   * Primary source: Steam's full owned-app list.
   * This does not depend on which library tabs
   * have already been rendered.
   */
  try {
    const steamClient =
      (window as any).SteamClient;

    if (
      typeof steamClient
        ?.Apps
        ?.GetAllApps === "function"
    ) {
      const apps =
        await steamClient.Apps.GetAllApps();

      if (
        Array.isArray(apps) &&
        apps.length > 0
      ) {
        for (const entry of apps) {
          const numericId =
            Number(
              entry?.appid ??
              entry
            );

          if (
            !Number.isInteger(numericId) ||
            numericId <= 0
          ) {
            continue;
          }

          let overview: any = null;

          try {
            overview =
              appStore
                ?.GetAppOverviewByAppID
                ?.(numericId) ??
              null;
          } catch {}

          if (
            overview?.app_type !== undefined &&
            overview.app_type !== 1
          ) {
            continue;
          }

          ids.add(
            String(numericId)
          );
        }

        if (ids.size > 0) {
          console.log(
            "Decky HDR: full Steam library via GetAllApps",
            ids.size
          );

          return Array.from(ids);
        }
      }
    }
  } catch (e) {
    console.warn(
      "Decky HDR: GetAllApps failed",
      e
    );
  }

  /*
   * Fallbacks for Steam UI variants.
   */
  const collectionStore =
    (window as any).collectionStore;

  for (const entries of [
    collectionStore
      ?.allGamesCollection
      ?.allApps,
    collectionStore
      ?.allAppsCollection
      ?.allApps,
    appStore?.allApps,
  ]) {
    if (
      !Array.isArray(entries) ||
      entries.length === 0
    ) {
      continue;
    }

    ids.clear();

    addEntries(
      entries,
      true
    );

    if (ids.size > 0) {
      return Array.from(ids);
    }
  }

  return [];
}


function dismissHdrMiniBadgeLoadingToast() {
  if (!hdrMiniBadgeLoadingToast) {
    return;
  }

  try {
    hdrMiniBadgeLoadingToast.dismiss();
  } catch (e) {
    console.warn(
      "Decky HDR: could not dismiss loading toast",
      e
    );
  }

  hdrMiniBadgeLoadingToast = null;
}

let hdrMiniBadgeNotifyStartShown = false;
let hdrMiniBadgeGamepadUiActive = true;
let hdrMiniBadgeUiModeRegistration: { unregister: () => void } | null = null;

function startHdrMiniBadgeUiModeTracking() {
  void SteamClient.UI.GetUIMode()
    .then((mode) => {
      hdrMiniBadgeGamepadUiActive =
        mode === 4;
    })
    .catch((e) => {
      console.warn(
        "Decky HDR: could not read Steam UI mode",
        e
      );
    });

  hdrMiniBadgeUiModeRegistration =
    SteamClient.UI.RegisterForUIModeChanged(
      (mode) => {
        hdrMiniBadgeGamepadUiActive =
          mode === 4;
      }
    );
}

function showHdrMiniBadgeLoadingToast(
  total: number
) {
  if (
    !hdrMiniBadgeGamepadUiActive ||
    hdrMiniBadgeNotifyStartShown
  ) {
    return;
  }

  hdrMiniBadgeNotifyStartShown = true;

  toaster.toast({
    title: "HDR Auto Pilot",
    body:
      total === 1
        ? "Loading HDR data for 1 game"
        : `Loading HDR data for ${total} games`,
    playSound: false,
    showToast: true,
    duration: 5000,
  });
}

function updateHdrMiniBadgeProgress() {
  const total =
    hdrMiniBadgeTargetIds.size;

  if (
    total === 0 ||
    !hdrMiniBadgeNotifyNetworkActive
  ) {
    return;
  }


  /*
   * The worker state is the authoritative end-of-run signal.
   * All target AppIDs were queued before processing starts.
   */
  const finished =
    hdrMiniBadgeQueue.length === 0 &&
    !hdrMiniBadgeQueueRunning;

  if (!finished) {
    showHdrMiniBadgeLoadingToast(
      total
    );
    return;
  }

  if (hdrMiniBadgeGamepadUiActive) {
    toaster.toast({
      title: "HDR Auto Pilot",
      body:
        total === 1
          ? "HDR data loaded for 1 game"
          : `HDR data loaded for ${total} games`,
      playSound: false,
      showToast: true,
      duration: 4500,
    });
  }

  hdrMiniBadgeNotifyNetworkActive =
    false;

  hdrMiniBadgeNotifyStartShown = false;
}

function queueHdrMiniBadgeApp(
  appid: string
) {
  if (
    !appid ||
    hdrMiniBadgeCompletedIds.has(
      appid
    ) ||
    hdrMiniBadgeQueuedIds.has(
      appid
    )
  ) {
    return;
  }

  if (
    pcgwLaunchCache.has(appid)
  ) {
    hdrMiniBadgeCompletedIds.add(
      appid
    );

    renderHdrMiniBadgesForApp(
      appid
    );

    updateHdrMiniBadgeProgress();
    return;
  }

  hdrMiniBadgeQueuedIds.add(
    appid
  );

  hdrMiniBadgeQueue.push(
    appid
  );

  void runHdrMiniBadgeQueue();
}


async function initializeHdrMiniBadgeTargets() {
  if (
    hdrMiniBadgeTargetsInitialized ||
    hdrMiniBadgeTargetsInitializing
  ) {
    return;
  }

  hdrMiniBadgeTargetsInitializing =
    true;

  try {
    let ids: string[] = [];

    /*
     * Steam can still be initializing during plugin
     * startup. Retry a few times rather than locking
     * in a partial appStore snapshot.
     */
    for (
      let attempt = 0;
      attempt < 8;
      attempt += 1
    ) {
      ids =
        await getHdrAllSteamLibraryIds();

      if (ids.length > 0) {
        break;
      }

      await sleepPcgwWarmup(
        500
      );
    }

    if (ids.length === 0) {
      return;
    }

    hdrMiniBadgeTargetIds.clear();

    for (const appid of ids) {
      hdrMiniBadgeTargetIds.add(
        appid
      );
    }

    hdrMiniBadgeNotifyNetworkActive =
      false;

    hdrMiniBadgeTargetsInitialized =
      true;

    console.log(
      "Decky HDR: mini badge target library",
      hdrMiniBadgeTargetIds.size
    );

    for (const appid of ids) {
      queueHdrMiniBadgeApp(
        appid
      );
    }

    updateHdrMiniBadgeProgress();

  } finally {
    hdrMiniBadgeTargetsInitializing =
      false;
  }
}


async function runHdrMiniBadgeQueue() {
  if (hdrMiniBadgeQueueRunning) {
    return;
  }

  hdrMiniBadgeQueueRunning = true;

  try {
    while (
      hdrMiniBadgeQueue.length > 0
    ) {
      const appid =
        hdrMiniBadgeQueue.shift();

      if (!appid) {
        continue;
      }

      let networkFetch = false;

      try {
        let info =
          pcgwLaunchCache.get(appid);

        if (!info) {
          info =
            await getHdrInfo(appid);


          networkFetch =
            !info.cached;

          if (
            networkFetch &&
            !hdrMiniBadgeNotifyNetworkActive
          ) {
            hdrMiniBadgeNotifyNetworkActive = true;
            showHdrMiniBadgeLoadingToast(
              hdrMiniBadgeTargetIds.size
            );
          }

          pcgwLaunchCache.set(
            appid,
            info
          );

          notifyPcgwWarmupSubscribers();
        }

        hdrMiniBadgeCompletedIds.add(
          appid
        );

        renderHdrMiniBadgesForApp(
          appid
        );

      } catch (e) {
        console.warn(
          "Decky HDR: mini badge lookup failed",
          appid,
          e
        );

        hdrMiniBadgeCompletedIds.add(
          appid
        );

      } finally {
        hdrMiniBadgeQueuedIds.delete(
          appid
        );

        updateHdrMiniBadgeProgress();
      }

      if (
        networkFetch &&
        hdrMiniBadgeQueue.length > 0
      ) {
        await sleepPcgwWarmup(
          2200
        );
      }
    }

  } finally {
    hdrMiniBadgeQueueRunning = false;

    if (
      hdrMiniBadgeQueue.length > 0
    ) {
      void runHdrMiniBadgeQueue();
    } else {
      updateHdrMiniBadgeProgress();
    }
  }
}


function processHdrMiniBadgeImage(
  img: HTMLImageElement
) {
  if (
    hdrMiniBadgeProcessedImages.has(
      img
    )
  ) {
    return;
  }

  hdrMiniBadgeProcessedImages.add(
    img
  );

  const appid =
    getHdrMiniBadgeAppId(
      img.src
    );

  if (!appid) {
    return;
  }

  const cached =
    pcgwLaunchCache.get(appid);

  if (cached) {
    renderHdrMiniBadge(
      img,
      cached
    );

    return;
  }

  /*
   * Do not expand the progress denominator from
   * DOM discovery. The owned-library target list
   * is established separately and remains stable.
   */
  if (
    hdrMiniBadgeTargetIds.has(appid)
  ) {
    queueHdrMiniBadgeApp(
      appid
    );
  }
}


function scanHdrMiniBadgeImages(
  doc: Document | null =
    getHdrSteamUiDocument()
) {
  if (!doc) {
    return;
  }

  doc
    .querySelectorAll("img")
    .forEach(
      (node) =>
        processHdrMiniBadgeImage(
          node as HTMLImageElement
        )
    );
}


function handleHdrMiniBadgeMutations(
  mutations: MutationRecord[]
) {
  for (
    const mutation of mutations
  ) {
    if (
      mutation.type ===
      "childList"
    ) {
      for (
        const node of
        mutation.addedNodes
      ) {
        /*
         * Realm-safe checks. Steam may create the
         * library DOM in another popup window.
         */
        if (
          node.nodeType !== 1
        ) {
          continue;
        }

        const element =
          node as HTMLElement;

        if (
          element.tagName === "IMG"
        ) {
          processHdrMiniBadgeImage(
            element as
              HTMLImageElement
          );

        } else {
          element
            .querySelectorAll("img")
            .forEach(
              (img) =>
                processHdrMiniBadgeImage(
                  img as
                    HTMLImageElement
                )
            );
        }
      }

    } else if (
      mutation.type ===
        "attributes" &&
      mutation.attributeName ===
        "src"
    ) {
      const target =
        mutation.target as
          HTMLElement;

      if (
        target?.nodeType === 1 &&
        target.tagName === "IMG"
      ) {
        const img =
          target as
            HTMLImageElement;

        hdrMiniBadgeProcessedImages
          .delete(img);

        processHdrMiniBadgeImage(
          img
        );
      }
    }
  }

  updateHdrMiniBadgeProgress();
}


function attachHdrMiniBadgeObserver(
  force = false
) {
  const doc =
    getHdrSteamUiDocument();

  if (!doc?.body) {
    return;
  }

  if (
    !force &&
    hdrMiniBadgeObservedDocument === doc &&
    hdrMiniBadgeObserver
  ) {
    /*
     * Cheap safety scan for Steam React remounts.
     * Cached badges are restored immediately.
     */
    scanHdrMiniBadgeImages(doc);
    updateHdrMiniBadgeProgress();
    return;
  }

  hdrMiniBadgeObserver
    ?.disconnect();

  hdrMiniBadgeObservedDocument =
    doc;

  hdrMiniBadgeProcessedImages =
    new WeakSet<HTMLImageElement>();

  const Observer =
    doc.defaultView
      ?.MutationObserver ??
    MutationObserver;

  hdrMiniBadgeObserver =
    new Observer(
      handleHdrMiniBadgeMutations
    );

  scanHdrMiniBadgeImages(doc);
  updateHdrMiniBadgeProgress();

  hdrMiniBadgeObserver.observe(
    doc.body,
    {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    }
  );
}


function refreshHdrMiniBadges() {
  /*
   * Keep existing badges in place. Removing them
   * before every refresh caused visible flashing
   * when returning from a game details page.
   */
  hdrMiniBadgeProcessedImages =
    new WeakSet<HTMLImageElement>();

  scanHdrMiniBadgeImages();
  updateHdrMiniBadgeProgress();
}


function startHdrMiniBadgeRuntime() {
  void initializeHdrMiniBadgeTargets();

  attachHdrMiniBadgeObserver(
    true
  );

  hdrMiniBadgeCheckInterval =
    window.setInterval(
      () => {
        attachHdrMiniBadgeObserver();

        /*
         * If Steam was not ready at plugin startup,
         * retry target discovery until it succeeds.
         */
        if (
          !hdrMiniBadgeTargetsInitialized
        ) {
          void initializeHdrMiniBadgeTargets();
        }
      },
      500
    );

  hdrMiniBadgeLibrarySubscriber =
    () => {
      refreshHdrMiniBadges();
    };

  installedLibrarySubscribers.add(
    hdrMiniBadgeLibrarySubscriber
  );

  console.log(
    "Decky HDR: mini library badges ready"
  );
}


function stopHdrMiniBadgeRuntime() {
  hdrMiniBadgeObserver
    ?.disconnect();

  hdrMiniBadgeObserver = null;
  hdrMiniBadgeObservedDocument = null;

  if (
    hdrMiniBadgeCheckInterval
  ) {
    window.clearInterval(
      hdrMiniBadgeCheckInterval
    );

    hdrMiniBadgeCheckInterval = 0;
  }


if (
    hdrMiniBadgeLibrarySubscriber
  ) {
    installedLibrarySubscribers.delete(
      hdrMiniBadgeLibrarySubscriber
    );

    hdrMiniBadgeLibrarySubscriber =
      null;
  }

  hdrMiniBadgeQueue.length = 0;
  hdrMiniBadgeQueuedIds.clear();
  hdrMiniBadgeTargetIds.clear();
  hdrMiniBadgeCompletedIds.clear();

  hdrMiniBadgeTargetsInitialized =
    false;

  hdrMiniBadgeTargetsInitializing =
    false;

  dismissHdrMiniBadgeLoadingToast();

  hdrMiniBadgeNotifyNetworkActive =
    false;

  const doc =
    getHdrSteamUiDocument();

  doc
    ?.querySelectorAll(
      ".decky-hdr-mini-badge"
    )
    .forEach(
      (badge) => badge.remove()
    );

  console.log(
    "Decky HDR: mini library badges stopped"
  );
}


const HDR_LIBRARY_ROUTE =
  "/library/app/:appid";

let hdrLibraryPatch: any = null;


function startHdrLibraryBadgePatch() {
  if (hdrLibraryPatch) {
    return;
  }

  hdrLibraryPatch =
    routerHook.addPatch(
      HDR_LIBRARY_ROUTE,
      (tree: any) => {
        const routeProps =
          findInReactTree(
            tree,
            (x: any) =>
              x?.renderFunc
          );

        if (!routeProps) {
          return tree;
        }

        const patchHandler =
          createReactTreePatcher(
            [
              (renderTree: any) =>
                findInReactTree(
                  renderTree,
                  (x: any) =>
                    x?.props
                      ?.children
                      ?.props
                      ?.overview
                )?.props?.children,
            ],
            (
              _args:
                Array<
                  Record<string, unknown>
                >,
              ret?: ReactElement
            ) => {
              const container =
                findInReactTree(
                  ret,
                  (x: any) =>
                    Array.isArray(
                      x?.props?.children
                    ) &&
                    typeof x?.props
                      ?.className ===
                      "string" &&
                    x.props.className.includes(
                      appDetailsClasses
                        .InnerContainer
                    )
                );

              if (
                !container ||
                !Array.isArray(
                  container.props?.children
                )
              ) {
                return ret;
              }

              const overview =
                findInReactTree(
                  ret,
                  (x: any) =>
                    x?.props
                      ?.overview
                      ?.appid
                )?.props?.overview;

              const routeAppId =
                String(
                  window.location.pathname
                    .match(/^\/library\/app\/(\d+)/)?.[1] ?? ""
                );

              const appid =
                overview?.appid
                  ? String(overview.appid)
                  : routeAppId;

              if (!appid) {
                console.warn(
                  "Decky HDR: library AppID unavailable",
                  window.location.pathname
                );
                return ret;
              }

              const children =
                container.props.children;

              /*
               * HdrLibraryBadge itself has no DOM id.
               * The old check therefore never detected
               * the component that we inserted.
               */
              const badgeIndex =
                children.findIndex(
                  (child: any) =>
                    child?.type ===
                    HdrLibraryBadge
                );

              const badge =
                <HdrLibraryBadge
                  key={`decky-hdr-${appid}`}
                  appid={appid}
                />;

              if (badgeIndex === -1) {
                children.splice(
                  1,
                  0,
                  badge
                );

              } else if (
                String(
                  children[
                    badgeIndex
                  ]?.props?.appid ?? ""
                ) !== appid
              ) {
                /*
                 * Steam may reuse the same library route
                 * while switching from one game to another.
                 * Replace the old badge so React gets the
                 * new AppID and key.
                 */
                children[
                  badgeIndex
                ] = badge;
              }

              return ret;
            }
          );

        afterPatch(
          routeProps,
          "renderFunc",
          patchHandler
        );

        return tree;
      }
    );

  console.log(
    "Decky HDR: library badge patch ready"
  );
}


function stopHdrLibraryBadgePatch() {
  if (!hdrLibraryPatch) {
    return;
  }

  try {
    routerHook.removePatch(
      HDR_LIBRARY_ROUTE,
      hdrLibraryPatch
    );
  } catch (e) {
    console.warn(
      "Decky HDR: badge patch cleanup failed",
      e
    );
  }

  hdrLibraryPatch = null;
}


function Content() {
  const [advancedOpen, setAdvancedOpen] =
    useState(false);

  const [
    settings,
    setSettings,
  ] = useState<PluginSettings>({
    auto_hdr_enabled: false,
    restore_previous_hdr_state: true,
    override_appids: [],
  });

  const [
    settingsLoaded,
    setSettingsLoaded,
  ] = useState(false);

      useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const saved = await getSettings();

        if (active) {
          setSettings(saved);
          setSettingsLoaded(true);
        }

      } catch (e) {
        console.error(
          "Could not load Decky HDR settings:",
          e
        );

        if (active) {
          setSettingsLoaded(true);
        }
      }
    };

    load();

    return () => {
      active = false;
    };
  }, []);


  const changeAutoHdr =
    async (enabled: boolean) => {
      const previous =
        settings.auto_hdr_enabled;

      setSettings((current) => ({
        ...current,
        auto_hdr_enabled: enabled,
      }));

      try {
        const saved =
          await setAutoHdrEnabled(
            enabled
          );

        setSettings(saved);

        toaster.toast({
          title: "HDR Auto Pilot",
          body: enabled
            ? "Automatic HDR switching enabled"
            : "Automatic HDR switching disabled",
        });

      } catch (e) {
        console.error(
          "Could not save Auto HDR setting:",
          e
        );

        setSettings((current) => ({
          ...current,
          auto_hdr_enabled: previous,
        }));

        toaster.toast({
          title: "HDR Auto Pilot",
          body: "Could not save setting",
        });
      }
    };


  const changeRestorePrevious =
    async (enabled: boolean) => {
      const previous =
        settings.restore_previous_hdr_state;

      setSettings((current) => ({
        ...current,
        restore_previous_hdr_state: enabled,
      }));

      try {
        const saved =
          await setRestorePreviousHdrState(
            enabled
          );

        setSettings(saved);

      } catch (e) {
        console.error(
          "Could not save restore setting:",
          e
        );

        setSettings((current) => ({
          ...current,
          restore_previous_hdr_state:
            previous,
        }));

        toaster.toast({
          title: "HDR Auto Pilot",
          body: "Could not save setting",
        });
      }
    };




    return (
    <>



      
      <PanelSection title="Auto HDR">
<PanelSectionRow>
          <SettingsToggle
            title="Automatic HDR switching"
            description={
              "Allow Decky HDR to automatically " +
              "change Gamescope HDR for games."
            }
            value={settings.auto_hdr_enabled}
            disabled={!settingsLoaded}
            onChange={changeAutoHdr}
          />
        </PanelSectionRow>

        <PanelSectionRow>
          <SettingsToggle
            title="Restore previous HDR state"
            description={
              "After a game exits, restore the HDR " +
              "state that was active before launch."
            }
            value={
              settings.restore_previous_hdr_state
            }
            disabled={!settingsLoaded}
            onChange={changeRestorePrevious}
          />
        </PanelSectionRow>

        <PanelSectionRow>
          <div
            style={{
              opacity: 0.72,
              fontSize: "0.85em",
              lineHeight: "1.4",
              padding: "4px 0 8px 0",
            }}
          >
            <b>Unknown or missing HDR data is treated as SDR.</b>
            {" "}
            This avoids enabling HDR for games that may not
            support it, which can cause washed-out or
            incorrect colors.
          </div>
        </PanelSectionRow>
      </PanelSection>


      <PanelSection title="Advanced">
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() =>
              setAdvancedOpen(!advancedOpen)
            }
          >
            {advancedOpen
              ? "Hide advanced settings"
              : "Show advanced settings"}
          </ButtonItem>
        </PanelSectionRow>

        {advancedOpen && (
          <>
            <PanelSectionRow>
              <AdvancedHdrCacheSummary />
            </PanelSectionRow>

            <PanelSectionRow>
              <SteamInstalledLibraryScanner />
            </PanelSectionRow>

            <PanelSectionRow>
              <PcgwLibraryWarmupStatus />
            </PanelSectionRow>

            <PanelSectionRow>
              <ButtonItem
                layout="below"
                onClick={async () => {
                  await clearCache();

                  toaster.toast({
                    title: "HDR Auto Pilot",
                    body: "HDR cache cleared",
                  });
                }}
              >
                Clear local cache
              </ButtonItem>
            </PanelSectionRow>
          </>
        )}
      </PanelSection>

    </>
  );
}


export default definePlugin(() => {
  console.log(
    "Decky HDR initializing"
  );

  /*
   * Register once when Decky loads the plugin.
   * This survives opening/closing the plugin UI.
   */
  startSteamLaunchRuntime();
  startInstalledLibraryRuntime();
  startHdrLibraryBadgePatch();
  startHdrMiniBadgeUiModeTracking();
  startHdrMiniBadgeRuntime();
  void refreshRuntimeHdrSettings();

  return {
    name: "HDR Auto Pilot",

    titleView: (
      <div
        className={
          staticClasses.Title
        }
      >
        HDR Auto Pilot
      </div>
    ),

    content: <Content />,

    icon: <FaTv />,

    onDismount() {
      hdrMiniBadgeUiModeRegistration?.unregister();
      hdrMiniBadgeUiModeRegistration = null;
      stopHdrMiniBadgeRuntime();
      stopHdrLibraryBadgePatch();
      stopInstalledLibraryRuntime();
      stopSteamLaunchRuntime();

      console.log(
        "Decky HDR unloading"
      );
    },
  };
});
