/**
 * Curated, non-exhaustive list of Foundry + common-module hooks that make
 * sense as Home Assistant triggers. Users can also type any custom hook name.
 */
export const COMMON_HOOKS = [
  { id: "combatStart", label: "Combat - Encounter Started" },
  { id: "combatRound", label: "Combat - New Round" },
  { id: "combatTurn", label: "Combat - Turn Changed" },
  { id: "combatTurnChange", label: "Combat - Turn Change (v13+)" },
  { id: "deleteCombat", label: "Combat - Encounter Ended" },
  { id: "updateCombat", label: "Combat - Updated" },

  { id: "createChatMessage", label: "Chat - Message Created" },
  { id: "dnd5e.rollAttack", label: "dnd5e - Attack Rolled" },
  { id: "dnd5e.rollDamage", label: "dnd5e - Damage Rolled" },
  { id: "dnd5e.rollAbilitySave", label: "dnd5e - Saving Throw Rolled" },
  { id: "dnd5e.rollSkill", label: "dnd5e - Skill Rolled" },
  { id: "midi-qol.RollComplete", label: "MIDI QoL - Workflow Complete" },
  { id: "diceSoNiceRollComplete", label: "Dice So Nice - Roll Animation Done" },

  { id: "updateActor", label: "Actor - Updated (HP, conditions, etc.)" },
  { id: "updateToken", label: "Token - Updated" },
  { id: "targetToken", label: "Token - Targeted" },
  { id: "controlToken", label: "Token - Controlled" },

  { id: "canvasReady", label: "Scene - Canvas Ready" },
  { id: "updateScene", label: "Scene - Updated" },

  { id: "pauseGame", label: "Game - Paused / Unpaused" },
  { id: "ready", label: "Game - Ready" }
];

export function getAllHooks() {
  return COMMON_HOOKS;
}
