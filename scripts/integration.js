import { MODULE_ID, MODULE_TITLE, SETTINGS, onOffServicesForEntity } from "./constants.js";

/**
 * Integration-level features:
 *  - GM Toggle Control: a Scene Controls button to pause/resume HAmbience.
 *  - Game Status Sync: flip an HA entity when a session starts/ends.
 *
 * (Critical-roll automation lives in the trigger engine as a preset trigger,
 * see presets.js, not here.)
 *
 * All firing is GM-only and respects the pause toggle.
 */

function api() { return game.modules.get(MODULE_ID)?.api; }

/* ====================================================================== */
/*  GM Toggle Control (Scene Controls button)                             */
/* ====================================================================== */

export function initIntegrationControls() {
  Hooks.on("getSceneControlButtons", onGetSceneControls);
  // Re-render the controls when the pause state changes so the icon updates.
  Hooks.on("hambience.pauseChanged", () => ui.controls?.render(true));
}

function onGetSceneControls(controls) {
  if (!game.user?.isGM) return;
  const paused = !!game.settings.get(MODULE_ID, SETTINGS.PAUSED);

  const tool = {
    name: "hambience-toggle",
    title: paused ? `${MODULE_TITLE}: paused (click to resume)` : `${MODULE_TITLE}: active (click to pause)`,
    icon: "fas fa-tower-broadcast",
    toggle: true,
    active: !paused,
    visible: true,
    onClick: (active) => api()?.setPaused(!active),
    onChange: (_event, active) => api()?.setPaused(!active),
    button: true
  };

  // v13+ scene controls are a record keyed by control name; older builds use an
  // array of control groups. Handle both so the button lands either way.
  if (Array.isArray(controls)) {
    const tokens = controls.find(c => c.name === "token") ?? controls[0];
    if (tokens?.tools) {
      if (Array.isArray(tokens.tools)) tokens.tools.push(tool);
      else tokens.tools[tool.name] = tool;
    }
  } else if (controls && typeof controls === "object") {
    const tokens = controls.tokens ?? controls.token ?? Object.values(controls)[0];
    if (tokens?.tools) tokens.tools[tool.name] = tool;
  }
}

/* ====================================================================== */
/*  Game Status Sync                                                      */
/* ====================================================================== */

export function initSessionSync() {
  if (!game.user?.isGM) return;
  const a = api();
  if (!a) return;

  if (game.settings.get(MODULE_ID, SETTINGS.SESSION_SYNC_ENABLED) && !a.paused) {
    const entity = game.settings.get(MODULE_ID, SETTINGS.SESSION_ENTITY);
    if (entity) {
      const { on } = onOffServicesForEntity(entity);
      a.fireService(on, entity);
    }
  }

  // Best-effort "session ended" on unload. fetch() during unload is unreliable,
  // so use sendBeacon, which is designed exactly for this.
  window.addEventListener("beforeunload", () => {
    try {
      if (!game.user?.isGM) return;
      if (!game.settings.get(MODULE_ID, SETTINGS.SESSION_SYNC_ENABLED)) return;
      if (game.settings.get(MODULE_ID, SETTINGS.PAUSED)) return;
      const entity = game.settings.get(MODULE_ID, SETTINGS.SESSION_ENTITY);
      const url = game.settings.get(MODULE_ID, SETTINGS.WEBHOOK_URL);
      if (!entity || !url) return;
      const { off } = onOffServicesForEntity(entity);
      const body = JSON.stringify({ service: off, entity });
      navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }));
    } catch (_e) { /* nothing we can do during unload */ }
  });
}
