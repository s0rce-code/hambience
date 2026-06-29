/**
 * Preset triggers.
 *
 * A normal trigger fires whenever its Foundry hook fires. A preset trigger
 * packages a hook subscription plus a matcher that inspects the hook arguments
 * and decides whether to fire.
 *
 * MIDI QoL support: when MIDI QoL is active it intercepts rolls before they
 * reach the standard dnd5e chat message flow, so the d20 result is no longer
 * reliably in message.rolls. We detect MIDI at registration time and use
 * midi-qol.RollComplete instead, which fires after MIDI's full workflow with
 * a workflow object that has the d20 result in a known location.
 */

/* ----------------------------- helpers ------------------------------------ */

/** Check if MIDI QoL is active. Called at hook-registration time. */
function midiActive() {
  return !!game.modules.get("midi-qol")?.active;
}

/**
 * Inspect a standard dnd5e chat message for a kept natural d20.
 * Used when MIDI QoL is NOT active.
 */
function naturalD20FromMessage(message, target) {
  for (const roll of (message?.rolls ?? [])) {
    for (const die of (roll.dice ?? [])) {
      if (die.faces !== 20) continue;
      for (const r of (die.results ?? [])) {
        if (r.active && r.result === target) return true;
      }
    }
  }
  return false;
}

/**
 * Inspect a MIDI QoL workflow object for a natural d20.
 * The workflow has attackRoll which contains the actual Roll object.
 */
function naturalD20FromMidi(workflow, target) {
  // Primary: attackRoll is the kept d20 roll.
  const attackRoll = workflow?.attackRoll;
  if (attackRoll) {
    for (const die of (attackRoll.dice ?? [])) {
      if (die.faces !== 20) continue;
      for (const r of (die.results ?? [])) {
        if (r.active && r.result === target) return true;
      }
    }
  }
  // Fallback: check all rolls on the workflow's item roll.
  for (const roll of (workflow?.rolls ?? [])) {
    for (const die of (roll.dice ?? [])) {
      if (die.faces !== 20) continue;
      for (const r of (die.results ?? [])) {
        if (r.active && r.result === target) return true;
      }
    }
  }
  return false;
}

function isPlayerCharacterActor(actor) {
  return actor?.type === "character" && actor?.hasPlayerOwner === true;
}

function isPlayerCharacterMessage(message) {
  const actor = game.actors.get(message?.speaker?.actor);
  return isPlayerCharacterActor(actor);
}

function isPlayerCharacterWorkflow(workflow) {
  return isPlayerCharacterActor(workflow?.actor);
}

/* ----------------------------- hook resolver ------------------------------ */

/**
 * Return the right hook name for crit detection based on active modules.
 * Called during registerTriggers so it picks up the correct hook
 * after all modules have initialized.
 */
function critHook() {
  return midiActive() ? "midi-qol.RollComplete" : "createChatMessage";
}

/* ----------------------------- matchers ----------------------------------- */

function matchNat20(args, cfg) {
  if (midiActive()) {
    const [workflow] = args;
    if (!workflow) return false;
    if (!naturalD20FromMidi(workflow, 20)) return false;
    if (cfg?.pcOnly && !isPlayerCharacterWorkflow(workflow)) return false;
    return true;
  }
  const [message] = args;
  if (!message) return false;
  if (!naturalD20FromMessage(message, 20)) return false;
  if (cfg?.pcOnly && !isPlayerCharacterMessage(message)) return false;
  return true;
}

function matchNat1(args, cfg) {
  if (midiActive()) {
    const [workflow] = args;
    if (!workflow) return false;
    if (!naturalD20FromMidi(workflow, 1)) return false;
    if (cfg?.pcOnly && !isPlayerCharacterWorkflow(workflow)) return false;
    return true;
  }
  const [message] = args;
  if (!message) return false;
  if (!naturalD20FromMessage(message, 1)) return false;
  if (cfg?.pcOnly && !isPlayerCharacterMessage(message)) return false;
  return true;
}

/* ----------------------------- registry ----------------------------------- */

export const TRIGGER_PRESETS = [
  {
    id: "nat20",
    name: "Critical Hit (Natural 20)",
    // hook is a function so it resolves at registration time after modules load.
    get hook() { return critHook(); },
    icon: "fa-dice-d20",
    description: "Fires when a kept natural 20 is rolled. Works with and without MIDI QoL.",
    match: matchNat20,
    defaultConfig: { pcOnly: true },
    options: [{ key: "pcOnly", label: "Only player characters (ignore NPC rolls)", default: true }],
    blueprint: "crit-nat20",
    suggestedEntity: "automation.hambience_critical_hit_nat_20"
  },
  {
    id: "nat1",
    name: "Critical Miss (Natural 1)",
    get hook() { return critHook(); },
    icon: "fa-dice-one",
    description: "Fires when a kept natural 1 is rolled. Works with and without MIDI QoL.",
    match: matchNat1,
    defaultConfig: { pcOnly: true },
    options: [{ key: "pcOnly", label: "Only player characters (ignore NPC rolls)", default: true }],
    blueprint: "crit-nat1",
    suggestedEntity: "automation.hambience_critical_miss_nat_1"
  }
];

export function getPresetTrigger(id) {
  return TRIGGER_PRESETS.find(p => p.id === id) ?? null;
}
