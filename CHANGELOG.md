# Changelog

All notable changes to HAmbience will be documented here.

## [1.8.3]

### Added
- Open in HA button restored to the trigger editor preset blueprint section
- Suggested entity pre-filled in payload when a preset is selected (e.g. `automation.hambience_critical_hit_nat_20`)
- Hint text showing the expected entity id after blueprint import

### Changed
- Crit blueprint sound input now uses HA's media selector instead of a plain text field

## [1.8.2]

### Fixed
- GM Toggle now correctly reflects active/paused state via highlight
- GM Toggle registers during `init` instead of `ready` so it appears on first canvas load without requiring a scene switch
- Scene Controls button uses standard Foundry toggle behavior with a concise "Toggle HAmbience" label

## [1.8.0]

### Added
- GM Toggle visual state: icon highlighted when active, dimmed when paused

## [1.7.9]

### Fixed
- GM Toggle now appears on initial world load without requiring a scene switch

## [1.7.7]

### Fixed
- GM Toggle now correctly uses the v14 `getSceneControlButtons` API (`controls.tokens.tools` record structure)

## [1.7.3]

### Added
- Gitea Actions release pipeline with manifest URL in release notes
- Per-user webhook receiver blueprint generation with unique webhook id
- Automated release asset upload via Gitea REST API (DEV ONLY)

## [1.7.1] - Initial Public Release

### Features
- Scene-Level Integration: link any Foundry scene to a Home Assistant script, automation, or scene that fires on activation
- IRL Ambience tab on every scene with preset blueprints (Tavern, Dungeon, Forest, Temple, Boss, Campfire, Storm)
- Critical Roll Automation: preset triggers for Natural 20 and Natural 1 with companion light-and-sound blueprints
- Configurable Triggers: fire Home Assistant from any Foundry hook with a point-and-click payload builder
- Entity Discovery: browse HA entities via a read-only token with label, domain, or all filtering
- Macro Library: standalone hotbar macros that fire Home Assistant
- GM Toggle Control: Scene Controls button to pause or resume the integration
- Game Status Sync: toggle an HA entity when your session starts and ends
- Public API: other modules can dispatch through HAmbience via `game.modules.get("hambience").api` or the `hambience.fire` hook
- Generate HA Receiver Automation with a unique private webhook id from the Connection settings
- CORS YAML helper showing your exact Foundry origin to paste into Home Assistant
