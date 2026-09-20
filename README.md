# GGA Vitality Reserve

Vitality Reserve for **GURPS Fourth Edition**, based on _Pyramid #3/75_, p. 20. VR absorbs supported HP injury before HP is lost. Healing has three GM-selectable policies: HP first then VR, VR first then HP, or HP only.

Requires Foundry VTT 14+, GURPS Game Aid 0.18.23 (the adapter supports the 0.18.x API), and libWrapper. GGA's native Apply Damage Dialogue and GURPS Manual Damage use the same integration. No upper Foundry version is imposed; compatibility with future major releases is not implied.

## Getting started

1. Enable the module and libWrapper in your GURPS world.
2. Open a character sheet and click **VR**, or select one token and enter **/vr** in chat.
3. Create or link its Vitality Reserve tracker. Review the maximum and current values before saving.
4. Apply injury through GGA's ADD. Use **/vr** for healing or separate VR recovery.

See [USER_GUIDE.md](USER_GUIDE.md) for the controls, examples, and integration boundaries.

## Rules and interpretation

The source gives VR its own natural recovery: one point per day on a successful HT roll, regardless of conditions. VR expenditure does not cause shock, knockdown, unconsciousness, or death. The external-healing policies and the explicit crippling setting are campaign choices; the short source paragraph does not specify them. GGA continues to determine DR, injury modifiers, location caps, and physical knockback. HP thresholds use actual HP; VR never raises maximum HP.

Only injury that reaches HP contributes to injury effects by default. The alternate crippling policy retains GGA's original crippling assessment, while suppressing shock and knockdown from VR expenditure. These policies are deliberately labelled rather than presented as additional published rules.

## Supported operations

- Standard Resource Tracker setup, conservative advantage-level detection, and manual values.
- GGA native ADD, including secret applications, multiple applications, and the Manual Damage subclass.
- Sequential allocation across hits; remaining VR drives shock, major-wound, and head-hit advice.
- Explicit healing, HP-only bypass, VR-only recovery, and VR expenditure.
- Linked actors and unlinked token actors, without updating the wrong actor.
- Owner/GM permissions and one active GM processing requests in order. Stale HP/VR snapshots are rejected rather than overwriting a more recent operation.

Sheet corrections, GGA `/hp` commands, and unrelated modules' direct HP writes remain direct edits. Casting Assistant's existing healing button is not automatically intercepted: it caps healing at HP maximum and has its own undo ledger. Use this module's Heal operation for VR-aware healing until Casting Assistant calls the API below.

## API

```js
const vr = game.modules.get('gga-vitality-reserve').api;
await vr.open(); // Selected token, or assigned character if none selected
await vr.setup(actor);
await vr.damage(actor, 8, { publicly: true }); // Final injury, not basic damage
await vr.heal(actor, 7, { publicly: true });
await vr.heal(actor, 7, { bypass: true }); // HP only
await vr.recover(actor, 1); // VR only, after resolving natural recovery
await vr.spend(actor, 2); // VR only; refuses expenditure greater than available VR
```

API operations enforce actor ownership (or GM status) and use the world healing policy. They return before/after pool values, HP and VR changes, and unused healing. They do not undo another module's ledger, roll damage, or calculate hit-location effects. Omitted `publicly` means a private result. Do not retry a timed-out operation without checking its chat receipt and actor pools.

## Development

```sh
npm ci
npm run test:setup
npm run check
```

Tests execute the real GGA 0.18.23 damage-calculator class bodies, pinned to commit `90ca003f68e8dd5e66de44de5c9ea76c9f463364`. Foundry-facing globals are stubbed. The suite also exercises routing invariants, permissions, request handling, tracker setup, and stale-operation rejection. A running Foundry world remains the final integration check.

`npm run build` produces a clean installable ZIP and manifest in `dist/`. The release workflow checks the build before publishing a version on `main`. Do not include upstream GGA source or the Pyramid PDF in release files.

GURPS is a trademark of Steve Jackson Games. This unofficial software does not reproduce the source article. Code is MIT licensed.

## Version 0.1.1

Registers `/vr` with GGA’s command processor, including Foundry v14 formatted chat input and OtF commands. When using Layered Armour, install version 0.2.3 or later as well; that update moves its ADD methods to libWrapper and keeps armour review ahead of VR routing in either load order. Armour calculation details are retained in the VR chat result.
