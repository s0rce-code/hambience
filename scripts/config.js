import {
  MODULE_ID, SETTINGS, CONNECTION_MODE, FILTER_MODE, RECOMMENDED_LABELS, copyText, corsYamlBlock,
  SUPPORT_URL, generateWebhookId
} from "./constants.js";
import { HAClient } from "./ha-client.js";
import { generateReceiverYaml } from "./blueprints.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Connection settings:
 *  - Connection mode (webhook-only vs hybrid)
 *  - Webhook URL + test (always)
 *  - HA URL/token + test, and entity discovery filter (hybrid only)
 */
export class F2HAConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    // Transient UI state so toggling mode/filter re-renders without saving.
    this._mode = game.settings.get(MODULE_ID, SETTINGS.CONNECTION_MODE) || CONNECTION_MODE.WEBHOOK;
    this._filterMode = game.settings.get(MODULE_ID, SETTINGS.ENTITY_FILTER_MODE) || FILTER_MODE.LABEL;
    this._labels = null; // populated by "Load labels"
  }

  static DEFAULT_OPTIONS = {
    id: "f2ha-config",
    tag: "form",
    window: { title: "HAmbience - Connection", icon: "fas fa-plug", contentClasses: ["f2ha", "f2ha-config"] },
    position: { width: 640, height: "auto" },
    form: { handler: F2HAConfig.#onSubmit, submitOnChange: false, closeOnSubmit: true },
    actions: {
      testWebhook: F2HAConfig.#onTestWebhook,
      testHa: F2HAConfig.#onTestHa,
      loadLabels: F2HAConfig.#onLoadLabels,
      refreshEntities: F2HAConfig.#onRefreshEntities,
      copyOrigin: F2HAConfig.#onCopyOrigin,
      openSupport: F2HAConfig.#onOpenSupport,
      generateReceiver: F2HAConfig.#onGenerateReceiver
    }
  };

  static PARTS = { form: { template: `modules/${MODULE_ID}/templates/config.hbs` } };

  /** @override */
  async _prepareContext() {
    const domains = game.settings.get(MODULE_ID, SETTINGS.ENTITY_DOMAINS) || [];
    const currentLabel = game.settings.get(MODULE_ID, SETTINGS.ENTITY_LABEL);
    // Merge recommended labels with any already-loaded ones, de-duplicated,
    // so "hambience" and "foundry" are always offered as starting points.
    const recommended = RECOMMENDED_LABELS.map(id => ({ id, name: id, recommended: true }));
    const loaded = (this._labels ?? []).filter(l => !RECOMMENDED_LABELS.includes(l.id));
    const labels = [...recommended, ...loaded].map(l => ({ ...l, selected: l.name === currentLabel }));
    const origin = window.location.origin;
    return {
      modes: [
        { value: CONNECTION_MODE.WEBHOOK, label: "Webhook only (no token, simplest)" },
        { value: CONNECTION_MODE.HYBRID, label: "Webhook + HA token (enables entity pickers)" }
      ],
      mode: this._mode,
      isHybrid: this._mode === CONNECTION_MODE.HYBRID,
      webhookUrl: game.settings.get(MODULE_ID, SETTINGS.WEBHOOK_URL),
      haUrl: game.settings.get(MODULE_ID, SETTINGS.HA_URL),
      haToken: game.settings.get(MODULE_ID, SETTINGS.HA_TOKEN),
      foundryOrigin: origin,
      corsYaml: corsYamlBlock(origin),
      filterModes: [
        { value: FILTER_MODE.LABEL, label: "By label (recommended)" },
        { value: FILTER_MODE.DOMAIN, label: "By entity type" },
        { value: FILTER_MODE.ALL, label: "All entities (not recommended for large setups)" }
      ],
      filterMode: this._filterMode,
      isLabel: this._filterMode === FILTER_MODE.LABEL,
      isDomain: this._filterMode === FILTER_MODE.DOMAIN,
      isAll: this._filterMode === FILTER_MODE.ALL,
      entityLabel: currentLabel,
      labels,
      labelsLoaded: !!(this._labels && this._labels.length),
      supportUrl: SUPPORT_URL,
      paused: !!game.settings.get(MODULE_ID, SETTINGS.PAUSED),
      sessionSyncEnabled: !!game.settings.get(MODULE_ID, SETTINGS.SESSION_SYNC_ENABLED),
      sessionEntity: game.settings.get(MODULE_ID, SETTINGS.SESSION_ENTITY),
      domainOptions: ["script", "automation", "scene", "light", "switch", "input_boolean",
        "media_player", "cover", "fan", "climate", "lock", "input_select", "number", "select"]
        .map(d => ({ value: d, label: d, selected: domains.includes(d) }))
    };
  }

  /** @override */
  _onRender() {
    const modeSel = this.element.querySelector('[name="connectionMode"]');
    if (modeSel) modeSel.addEventListener("change", () => { this._mode = modeSel.value; this.render(); });

    const filterSel = this.element.querySelector('[name="entityFilterMode"]');
    if (filterSel) filterSel.addEventListener("change", () => { this._filterMode = filterSel.value; this.render(); });

    // Label suggestions: selecting from the dropdown fills the text input.
    // We use a real <select> rather than a datalist because a datalist filters
    // its options by whatever is already typed in the input, which hid the
    // other suggestions once a label was set.
    const labelPick = this.element.querySelector(".hambience-label-pick");
    const labelInput = this.element.querySelector('[name="entityLabel"]');
    if (labelPick && labelInput) {
      labelPick.addEventListener("change", () => {
        if (labelPick.value) labelInput.value = labelPick.value;
      });
    }
  }

  /* -------------------------------- actions -------------------------------- */

  static async #onTestWebhook(event) {
    event.preventDefault();
    const url = this.element.querySelector('[name="webhookUrl"]')?.value?.trim();
    if (url) await game.settings.set(MODULE_ID, SETTINGS.WEBHOOK_URL, url);
    await game.modules.get(MODULE_ID).api?.testDispatch('{ "f2ha_test": true }');
  }

  static async #onTestHa(event) {
    event.preventDefault();
    // Persist URL/token first so the client reads current values.
    const url = this.element.querySelector('[name="haUrl"]')?.value?.trim() ?? "";
    const token = this.element.querySelector('[name="haToken"]')?.value?.trim() ?? "";
    await game.settings.set(MODULE_ID, SETTINGS.HA_URL, url);
    await game.settings.set(MODULE_ID, SETTINGS.HA_TOKEN, token);
    const result = await HAClient.testConnection();
    if (result.ok) ui.notifications?.info(`HAmbience: ${result.message}`);
    else ui.notifications?.warn(`HAmbience: ${result.message}`);
  }

  static async #onLoadLabels(event) {
    event.preventDefault();
    const url = this.element.querySelector('[name="haUrl"]')?.value?.trim() ?? "";
    const token = this.element.querySelector('[name="haToken"]')?.value?.trim() ?? "";
    await game.settings.set(MODULE_ID, SETTINGS.HA_URL, url);
    await game.settings.set(MODULE_ID, SETTINGS.HA_TOKEN, token);
    try {
      this._labels = await HAClient.fetchLabels();
      ui.notifications?.info(`HAmbience: loaded ${this._labels.length} label(s).`);
      this.render();
    } catch (err) {
      ui.notifications?.error(`HAmbience: could not load labels - ${err.message}`);
    }
  }

  static async #onRefreshEntities(event) {
    event.preventDefault();
    HAClient.clearCache();
    const entities = await HAClient.getEntities({ force: true });
    ui.notifications?.info(`HAmbience: cached ${entities.length} entit${entities.length === 1 ? "y" : "ies"}.`);
  }

  static async #onCopyOrigin(event) {
    event.preventDefault();
    const yaml = corsYamlBlock(window.location.origin);
    const ok = await copyText(yaml);
    ui.notifications?.[ok ? "info" : "warn"](
      ok ? "HAmbience: CORS YAML copied. Paste it into Home Assistant's configuration.yaml and restart HA."
         : "HAmbience: clipboard blocked - copy the YAML manually."
    );
  }

  static async #onOpenSupport(event) {
    event.preventDefault();
    window.open(SUPPORT_URL, "_blank", "noopener");
  }

  static async #onGenerateReceiver(event) {
    event.preventDefault();
    const webhookId = generateWebhookId();
    const yaml = generateReceiverYaml(webhookId);

    // Auto-fill the webhook URL when we know the HA base URL.
    const haUrl = (this.element.querySelector('[name="haUrl"]')?.value
      || game.settings.get(MODULE_ID, SETTINGS.HA_URL) || "").trim().replace(/\/+$/, "");
    if (haUrl) {
      const fullUrl = `${haUrl}/api/webhook/${webhookId}`;
      const field = this.element.querySelector('[name="webhookUrl"]');
      if (field) field.value = fullUrl;
      await game.settings.set(MODULE_ID, SETTINGS.WEBHOOK_URL, fullUrl);
    }

    // Hand the user the automation YAML to paste into HA.
    const { downloadText } = await import("./constants.js");
    downloadText("hambience-receiver.yaml", yaml);
    const copied = await copyText(yaml);
    ui.notifications?.info(
      `HAmbience: generated a receiver automation with a unique webhook id${haUrl ? " and set your webhook URL" : ""}. ` +
      `The YAML was downloaded${copied ? " and copied to your clipboard" : ""} - import it in Home Assistant.`
    );
    this.render();
  }

  /* -------------------------------- submit --------------------------------- */

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);

    await game.settings.set(MODULE_ID, SETTINGS.CONNECTION_MODE, data.connectionMode ?? CONNECTION_MODE.WEBHOOK);
    await game.settings.set(MODULE_ID, SETTINGS.WEBHOOK_URL, data.webhookUrl ?? "");
    await game.settings.set(MODULE_ID, SETTINGS.WEBHOOK_TOUCH, !game.settings.get(MODULE_ID, SETTINGS.WEBHOOK_TOUCH));

    if ((data.connectionMode ?? CONNECTION_MODE.WEBHOOK) === CONNECTION_MODE.HYBRID) {
      await game.settings.set(MODULE_ID, SETTINGS.HA_URL, (data.haUrl ?? "").trim());
      await game.settings.set(MODULE_ID, SETTINGS.HA_TOKEN, (data.haToken ?? "").trim());
      await game.settings.set(MODULE_ID, SETTINGS.ENTITY_FILTER_MODE, data.entityFilterMode ?? FILTER_MODE.LABEL);
      await game.settings.set(MODULE_ID, SETTINGS.ENTITY_LABEL, (data.entityLabel ?? "").trim());

      // Domains arrive as a single value or array depending on selection count.
      let domains = data.entityDomains ?? [];
      if (typeof domains === "string") domains = domains ? [domains] : [];
      await game.settings.set(MODULE_ID, SETTINGS.ENTITY_DOMAINS, domains);
    }

    // Game status sync.
    await game.settings.set(MODULE_ID, SETTINGS.SESSION_SYNC_ENABLED, !!data.sessionSyncEnabled);
    await game.settings.set(MODULE_ID, SETTINGS.SESSION_ENTITY, (data.sessionEntity ?? "").trim());

    HAClient.clearCache();
    game.modules.get(MODULE_ID).api?.registerTriggers();
  }
}

/**
 * Tiny menu entry that just opens the Buy Me a Coffee page. Registered as a
 * settings menu so it sits on the module's settings page alongside Connection,
 * Triggers, and Macros. It opens the link and closes immediately.
 */
export class F2HASupport extends ApplicationV2 {
  static DEFAULT_OPTIONS = { id: "f2ha-support" };
  async render(...args) {
    window.open(SUPPORT_URL, "_blank", "noopener");
    return this;
  }
}
