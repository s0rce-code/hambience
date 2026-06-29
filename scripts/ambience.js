import {
  MODULE_ID, MODULE_TITLE, AMBIENCE_FLAG, AMBIENCE_DOMAINS, CONNECTION_MODE,
  FILTER_MODE, SETTINGS, BLUEPRINT_BASE_URL, defaultServiceForEntity, downloadText, copyText
} from "./constants.js";
import { HAClient } from "./ha-client.js";
import { AMBIENCE_PRESETS, getPreset, generateBlueprintYaml } from "./blueprints.js";

/**
 * IRL Ambience - adds a "HAmbience" tab to the Scene Configuration sheet.
 *
 * Two flows:
 *  - Create New: pick a tabletop preset, generate an HA automation blueprint,
 *    hand off to HA's blueprint import, then link the resulting automation.
 *  - Link Existing: pick one of your scripts/automations/scenes (token mode)
 *    or type an entity id (webhook-only mode) and link it to this scene.
 *
 * The link is stored on a scene flag and fired additively when the scene is
 * ACTIVATED (not merely viewed). Reverting is intentionally left to HA.
 */

const html = (strings, ...values) =>
  strings.reduce((out, s, i) => out + s + (i < values.length ? values[i] : ""), "");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function initAmbience() {
  Hooks.on("renderSceneConfig", onRenderSceneConfig);
  Hooks.on("updateScene", onUpdateScene);
}

/* ----------------------------- tab injection ----------------------------- */

async function onRenderSceneConfig(app, element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;

  // Find the tab nav and the section container, defensively across builds.
  const nav = root.querySelector("nav.sheet-tabs") || root.querySelector("nav.tabs") || root.querySelector(".sheet-tabs");
  if (!nav) return;
  const sampleTab = nav.querySelector("[data-tab]");
  const group = sampleTab?.dataset.group ?? "sheet";

  const sampleSection = root.querySelector("section.tab[data-tab]") || root.querySelector(".tab[data-tab]");
  const container = sampleSection?.parentElement;
  if (!container) return;

  // Avoid double injection on re-render.
  if (nav.querySelector('[data-tab="hambience"]')) return;

  // Nav link.
  const link = document.createElement("a");
  link.className = sampleTab?.className || "item";
  link.dataset.tab = "hambience";
  link.dataset.group = group;
  link.innerHTML = `<i class="fas fa-music"></i> ${MODULE_TITLE}`;
  nav.appendChild(link);

  // Content section.
  const section = document.createElement("section");
  section.className = "tab hambience-tab";
  section.dataset.tab = "hambience";
  section.dataset.group = group;
  section.innerHTML = buildTabHtml(app.document);
  container.appendChild(section);

  // Manage our own show/hide so we don't depend on the native tab controller
  // knowing about an injected tab.
  link.addEventListener("click", (ev) => {
    ev.preventDefault();
    nav.querySelectorAll("[data-tab]").forEach(a => a.classList.remove("active"));
    link.classList.add("active");
    container.querySelectorAll("section.tab, .tab").forEach(s => {
      if (s === section) return;
      s.classList.remove("active");
    });
    section.classList.add("active");
    section.hidden = false;
    app.setPosition?.({ height: "auto" });
  });
  nav.querySelectorAll('[data-tab]:not([data-tab="hambience"])').forEach(a => {
    a.addEventListener("click", () => {
      link.classList.remove("active");
      section.classList.remove("active");
      section.hidden = true;
    });
  });

  wireTab(app, section);
}

