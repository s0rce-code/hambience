import {
  MODULE_ID, SETTINGS, suggestServices, buildServicePayload, parseServicePayload,
  BLUEPRINT_BASE_URL, copyText, downloadText
} from "./constants.js";
import { getAllHooks } from "./hooks.js";
import { HAClient } from "./ha-client.js";
import { TRIGGER_PRESETS, getPresetTrigger } from "./presets.js";
import { getCritBlueprint, generateCritBlueprintYaml } from "./blueprints.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/* ====================================================================== */
/*  Triggers manager (the CRUD table)                                     */
/* ====================================================================== */

export class F2HATriggersConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "f2ha-triggers",
    tag: "div",
    window: { title: "HAmbience - Triggers", icon: "fas fa-bolt", contentClasses: ["f2ha", "f2ha-triggers"] },
    position: { width: 720, height: "auto" },
    actions: {
      addTrigger: F2HATriggersConfig.#onAdd,
      editTrigger: F2HATriggersConfig.#onEdit,
      deleteTrigger: F2HATriggersConfig.#onDelete,
      toggleTrigger: F2HATriggersConfig.#onToggle
    }
  };

  static PARTS = { table: { template: `modules/${MODULE_ID}/templates/triggers.hbs` } };

  async _prepareContext() {
    const triggers = (game.settings.get(MODULE_ID, SETTINGS.TRIGGERS) ?? []).map((t, index) => ({
      ...t,
      index,
      enabled: t.enabled !== false,
      payloadPreview: (t.payload ?? "").replace(/\s+/g, " ").slice(0, 70)
    }));
    return { triggers, hasTriggers: triggers.length > 0 };
  }

  static async #onAdd(event) {
    event.preventDefault();
    if (await F2HATriggerEditor.open()) this.render();
  }

  static async #onEdit(event, target) {
    event.preventDefault();
    if (await F2HATriggerEditor.open(Number(target.dataset.index))) this.render();
  }

  static async #onToggle(event, target) {
    event.preventDefault();
    const i = Number(target.dataset.index);
    const triggers = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.TRIGGERS) ?? []);
    if (!triggers[i]) return;
    triggers[i].enabled = triggers[i].enabled === false;
    await game.settings.set(MODULE_ID, SETTINGS.TRIGGERS, triggers);
    this.render();
  }

  static async #onDelete(event, target) {
    event.preventDefault();
    const i = Number(target.dataset.index);
    const triggers = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.TRIGGERS) ?? []);
    const trigger = triggers[i];
    if (!trigger) return;
    const ok = await DialogV2.confirm({
      window: { title: "Delete Trigger" },
      content: `<p>Delete the trigger on <strong>${foundry.utils.escapeHTML(trigger.hook)}</strong>?</p>`,
      rejectClose: false
    });
    if (!ok) return;
    triggers.splice(i, 1);
    await game.settings.set(MODULE_ID, SETTINGS.TRIGGERS, triggers);
    this.render();
  }
}

/* ====================================================================== */
/*  Trigger editor (add / edit one trigger)                               */
/* ====================================================================== */

