/**
 * Shared constants and pure helpers for HAmbience.
 */

export const MODULE_ID = "hambience";
export const MODULE_TITLE = "HAmbience";

/** Settings keys. */
export const SETTINGS = {
  WEBHOOK_URL: "webhookUrl",
  TRIGGERS: "triggers",
  WEBHOOK_TOUCH: "webhookUrl_touch",
  CONNECTION_MODE: "connectionMode",
  HA_URL: "haUrl",
  HA_TOKEN: "haToken",
  ENTITY_FILTER_MODE: "entityFilterMode",
  ENTITY_LABEL: "entityLabel",
  ENTITY_DOMAINS: "entityDomains",
  // --- integration control ---
  PAUSED: "paused",
  // --- game status sync ---
  SESSION_SYNC_ENABLED: "sessionSyncEnabled",
  SESSION_ENTITY: "sessionEntity"
};

/** Where supporters are sent. Framed as support, never as a paywall. */
export const SUPPORT_URL = "https://buymeacoffee.com/s0rcecode";

/** Scene flag key (stored at scene.flags.hambience.ambience). */
export const AMBIENCE_FLAG = "ambience";

export const CONNECTION_MODE = { WEBHOOK: "webhook", HYBRID: "hybrid" };
export const FILTER_MODE = { LABEL: "label", DOMAIN: "domain", ALL: "all" };

/** Domains the IRL Ambience picker surfaces. */
export const AMBIENCE_DOMAINS = ["script", "automation", "scene"];

/**
 * Recommended labels to suggest everywhere a label is entered. Users assign
 * one of these to any HA script/automation/scene they want HAmbience to list.
 */
export const RECOMMENDED_LABELS = ["hambience", "foundry"];

/**
 * Base raw-GitHub URL for hosted ambience blueprints. Updated once the public
 * repo is live; until then users can still download/copy the generated YAML.
 * Example final form:
 *   https://raw.githubusercontent.com/s0rce-code/hambience/main/blueprints
 */
export const BLUEPRINT_BASE_URL = "https://raw.githubusercontent.com/s0rce-code/hambience/main/blueprints";

export const DOMAIN_SERVICES = {
  script: ["script.turn_on"],
  automation: ["automation.trigger", "automation.turn_on", "automation.turn_off"],
  scene: ["scene.turn_on"],
  light: ["light.turn_on", "light.turn_off", "light.toggle"],
  switch: ["switch.turn_on", "switch.turn_off", "switch.toggle"],
  input_boolean: ["input_boolean.turn_on", "input_boolean.turn_off", "input_boolean.toggle"],
  input_button: ["input_button.press"],
  button: ["button.press"],
  media_player: [
    "media_player.play_media", "media_player.media_play", "media_player.media_pause",
    "media_player.media_stop", "media_player.volume_set"
  ],
  cover: ["cover.open_cover", "cover.close_cover", "cover.toggle"],
  fan: ["fan.turn_on", "fan.turn_off", "fan.toggle"],
  climate: ["climate.set_temperature", "climate.set_hvac_mode"],
  lock: ["lock.lock", "lock.unlock"],
  number: ["number.set_value"],
  select: ["select.select_option"],
  input_select: ["input_select.select_option"],
  input_number: ["input_number.set_value"],
  vacuum: ["vacuum.start", "vacuum.stop", "vacuum.return_to_base"],
  notify: ["notify.notify"]
};

export const GENERIC_SERVICES = ["homeassistant.turn_on", "homeassistant.turn_off", "homeassistant.toggle"];
export const RECOMMENDED_DOMAINS = new Set(["script", "automation", "scene"]);

export function suggestServices(entityId) {
  const domain = String(entityId || "").split(".")[0];
  const specific = DOMAIN_SERVICES[domain] ?? [];
  // Only fall back to the generic homeassistant.* services when we have no
  // domain-specific suggestions. For scripts/automations/scenes/lights/etc.
  // the specific services are what the user wants, and the generic ones just
  // add noise.
  if (specific.length) return [...specific];
  return [...GENERIC_SERVICES];
}

/**
 * Best default service to *invoke* an entity of a given domain.
 * scripts/scenes turn on; automations are force-triggered.
 */
export function defaultServiceForEntity(entityId) {
  const domain = String(entityId || "").split(".")[0];
  switch (domain) {
    case "script": return "script.turn_on";
    case "automation": return "automation.trigger";
    case "scene": return "scene.turn_on";
    default: return "homeassistant.turn_on";
  }
}

/**
 * Pick on/off services for an entity, used by Game Status Sync to flip a
 * boolean-like entity when a session starts or ends.
 * @param {string} entityId
 * @returns {{on: string, off: string}}
 */
export function onOffServicesForEntity(entityId) {
  const domain = String(entityId || "").split(".")[0];
  switch (domain) {
    case "input_boolean": return { on: "input_boolean.turn_on", off: "input_boolean.turn_off" };
    case "switch": return { on: "switch.turn_on", off: "switch.turn_off" };
    case "light": return { on: "light.turn_on", off: "light.turn_off" };
    case "fan": return { on: "fan.turn_on", off: "fan.turn_off" };
    default: return { on: "homeassistant.turn_on", off: "homeassistant.turn_off" };
  }
}

/** Generate a unique, hard-to-guess webhook id for the HA receiver. */
export function generateWebhookId() {
  const rand = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
    .replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 24);
  return `hambience_${rand}`;
}

export function buildServicePayload(service, entity) {
  return JSON.stringify({ service, entity }, null, 2);
}

export function parseServicePayload(payloadStr) {
  try {
    const obj = JSON.parse(payloadStr || "{}");
    if (obj && typeof obj === "object" && typeof obj.service === "string" && typeof obj.entity === "string") {
      return { service: obj.service, entity: obj.entity };
    }
  } catch (_e) { /* not JSON */ }
  return null;
}

/* ---------------------------- small DOM/util helpers ---------------------------- */

/** Trigger a client-side text download without relying on namespaced helpers. */
export function downloadText(filename, text, mime = "text/yaml") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copy text to clipboard with a graceful fallback. */
export async function copyText(text) {
  try {
    if (game.clipboard?.copyPlainText) { await game.clipboard.copyPlainText(text); return true; }
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Build the exact YAML block a user pastes into Home Assistant's
 * configuration.yaml to allow this Foundry origin through CORS.
 * @param {string} origin e.g. "https://test.murderhobos.quest"
 * @returns {string}
 */
export function corsYamlBlock(origin) {
  return `http:\n  cors_allowed_origins:\n    - ${origin}`;
}