function buildTabHtml(scene) {
  const api = game.modules.get(MODULE_ID).api;
  const hybrid = api?.connectionMode === CONNECTION_MODE.HYBRID;
  const current = scene.getFlag(MODULE_ID, AMBIENCE_FLAG) ?? null;

  const presetOptions = AMBIENCE_PRESETS
    .map(p => `<option value="${p.id}">${esc(p.name)} - ${esc(p.description)}</option>`).join("");

  const linkedBlock = current
    ? html`<div class="hambience-linked">
        <p><i class="fas fa-link"></i> Linked: <strong>${esc(current.name || current.entity)}</strong>
        <code>${esc(current.entity)}</code> via <code>${esc(current.service)}</code></p>
        <button type="button" class="hambience-btn" data-hambience="test"><i class="fas fa-play"></i> Test Now</button>
        <button type="button" class="hambience-btn hambience-danger" data-hambience="unlink"><i class="fas fa-unlink"></i> Unlink</button>
      </div>`
    : `<p class="hambience-muted"><i class="fas fa-circle-info"></i> No ambience linked to this scene yet.</p>`;

  // Active label disclosure so users understand why the list is filtered.
  const filterMode = game.settings.get(MODULE_ID, SETTINGS.ENTITY_FILTER_MODE);
  const activeLabel = filterMode === FILTER_MODE.LABEL
    ? (game.settings.get(MODULE_ID, SETTINGS.ENTITY_LABEL) || "")
    : "";
  const filterNote = activeLabel
    ? `Showing scripts, automations, and scenes labeled "${esc(activeLabel)}" in Home Assistant. Change this in Connection settings.`
    : "Showing all scripts, automations, and scenes. Set a label in Connection settings to narrow this list.";

  // Link Existing UI: dropdown in hybrid mode, manual entry otherwise.
  const linkExisting = hybrid
    ? html`<div class="form-group">
        <label>Existing Script / Automation / Scene</label>
        <div class="hambience-row">
          <select data-hambience="entity"><option value="">Loading entities...</option></select>
          <button type="button" class="hambience-btn" data-hambience="refresh"><i class="fas fa-rotate"></i></button>
        </div>
        <p class="notes"><i class="fas fa-filter"></i> ${filterNote}</p>
      </div>`
    : html`<div class="form-group">
        <label>Entity ID</label>
        <input type="text" data-hambience="entity-manual" placeholder="script.tavern_ambience" />
        <p class="notes">Webhook-only mode: type the entity id. Enable the HA token in Connection settings for a searchable picker.</p>
      </div>`;

  return html`
    <div class="hambience-tab-body">
      <p class="hambience-intro">Bridge this Foundry scene to your game room. Foundry is where you author the moment; Home Assistant runs the lights, sound, and effects. The linked Home Assistant script, automation, or scene fires automatically when you <strong>activate</strong> this scene for players - not when you merely view or navigate to it.</p>

      ${linkedBlock}

      <hr/>
      <div class="hambience-subtabs">
        <button type="button" class="hambience-subtab active" data-hambience-sub="link"><i class="fas fa-link"></i> Link Existing</button>
        <button type="button" class="hambience-subtab" data-hambience-sub="create"><i class="fas fa-wand-magic-sparkles"></i> Create New</button>
      </div>

      <div data-hambience-pane="link">
        ${linkExisting}
        <button type="button" class="hambience-btn hambience-primary" data-hambience="link"><i class="fas fa-link"></i> Link to this Scene</button>
      </div>

      <div data-hambience-pane="create" hidden>
        <div class="form-group">
          <label>Ambience Preset</label>
          <select data-hambience="preset">${presetOptions}</select>
          <p class="notes">Presets are starting points. After importing, customize freely in Home Assistant.</p>
        </div>
        <div class="hambience-row">
          <button type="button" class="hambience-btn hambience-primary" data-hambience="copy-url"><i class="fas fa-link"></i> Copy Blueprint URL</button>
          <button type="button" class="hambience-btn" data-hambience="copy-bp"><i class="fas fa-copy"></i> Copy YAML</button>
          <button type="button" class="hambience-btn" data-hambience="download-bp"><i class="fas fa-download"></i> Download</button>
          <button type="button" class="hambience-btn" data-hambience="open-ha"><i class="fas fa-up-right-from-square"></i> Open HA Blueprints</button>
        </div>
        <ol class="hambience-steps">
          <li>Click <strong>Copy Blueprint URL</strong>, then in Home Assistant go to Settings, Automations &amp; Scenes, Blueprints, Import Blueprint, and paste the address. HA's dialog reads: "Import blueprints of other users from GitHub and the community forums by pasting the address below."</li>
          <li>Create an automation from the imported blueprint and choose your lights.</li>
          <li>Return to <strong>Link Existing</strong> and attach that automation to this scene.</li>
        </ol>
        <p class="notes"><i class="fas fa-circle-info"></i> No internet-hosted blueprint yet? Use <strong>Copy YAML</strong> or <strong>Download</strong> and import the file manually, or drop it in <code>config/blueprints/automation/hambience/</code>.</p>
        <p class="notes"><i class="fas fa-circle-info"></i> HAmbience complements Home Assistant, it doesn't replace it. Keep your revert-after-combat and other logic in HA.</p>
      </div>
    </div>`;
}