export class F2HATriggerEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.index = options.index ?? null;
    this._resolve = options.resolve ?? (() => {});
    this._saved = false;

    const api = game.modules.get(MODULE_ID).api;
    this._hybrid = !!api?.isHybrid;

    // Determine starting build mode from existing payload.
    const triggers = game.settings.get(MODULE_ID, SETTINGS.TRIGGERS) ?? [];
    const existing = this.index !== null ? triggers[this.index] : null;
    const parsed = existing ? parseServicePayload(existing.payload) : null;
    // Default to builder when hybrid and payload fits the service/entity shape.
    this._buildMode = (this._hybrid && (parsed || !existing)) ? "builder" : "raw";
    this._entities = [];
    this._preset = existing?.preset ?? "";
  }

  static DEFAULT_OPTIONS = {
    id: "f2ha-trigger-editor",
    tag: "form",
    window: { title: "HAmbience - Trigger", icon: "fas fa-bolt", contentClasses: ["f2ha", "f2ha-trigger-editor"] },
    position: { width: 560, height: "auto" },
    form: { handler: F2HATriggerEditor.#onSubmit, submitOnChange: false, closeOnSubmit: true },
    actions: {
      validatePayload: F2HATriggerEditor.#onValidatePayload,
      createMacro: F2HATriggerEditor.#onCreateMacro,
      refreshEntities: F2HATriggerEditor.#onRefreshEntities,
      setBuildMode: F2HATriggerEditor.#onSetBuildMode,
      setPreset: F2HATriggerEditor.#onSetPreset,
      copyPresetBlueprintUrl: F2HATriggerEditor.#onCopyPresetBlueprintUrl,
      copyPresetBlueprintYaml: F2HATriggerEditor.#onCopyPresetBlueprintYaml,
      downloadPresetBlueprint: F2HATriggerEditor.#onDownloadPresetBlueprint
    }
  };

  static PARTS = { form: { template: `modules/${MODULE_ID}/templates/trigger-editor.hbs` } };

  static open(index = null) {
    return new Promise((resolve) => new F2HATriggerEditor({ index, resolve }).render(true));
  }

  async _onClose(options) {
    await super._onClose?.(options);
    this._resolve(this._saved === true);
  }

  async _prepareContext() {
    const triggers = game.settings.get(MODULE_ID, SETTINGS.TRIGGERS) ?? [];
    const existing = this.index !== null ? triggers[this.index] : null;
    const parsed = existing ? parseServicePayload(existing.payload) : null;

    // Load entities for the picker if hybrid + builder.
    if (this._hybrid && this._buildMode === "builder") {
      this._entities = await HAClient.getEntities();
    }

    const selectedEntity = parsed?.entity ?? "";
    const services = selectedEntity ? suggestServices(selectedEntity) : [];

    const activePreset = this._preset ? getPresetTrigger(this._preset) : null;
    const presetConfig = existing?.presetConfig ?? activePreset?.defaultConfig ?? {};
    const presetOptions = (activePreset?.options ?? []).map(o => ({
      key: o.key,
      label: o.label,
      checked: presetConfig[o.key] ?? o.default ?? false
    }));

    return {
      isEdit: this.index !== null,
      hooks: getAllHooks(),
      macros: game.macros.map(m => ({ id: m.id, name: m.name })),
      name: existing?.name ?? "",
      hook: existing?.hook ?? "",
      payload: existing?.payload ?? "{\n  \n}",
      macroId: existing?.macroId ?? "",
      debounce: existing?.debounce ?? 0,

      presets: TRIGGER_PRESETS.map(p => ({ id: p.id, name: p.name, selected: p.id === this._preset })),
      preset: this._preset,
      hasPreset: !!activePreset,
      presetName: activePreset?.name ?? "",
      presetDescription: activePreset?.description ?? "",
      presetBlueprint: activePreset?.blueprint ?? "",
      presetOptions,

      hybrid: this._hybrid,
      buildMode: this._buildMode,
      isBuilder: this._buildMode === "builder",
      entities: this._entities.map(e => ({
        ...e,
        selected: e.entity_id === selectedEntity
      })),
      hasEntities: this._entities.length > 0,
      selectedEntity,
      services: services.map(s => ({ value: s, selected: parsed?.service === s }))
    };
  }

  _onRender() {
    // Preset selector -> re-render to show/hide hook + preset options.
    const presetSel = this.element.querySelector('[name="preset"]');
    if (presetSel) presetSel.addEventListener("change", () => {
      this._preset = presetSel.value;
      this.render();
    });

    // Hook picker -> hook input.
    const pick = this.element.querySelector(".f2ha-hook-pick");
    const input = this.element.querySelector(".f2ha-hook-input");
    if (pick && input) pick.addEventListener("change", () => { if (pick.value) input.value = pick.value; });

    // Entity choice -> repopulate the service dropdown by domain.
    const entitySel = this.element.querySelector('[name="builderEntity"]');
    const serviceSel = this.element.querySelector('[name="builderService"]');
    if (entitySel && serviceSel) {
      entitySel.addEventListener("change", () => {
        const services = suggestServices(entitySel.value);
        serviceSel.innerHTML = services.map(s => `<option value="${s}">${s}</option>`).join("");
        this._updateGuidance(entitySel.value);
      });
    }
  }

  _updateGuidance(entityId) {
    const note = this.element.querySelector(".f2ha-target-guidance");
    if (!note) return;
    const domain = String(entityId || "").split(".")[0];
    const recommended = domain === "script" || domain === "automation" || domain === "scene";
    note.textContent = recommended
      ? "Good choice - targeting a script/automation/scene keeps your logic in Home Assistant."
      : "Tip: consider pointing this at an HA script or automation instead of a device directly, so the logic lives in HA.";
    note.classList.toggle("f2ha-good", recommended);
  }

  /* -------------------------------- actions -------------------------------- */

  static async #onSetBuildMode(event, target) {
    event.preventDefault();
    this._buildMode = target.dataset.mode === "raw" ? "raw" : "builder";
    this.render();
  }

  static async #onSetPreset(event, target) {
    event.preventDefault();
    this._preset = target.value ?? "";
    this.render();
  }

  /** The companion blueprint id for the active preset, if any. */
  #activeBlueprintId() {
    const preset = this._preset ? getPresetTrigger(this._preset) : null;
    return preset?.blueprint ?? "";
  }

  static async #onCopyPresetBlueprintUrl(event) {
    event.preventDefault();
    const id = this.#activeBlueprintId();
    if (!id) return;
    const url = `${BLUEPRINT_BASE_URL.replace(/\/+$/, "")}/${id}.yaml`;
    const ok = await copyText(url);
    ui.notifications?.[ok ? "info" : "warn"](
      ok ? "HAmbience: blueprint URL copied. Paste it into HA's Import Blueprint dialog."
         : "HAmbience: clipboard blocked - copy the URL manually."
    );
  }

  static async #onCopyPresetBlueprintYaml(event) {
    event.preventDefault();
    const bp = getCritBlueprint(this.#activeBlueprintId());
    if (!bp) return;
    const ok = await copyText(generateCritBlueprintYaml(bp));
    ui.notifications?.[ok ? "info" : "warn"](ok ? "HAmbience: blueprint YAML copied." : "HAmbience: clipboard blocked - use Download instead.");
  }

  static async #onDownloadPresetBlueprint(event) {
    event.preventDefault();
    const bp = getCritBlueprint(this.#activeBlueprintId());
    if (!bp) return;
    downloadText(`hambience-${bp.id}.yaml`, generateCritBlueprintYaml(bp));
  }

  static async #onRefreshEntities(event) {
    event.preventDefault();
    await HAClient.getEntities({ force: true });
    this.render();
  }

  static #onValidatePayload(event) {
    event.preventDefault();
    const ta = this.element.querySelector('[name="payload"]');
    try {
      ta.value = JSON.stringify(JSON.parse(ta.value || "{}"), null, 2);
      ui.notifications?.info("HAmbience: payload is valid JSON.");
    } catch (err) {
      ui.notifications?.error(`HAmbience: invalid JSON - ${err.message}`);
    }
  }

  static async #onCreateMacro(event) {
    event.preventDefault();
    const payload = this.#collectPayload();
    if (payload === null) return;
    const name = this.element.querySelector('[name="name"]')?.value || "HAmbience Webhook";
    const command =
