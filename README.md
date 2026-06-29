# HAmbience

**Bridge your Foundry VTT scenes and game events to your physical game room through Home Assistant.**

HAmbience lets a GM author the experience inside Foundry while Home Assistant does what it does best: orchestrating the lights, sound, and devices in the real world. Link a scene to a Home Assistant script and your room changes when you change scenes. Roll a natural 20 and your lights celebrate. It is a bridge, not a replacement for Home Assistant.

By **S0rce Code**.

---

## Features

- **Scene-Level Integration.** Assign a Home Assistant entity (scene, script, or automation) to any Foundry scene from a dedicated HAmbience tab. Activating the scene for players triggers the matching state in your home.
- **IRL Ambience presets and blueprints.** Tabletop-flavored starting points (Tavern, Dungeon, Forest, Temple, Boss, Campfire, Storm) generated as Home Assistant automation blueprints you import and customize natively.
- **Critical Roll Automation.** A built-in "Critical Hit (Natural 20)" and "Critical Miss (Natural 1)" preset trigger you select when creating a trigger. Optional player-character-only filtering. Includes companion blueprints that pair a slow light flash with an optional sound.
- **Configurable Triggers.** Fire Home Assistant from any Foundry hook with your own JSON payload, a point-and-click builder, optional debounce, and optional macro execution.
- **Entity Discovery.** With a read-only long-lived access token, browse and search your actual Home Assistant entities. Filter by label (recommended), entity type, or all.
- **Macro Library.** Standalone hotbar macros that fire Home Assistant from a button.
- **GM Toggle Control.** A Scene Controls button to pause or resume the integration at any time.
- **Game Status Sync.** Toggle a Home Assistant entity (such as a "Game Active" boolean) when your session starts and ends.
- **Public API.** Other modules can fire Home Assistant through HAmbience via `game.modules.get("hambience").api` or the `hambience.fire` hook.

## Requirements

- Foundry VTT v13 or v14.
- A Home Assistant instance reachable from where Foundry runs.
- For entity discovery: a Home Assistant long-lived access token and a CORS allowance for your Foundry origin (the module shows you the exact YAML).

## Quick start

1. Enable HAmbience in your world.
2. Open **Game Settings, HAmbience, Connection**.
3. Click **Generate HA Receiver Automation**. This creates the Home Assistant automation that receives HAmbience calls, with a unique private webhook id, and fills in your Webhook URL. Import the downloaded YAML into Home Assistant.
4. Click **Test** to confirm the round trip.
5. Optionally switch to **Webhook + HA token** mode and add your token to unlock entity discovery and the searchable pickers.

## Critical rolls

Create a trigger and choose the **Critical Hit (Natural 20)** or **Critical Miss (Natural 1)** preset. The preset supplies the detection; you point it at any Home Assistant entity to fire. Import `blueprints/crit-nat20.yaml` and `blueprints/crit-nat1.yaml` for a ready-made effect that flashes your lights and optionally plays a sound, then point the preset trigger at the automation each one creates.

## Support

HAmbience is free and always will be. If it adds something to your table and you would like to support continued development, a coffee is hugely appreciated: https://buymeacoffee.com/s0rcecode

The blueprints and presets are a small thank-you, not a paywall.

## Disclaimer

HAmbience is an independent community module and is not affiliated with, endorsed by, or sponsored by Foundry Virtual Tabletop, Home Assistant, Nabu Casa, or the Open Home Foundation.

## License

HAmbience is licensed under the GNU General Public License v3.0 or later. See the LICENSE file for the full text.