/* ----------------------------- tab behavior ----------------------------- */

function wireTab(app, section) {
  const scene = app.document;
  const q = (sel) => section.querySelector(sel);

  // Sub-tab switching (Link vs Create).
  section.querySelectorAll("[data-hambience-sub]").forEach(btn => {
    btn.addEventListener("click", () => {
      const sub = btn.dataset.hambienceSub;
      section.querySelectorAll("[data-hambience-sub]").forEach(b => b.classList.toggle("active", b === btn));
      section.querySelectorAll("[data-hambience-pane]").forEach(p => { p.hidden = p.dataset.hambiencePane !== sub; });
      app.setPosition?.({ height: "auto" });
    });
  });

  // Populate the entity dropdown in hybrid mode.
  const entitySel = q('[data-hambience="entity"]');
  if (entitySel) {
    const current = scene.getFlag(MODULE_ID, AMBIENCE_FLAG) ?? null;
    populateEntities(entitySel, current?.entity).then(() => app.setPosition?.({ height: "auto" }));
    q('[data-hambience="refresh"]')?.addEventListener("click", async () => {
      entitySel.innerHTML = `<option value="">Loading…</option>`;
      await populateEntities(entitySel, current?.entity, true);
      app.setPosition?.({ height: "auto" });
    });
  }

  // Link.
  q('[data-hambience="link"]')?.addEventListener("click", async () => {
    const entity = (entitySel
      ? entitySel.value
      : q('[data-hambience="entity-manual"]')?.value || "").trim();
    if (!entity) { ui.notifications?.warn("HAmbience: pick or enter an entity first."); return; }
    const service = defaultServiceForEntity(entity);
    let name = entity;
    if (entitySel) {
      const opt = entitySel.querySelector(`option[value="${CSS.escape(entity)}"]`);
      if (opt) name = opt.dataset.name || entity;
    }
    await scene.setFlag(MODULE_ID, AMBIENCE_FLAG, { entity, service, name });
    ui.notifications?.info(`HAmbience: linked "${name}" to scene "${scene.name}".`);
    refreshLinkedBlock(app, section);
  });

  // Test / Unlink (present only when linked).
  section.addEventListener("click", async (ev) => {
    const action = ev.target.closest("[data-hambience]")?.dataset.hambience;
    if (action === "test") {
      const cur = scene.getFlag(MODULE_ID, AMBIENCE_FLAG);
      if (cur) await fireAmbience(cur, scene);
    } else if (action === "unlink") {
      await scene.unsetFlag(MODULE_ID, AMBIENCE_FLAG);
      ui.notifications?.info(`HAmbience: unlinked ambience from "${scene.name}".`);
      refreshLinkedBlock(app, section);
    }
  });

  // Create New: blueprint URL / copy / download / open.
  q('[data-hambience="copy-url"]')?.addEventListener("click", async () => {
    const preset = currentPreset(section);
    if (!preset) return;
    const url = `${BLUEPRINT_BASE_URL.replace(/\/+$/, "")}/${preset.id}.yaml`;
    const ok = await copyText(url);
    ui.notifications?.[ok ? "info" : "warn"](
      ok ? "HAmbience: blueprint URL copied. Paste it into HA's Import Blueprint dialog."
         : "HAmbience: clipboard blocked - copy the URL manually."
    );
  });
  q('[data-hambience="download-bp"]')?.addEventListener("click", () => {
    const preset = currentPreset(section);
    if (preset) downloadText(`hambience-${preset.id}.yaml`, generateBlueprintYaml(preset));
  });
  q('[data-hambience="copy-bp"]')?.addEventListener("click", async () => {
    const preset = currentPreset(section);
    if (!preset) return;
    const ok = await copyText(generateBlueprintYaml(preset));
    ui.notifications?.[ok ? "info" : "warn"](ok ? "HAmbience: blueprint YAML copied." : "HAmbience: clipboard blocked - use Download instead.");
  });
  q('[data-hambience="open-ha"]')?.addEventListener("click", () => {
    const base = game.settings.get(MODULE_ID, SETTINGS.HA_URL);
    const url = base ? `${base.replace(/\/+$/, "")}/config/blueprint/dashboard` : "https://my.home-assistant.io/redirect/blueprints/";
    window.open(url, "_blank", "noopener");
  });
}