`// Auto-generated by Foundry-2-Home Assistant
const api = game.modules.get("${MODULE_ID}")?.api;
if (!api) return ui.notifications.error("HAmbience module not active.");
await api.testDispatch(${JSON.stringify(payload)});`;
    const macro = await Macro.create({ name: `${name} (HAmbience)`, type: "script", scope: "global", command });
    if (macro) {
      const select = this.element.querySelector('[name="macroId"]');
      if (select) {
        const opt = document.createElement("option");
        opt.value = macro.id; opt.textContent = macro.name; opt.selected = true;
        select.appendChild(opt);
      }
      ui.notifications?.info(`HAmbience: created macro "${macro.name}".`);
    }
  }

  /**
   * Collect the effective payload string from whichever build mode is active.
   * Returns null (and notifies) if invalid.
   * @returns {string|null}
   */
  #collectPayload() {
    if (this._buildMode === "builder") {
      const entity = this.element.querySelector('[name="builderEntity"]')?.value?.trim();
      const service = this.element.querySelector('[name="builderService"]')?.value?.trim();
      if (!entity || !service) {
        ui.notifications?.error("HAmbience: pick both an entity and an action.");
        return null;
      }
      return buildServicePayload(service, entity);
    }
    const raw = (this.element.querySelector('[name="payload"]')?.value ?? "").trim() || "{}";
    try { JSON.parse(raw); }
    catch (err) { ui.notifications?.error(`HAmbience: invalid payload JSON - ${err.message}`); return null; }
    return raw;
  }

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const presetId = this._preset || data.preset || "";
    const preset = presetId ? getPresetTrigger(presetId) : null;

    // A preset supplies the hook; a plain trigger needs one typed/picked.
    const hook = preset ? preset.hook : data.hook;
    if (!hook) { ui.notifications?.error("HAmbience: pick a preset or a hook."); throw new Error("hook required"); }

    const payload = this.#collectPayload();
    if (payload === null) throw new Error("invalid payload"); // keeps window open

    const trigger = {
      name: data.name ?? "",
      hook,
      payload,
      macroId: data.macroId || "",
      debounce: Number(data.debounce) || 0,
      enabled: true
    };

    // Persist preset id + its options config.
    if (preset) {
      trigger.preset = preset.id;
      const cfg = {};
      const submitted = data.presetConfig ?? {};
      for (const opt of (preset.options ?? [])) {
        cfg[opt.key] = !!submitted[opt.key];
      }
      trigger.presetConfig = cfg;
    }

    const triggers = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.TRIGGERS) ?? []);
    if (this.index !== null && triggers[this.index]) {
      trigger.enabled = triggers[this.index].enabled !== false;
      triggers[this.index] = trigger;
    } else {
      triggers.push(trigger);
    }
    await game.settings.set(MODULE_ID, SETTINGS.TRIGGERS, triggers);
    this._saved = true;
  }
}
