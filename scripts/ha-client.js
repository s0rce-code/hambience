import { MODULE_ID, SETTINGS, FILTER_MODE } from "./constants.js";

/**
 * Read-only Home Assistant client. The token is used ONLY to discover
 * entities/labels for the pickers - never to fire actions. All dispatch
 * goes through the webhook.
 */
export const HAClient = {
  _entityCache: [],
  _entitiesLoaded: false,

  get url() {
    return (game.settings.get(MODULE_ID, SETTINGS.HA_URL) || "").replace(/\/+$/, "");
  },
  get token() {
    return game.settings.get(MODULE_ID, SETTINGS.HA_TOKEN) || "";
  },

  _headers() {
    return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" };
  },

  _explain(err) {
    if (err instanceof TypeError) {
      return "Could not reach Home Assistant. If the URL and token look right, this is almost certainly CORS - add your Foundry origin to `cors_allowed_origins` under the `http:` integration in Home Assistant's configuration.yaml, then restart HA.";
    }
    return err?.message ?? String(err);
  },

  async testConnection() {
    if (!game.user?.isGM) return { ok: false, message: "GM only." };
    if (!this.url || !this.token) return { ok: false, message: "Set the Home Assistant URL and token first." };
    try {
      const res = await fetch(`${this.url}/api/`, { headers: this._headers() });
      if (res.ok) return { ok: true, message: "Connected to Home Assistant." };
      if (res.status === 401) return { ok: false, message: "Unauthorized - the token is invalid or expired." };
      return { ok: false, message: `HA responded ${res.status} ${res.statusText}.` };
    } catch (err) {
      return { ok: false, message: this._explain(err) };
    }
  },

  async _renderTemplate(template) {
    const res = await fetch(`${this.url}/api/template`, {
      method: "POST", headers: this._headers(), body: JSON.stringify({ template })
    });
    if (!res.ok) throw new Error(`Template render failed: ${res.status} ${res.statusText}`);
    return res.text();
  },

  async _allStates() {
    const res = await fetch(`${this.url}/api/states`, { headers: this._headers() });
    if (!res.ok) throw new Error(`/api/states failed: ${res.status} ${res.statusText}`);
    return res.json();
  },

  async fetchLabels() {
    if (!game.user?.isGM) return [];
    const ids = JSON.parse(await this._renderTemplate("{{ labels() | to_json }}"));
    const names = JSON.parse(await this._renderTemplate("{{ labels() | map('label_name') | list | to_json }}"));
    return ids.map((id, i) => ({ id, name: names[i] ?? id }));
  },

  /** Entities according to the configured filter mode (used by trigger picker). */
  async fetchEntities() {
    if (!game.user?.isGM) return [];
    if (!this.url || !this.token) throw new Error("HA URL/token not configured.");

    const states = await this._allStates();
    const nameById = new Map(states.map(s => [s.entity_id, s.attributes?.friendly_name ?? s.entity_id]));
    const allIds = states.map(s => s.entity_id);

    const mode = game.settings.get(MODULE_ID, SETTINGS.ENTITY_FILTER_MODE) || FILTER_MODE.LABEL;
    let ids = allIds;

    if (mode === FILTER_MODE.LABEL) {
      const label = game.settings.get(MODULE_ID, SETTINGS.ENTITY_LABEL) || "";
      if (!label) throw new Error("Label filter selected but no label is set.");
      ids = JSON.parse(await this._renderTemplate(`{{ label_entities('${label.replace(/'/g, "\\'")}') | to_json }}`));
    } else if (mode === FILTER_MODE.DOMAIN) {
      const set = new Set(game.settings.get(MODULE_ID, SETTINGS.ENTITY_DOMAINS) || []);
      ids = allIds.filter(id => set.has(id.split(".")[0]));
    }

    const entities = ids.map(id => ({
      entity_id: id, friendly_name: nameById.get(id) ?? id, domain: id.split(".")[0]
    })).sort((a, b) => a.entity_id.localeCompare(b.entity_id));

    this._entityCache = entities;
    this._entitiesLoaded = true;
    return entities;
  },

  /**
   * Fetch entities limited to specific domains, independent of the global
   * filter. Used by the IRL Ambience picker (scripts/automations/scenes).
   * Optionally intersect with a label so large instances stay manageable.
   * @param {string[]} domains
   * @param {{label?: string}} [opts]
   */
  async fetchByDomains(domains, opts = {}) {
    if (!game.user?.isGM) return [];
    if (!this.url || !this.token) throw new Error("HA URL/token not configured.");
    const set = new Set(domains);
    const states = await this._allStates();

    let allowed = null; // null = no label restriction
    const label = (opts.label || "").trim();
    if (label) {
      try {
        const raw = await this._renderTemplate(`{{ label_entities('${label.replace(/'/g, "\\'")}') | to_json }}`);
        allowed = new Set(JSON.parse(raw));
      } catch (_e) {
        // Label lookup failed (e.g. label doesn't exist yet) - fall back to
        // domain-only rather than returning nothing.
        allowed = null;
      }
    }

    return states
      .filter(s => set.has(s.entity_id.split(".")[0]))
      .filter(s => !allowed || allowed.has(s.entity_id))
      .map(s => ({
        entity_id: s.entity_id,
        friendly_name: s.attributes?.friendly_name ?? s.entity_id,
        domain: s.entity_id.split(".")[0]
      }))
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  },

  async getEntities({ force = false } = {}) {
    if (force || !this._entitiesLoaded) {
      try { await this.fetchEntities(); }
      catch (err) { ui.notifications?.error(`HAmbience: ${this._explain(err)}`); return this._entityCache; }
    }
    return this._entityCache;
  },

  clearCache() { this._entityCache = []; this._entitiesLoaded = false; }
};