function currentPreset(section) {
  const id = section.querySelector('[data-hambience="preset"]')?.value;
  return getPreset(id);
}

async function populateEntities(select, selectedId, force = false) {
  try {
    // Respect the global label filter when one is configured, so large HA
    // instances don't dump every script/automation/scene into the picker.
    const mode = game.settings.get(MODULE_ID, SETTINGS.ENTITY_FILTER_MODE);
    const label = mode === FILTER_MODE.LABEL
      ? (game.settings.get(MODULE_ID, SETTINGS.ENTITY_LABEL) || "")
      : "";
    const entities = await HAClient.fetchByDomains(AMBIENCE_DOMAINS, { label });
    if (!entities.length) {
      const hint = label
        ? `No labeled scripts/automations/scenes found (label "${esc(label)}")`
        : "No scripts/automations/scenes found";
      select.innerHTML = `<option value="">${hint}</option>`;
      return;
    }
    select.innerHTML = entities.map(e =>
      `<option value="${esc(e.entity_id)}" data-name="${esc(e.friendly_name)}" ${e.entity_id === selectedId ? "selected" : ""}>${esc(e.friendly_name)} - ${esc(e.entity_id)}</option>`
    ).join("");
  } catch (err) {
    select.innerHTML = `<option value="">Error loading entities</option>`;
    ui.notifications?.error(`HAmbience: ${HAClient._explain(err)}`);
  }
}

function refreshLinkedBlock(app, section) {
  // Cheapest reliable refresh: rebuild the section body and re-wire.
  section.innerHTML = buildTabHtml(app.document);
  wireTab(app, section);
  app.setPosition?.({ height: "auto" });
}

/* ----------------------------- firing ----------------------------- */

async function fireAmbience(ambience, scene) {
  const api = game.modules.get(MODULE_ID).api;
  if (!api) return;
  const payload = JSON.stringify({ service: ambience.service, entity: ambience.entity });
  api.log?.(`Firing ambience for scene "${scene?.name}": ${ambience.entity}`);
  await api.testDispatch(payload);
}

/**
 * Fire a scene's linked ambience when it becomes the active scene.
 * GM-only; additive (never reverts the prior scene).
 */
async function onUpdateScene(scene, changed) {
  if (!game.user?.isGM) return;
  if (changed?.active !== true) return; // only on activation
  if (game.modules.get(MODULE_ID)?.api?.paused) return;
  const ambience = scene.getFlag(MODULE_ID, AMBIENCE_FLAG);
  if (!ambience?.entity) return;
  await fireAmbience(ambience, scene);
}
