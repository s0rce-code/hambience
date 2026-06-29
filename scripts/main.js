import {
  MODULE_ID, SETTINGS, CONNECTION_MODE, FILTER_MODE, defaultServiceForEntity
} from "./constants.js";
import { HAClient } from "./ha-client.js";
import { F2HAConfig, F2HASupport } from "./config.js";
import { F2HATriggersConfig } from "./triggers.js";
import { F2HAMacroLibrary } from "./macros.js";
import { initAmbience } from "./ambience.js";
import { initIntegrationControls, initSessionSync } from "./integration.js";
import { getPresetTrigger } from "./presets.js";

/**
 * HAmbience
 * ------------------------------------------------------------------
 * GM-only Home Assistant bridge for Foundry VTT.
 *
 * Dispatch: each trigger POSTs its own JSON payload to a single shared webhook
 * URL, and HA branches on the payload. An optional read-only token enables
 * entity/label discovery for the pickers and the IRL Ambience scene tab.
 */
export const F2HA = {
  ID: MODULE_ID,
  HA: HAClient,

  /** @type {Array<{hook: string, id: number}>} */
  _registered: [],
  /** @type {Map<string, Function>} */
  _debouncers: new Map(),

  log(...args) { console.log(`${this.ID} |`, ...args); },

  get webhookUrl() { return game.settings.get(this.ID, SETTINGS.WEBHOOK_URL); },
  get triggers() { return game.settings.get(this.ID, SETTINGS.TRIGGERS) ?? []; },
  get connectionMode() { return game.settings.get(this.ID, SETTINGS.CONNECTION_MODE) || CONNECTION_MODE.WEBHOOK; },
  get isHybrid() { return this.connectionMode === CONNECTION_MODE.HYBRID; },

  /** When paused (via the GM toggle), automatic dispatch is suppressed. */
  get paused() { return !!game.settings.get(this.ID, SETTINGS.PAUSED); },
  async setPaused(value) {
    await game.settings.set(this.ID, SETTINGS.PAUSED, !!value);
    Hooks.callAll("hambience.pauseChanged", !!value);
  },

  /* ----------------------------- hook lifecycle ----------------------------- */

  unregisterTriggers() {
    for (const { hook, id } of this._registered) Hooks.off(hook, id);
    this._registered = [];
    this._debouncers.clear();
  },

  registerTriggers() {
    this.unregisterTriggers();
    if (!game.user?.isGM) {
      this.log("Not GM - skipping trigger registration on this client.");
      return;
    }
    const triggers = this.triggers;
    if (!triggers.length) { this.log("No triggers configured."); return; }

    for (const trigger of triggers) {
      if (trigger.enabled === false) continue;

      // A preset trigger supplies its own hook plus a matcher; a plain trigger
      // just uses its configured hook with no matcher.
      let hook = trigger.hook;
      let matcher = null;
      if (trigger.preset) {
        const preset = getPresetTrigger(trigger.preset);
        if (!preset) { this.log(`Unknown preset "${trigger.preset}" - skipping.`); continue; }
        hook = preset.hook;
        const cfg = trigger.presetConfig ?? preset.defaultConfig ?? {};
        matcher = (args) => { try { return preset.match(args, cfg); } catch (e) { console.error(e); return false; } };
      }
      if (!hook) continue;

      const handler = this._buildHandler(trigger, matcher);
      const id = Hooks.on(hook, handler);
      this._registered.push({ hook, id });
      this.log(`Registered ${trigger.preset ? `preset "${trigger.preset}"` : "trigger"} on "${hook}"${trigger.debounce ? ` (debounce ${trigger.debounce}ms)` : ""}.`);
    }
  },

  _buildHandler(trigger, matcher = null) {
    const fire = (...hookArgs) => {
      if (!game.user?.isGM) return; // re-check at fire time
      if (this.paused) return;      // GM toggle suppresses automatic dispatch
      if (matcher && !matcher(hookArgs)) return; // preset condition not met
      this.dispatch(trigger, hookArgs);
    };
    const ms = Number(trigger.debounce) || 0;
    if (ms > 0) {
      const key = `${trigger.preset ?? trigger.hook}::${trigger.name ?? ""}`;
      let debounced = this._debouncers.get(key);
      if (!debounced) {
        debounced = foundry.utils.debounce(fire, ms);
        this._debouncers.set(key, debounced);
      }
      return debounced;
    }
    return fire;
  },

  /* ------------------------------- dispatch -------------------------------- */

  async dispatch(trigger, hookArgs = []) {
    const url = this.webhookUrl;
    if (!url) {
      console.warn(`${this.ID} | Webhook URL not set; skipping "${trigger.hook}".`);
      return;
    }
    const body = (trigger.payload && trigger.payload.trim()) ? trigger.payload : "{}";
    this.log(`Dispatching for "${trigger.hook}".`);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.error(`${this.ID} | Webhook failed for "${trigger.hook}". ${response.status} ${response.statusText} ${text}`);
        ui.notifications?.error(`HAmbience: webhook failed for "${trigger.hook}" (${response.status}).`);
      }
    } catch (err) {
      console.error(`${this.ID} | Error dispatching "${trigger.hook}":`, err);
      ui.notifications?.error(`HAmbience: error dispatching "${trigger.hook}".`);
    }

    if (trigger.macroId) {
      const macro = game.macros.get(trigger.macroId);
      if (macro) {
        // Expose the hook's arguments to the macro. We set a well-known global
        // (and also pass via execute scope where supported) so macro authors
        // can read what fired the trigger, e.g. the MIDI workflow object for
        // a Nat 1 / Nat 20 reaction.
        globalThis.hambienceHookArgs = hookArgs;
        globalThis.hambienceHook = trigger.hook;
        try {
          macro.execute({ hambienceHookArgs: hookArgs, hambienceHook: trigger.hook });
        } catch (err) {
          console.error(`${this.ID} | Macro ${trigger.macroId} threw:`, err);
        } finally {
          // Clear after a tick so async macros that read it synchronously at
          // the top still see it, without leaking indefinitely.
          const args = hookArgs;
          Promise.resolve().then(() => {
            if (globalThis.hambienceHookArgs === args) {
              delete globalThis.hambienceHookArgs;
              delete globalThis.hambienceHook;
            }
          });
        }
      } else {
        console.warn(`${this.ID} | Macro ${trigger.macroId} not found.`);
      }
    }
  },

  /**
   * Fire an explicit payload immediately (Test buttons, generated macros).
   * @param {string} payload raw JSON string
   * @returns {Promise<boolean>}
   */
  async testDispatch(payload) {
    if (!game.user?.isGM) return false;
    const url = this.webhookUrl;
    if (!url) { ui.notifications?.error("HAmbience: Webhook URL is not set."); return false; }
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: (payload && payload.trim()) ? payload : "{}"
      });
      if (response.ok) { ui.notifications?.info("HAmbience: webhook sent successfully."); return true; }
      const text = await response.text().catch(() => "");
      console.error(`${this.ID} | Test webhook failed. ${response.status} ${response.statusText} ${text}`);
      ui.notifications?.error(`HAmbience: webhook failed (${response.status}).`);
      return false;
    } catch (err) {
      console.error(`${this.ID} | Test webhook error:`, err);
      ui.notifications?.error("HAmbience: webhook error (see console).");
      return false;
    }
  },

  /* ============================ PUBLIC API ============================ *
   * Stable surface for other modules. Example:
   *   const ha = game.modules.get("hambience")?.api;
   *   ha?.fireEntity("script.d_and_d_battle_start");
   *   ha?.fireService("light.turn_on", "light.table", { brightness: 200 });
   *   ha?.fire({ service: "scene.turn_on", entity: "scene.boss" });
   * Or, without grabbing the object, via a hook:
   *   Hooks.callAll("hambience.fire", { service: "script.turn_on", entity: "script.x" });
   *
   * All public calls are GM-gated (only the GM client dispatches) to preserve
   * the no-duplicate-calls guarantee, exactly like triggers.
   * ------------------------------------------------------------------ */

  /**
   * Fire a raw payload to the configured webhook.
   * @param {{service?: string, entity?: string, data?: object}|object} payload
   * @returns {Promise<boolean>} success
   */
  async fire(payload = {}) {
    const { data, ...rest } = payload ?? {};
    const merged = { ...rest, ...(data && typeof data === "object" ? data : {}) };
    return this.testDispatch(JSON.stringify(merged));
  },

  /**
   * Fire a service call against an entity. Service is required.
   * @param {string} service e.g. "light.turn_on"
   * @param {string} entity  e.g. "light.table"
   * @param {object} [data]  extra fields merged into the payload
   * @returns {Promise<boolean>}
   */
  async fireService(service, entity, data) {
    if (!service) { console.warn(`${this.ID} | fireService: service required.`); return false; }
    return this.fire({ service, entity, data });
  },

  /**
   * Fire an entity using the best default service for its domain
   * (script.turn_on, automation.trigger, scene.turn_on, ...).
   * @param {string} entity e.g. "script.d_and_d_battle_start"
   * @param {object} [data] extra fields merged into the payload
   * @returns {Promise<boolean>}
   */
  async fireEntity(entity, data) {
    if (!entity) { console.warn(`${this.ID} | fireEntity: entity required.`); return false; }
    return this.fire({ service: defaultServiceForEntity(entity), entity, data });
  },

  /** Whether HAmbience is configured to dispatch (has a webhook URL). */
  get isReady() {
    return !!this.webhookUrl;
  }
};

