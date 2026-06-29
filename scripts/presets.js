/**
 * Preset triggers.
 *
 * A normal trigger fires whenever its Foundry hook fires. A *preset* trigger
 * subscribes to a hook but only fires when a condition is met (e.g. a natural
 * 20 appears in a chat message). This unifies "critical roll" style automation
 * into the same trigger engine instead of a separate subsystem, and makes it
 * easy to add more presets later (first blood, death save, party wipe, ...).
 *
 * Each preset stores its config on the trigger as `presetConfig`. The matcher
 * receives the hook's arguments and that config, and returns true to fire.
 */

function naturalD20(message) {
  for (const roll of message?.rolls ?? []) {
    for (const die of (roll.dice ?? [])) {
      if (die.faces !== 20) continue;
      for (const r of (die.results ?? [])) {
        if (r.active && (r.result === 20 || r.result === 1)) return r.result;
      }
    }
  }
  return null;
}

function isPlayerCharacter(message) {
  const actorId = message?.speaker?.actor;
  const actor = actorId ? game.actors.get(actorId) : null;
  return actor?.type === "character" && actor?.hasPlayerOwner === true;
}

function matchNatural(args, target, cfg) {
  const message = args?.[0];
  if (!message) return false;
  if (naturalD20(message) !== target) return false;
  if (cfg?.pcOnly && !isPlayerCharacter(message)) return false;
  return true;
}

/**
 * @typedef {Object} TriggerPreset
 * @property {string} id
 * @property {string} name
 * @property {string} hook         the Foundry hook to subscribe to
 * @property {string} icon         Font Awesome class
 * @property {string} description
 * @property {(args:any[], cfg:object)=>boolean} match
 * @property {object} defaultConfig
 * @property {string} [blueprint]  companion blueprint id, if any
 */

/** @type {TriggerPreset[]} */
export const TRIGGER_PRESETS = [
  {
    id: "nat20",
    name: "Critical Hit (Natural 20)",
    hook: "createChatMessage",
    icon: "fa-dice-d20",
    description: "Fires when a kept natural 20 is rolled.",
    match: (args, cfg) => matchNatural(args, 20, cfg),
    defaultConfig: { pcOnly: true },
    options: [{ key: "pcOnly", label: "Only player characters (ignore NPC rolls)", default: true }],
    blueprint: "crit-nat20",
    suggestedEntity: "automation.hambience_critical_hit_nat_20"
  },
  {
    id: "nat1",
    name: "Critical Miss (Natural 1)",
    hook: "createChatMessage",
    icon: "fa-dice-one",
    description: "Fires when a kept natural 1 is rolled.",
    match: (args, cfg) => matchNatural(args, 1, cfg),
    defaultConfig: { pcOnly: true },
    options: [{ key: "pcOnly", label: "Only player characters (ignore NPC rolls)", default: true }],
    blueprint: "crit-nat1",
    suggestedEntity: "automation.hambience_critical_miss_nat_1"
  }
];

export function getPresetTrigger(id) {
  return TRIGGER_PRESETS.find(p => p.id === id) ?? null;
}