/* ============================== settings ================================= */

Hooks.once("init", () => {
  F2HA.log("Initializing.");

  if (!Handlebars.helpers.eq) Handlebars.registerHelper("eq", (a, b) => a === b);

  // --- Menus (sections on the module settings page) ---
  game.settings.registerMenu(MODULE_ID, "configMenu", {
    name: "Connection Settings",
    label: "Connection",
    hint: "Webhook URL, connection mode, and optional Home Assistant entity discovery.",
    icon: "fas fa-plug",
    type: F2HAConfig,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "triggersMenu", {
    name: "Manage Triggers",
    label: "Triggers",
    hint: "Add, edit, enable/disable, and delete the Foundry to Home Assistant triggers.",
    icon: "fas fa-bolt",
    type: F2HATriggersConfig,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "macrosMenu", {
    name: "Macro Library",
    label: "Macros",
    hint: "Create standalone hotbar macros that fire Home Assistant from a button.",
    icon: "fas fa-wand-magic-sparkles",
    type: F2HAMacroLibrary,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "supportMenu", {
    name: "Support HAmbience",
    label: "Buy me a coffee",
    hint: "If HAmbience adds something to your table, a coffee helps me keep building.",
    icon: "fas fa-mug-hot",
    type: F2HASupport,
    restricted: true
  });

  // --- Preserved data settings ---
  game.settings.register(MODULE_ID, SETTINGS.WEBHOOK_URL, {
    scope: "world", config: false, type: String, default: ""
  });
  game.settings.register(MODULE_ID, SETTINGS.TRIGGERS, {
    scope: "world", config: false, type: Array, default: [],
    onChange: () => F2HA.registerTriggers()
  });
  game.settings.register(MODULE_ID, SETTINGS.WEBHOOK_TOUCH, {
    scope: "world", config: false, type: Boolean, default: false
  });

  // --- New v3 settings ---
  game.settings.register(MODULE_ID, SETTINGS.CONNECTION_MODE, {
    scope: "world", config: false, type: String, default: CONNECTION_MODE.WEBHOOK
  });
  game.settings.register(MODULE_ID, SETTINGS.HA_URL, {
    scope: "world", config: false, type: String, default: "",
    onChange: () => F2HA.HA.clearCache()
  });
  game.settings.register(MODULE_ID, SETTINGS.HA_TOKEN, {
    scope: "world", config: false, type: String, default: "",
    onChange: () => F2HA.HA.clearCache()
  });
  game.settings.register(MODULE_ID, SETTINGS.ENTITY_FILTER_MODE, {
    scope: "world", config: false, type: String, default: FILTER_MODE.LABEL,
    onChange: () => F2HA.HA.clearCache()
  });
  game.settings.register(MODULE_ID, SETTINGS.ENTITY_LABEL, {
    scope: "world", config: false, type: String, default: "foundry",
    onChange: () => F2HA.HA.clearCache()
  });
  game.settings.register(MODULE_ID, SETTINGS.ENTITY_DOMAINS, {
    scope: "world", config: false, type: Array, default: ["script", "automation", "scene"],
    onChange: () => F2HA.HA.clearCache()
  });

  // --- Integration control ---
  game.settings.register(MODULE_ID, SETTINGS.PAUSED, {
    scope: "world", config: false, type: Boolean, default: false
  });

  // --- Game status sync ---
  game.settings.register(MODULE_ID, SETTINGS.SESSION_SYNC_ENABLED, {
    scope: "world", config: false, type: Boolean, default: false
  });
  game.settings.register(MODULE_ID, SETTINGS.SESSION_ENTITY, {
    scope: "world", config: false, type: String, default: ""
  });
});

Hooks.once("init", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = F2HA;

  // Convenience entry point for other modules that prefer not to grab the api
  // object: Hooks.callAll("hambience.fire", { service, entity, data }).
  Hooks.on("hambience.fire", (payload = {}) => {
    F2HA.fire(payload);
  });

  // Register the GM toggle hook during init so it's ready before the canvas
  // loads. getSceneControlButtons fires during canvas init which can happen
  // before the ready hook, so registering here ensures we never miss it.
  initIntegrationControls();
});

Hooks.once("ready", () => {
  F2HA.log("Ready.");
  F2HA.registerTriggers();
  initAmbience();
  initSessionSync();
});
