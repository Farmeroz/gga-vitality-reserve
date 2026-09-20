import { ID, findVR, escapeHTML as esc, integer } from './core.mjs';
import { installEffects } from './effects.mjs';
import { setting, request } from './service.mjs';
function state(dialog) {
  if (!setting('enabled') || dialog._gvrBypass || dialog._calculator?.resource?.[1] !== 'system.HP')
    return null;
  const vr = findVR(dialog.actor);
  return vr ? { vr: vr.value, crippling: setting('cripplingPolicy') } : null;
}
export function prepare(dialog) {
  if (!state(dialog)) return;
  installEffects(dialog._calculator, () => state(dialog));
}
export async function resolve(wrapped, keepOpen, injury, publicly, results = null) {
  const vr = setting('enabled') ? findVR(this.actor) : null;
  if (!vr || this._calculator.resource?.[1] !== 'system.HP')
    return wrapped(keepOpen, injury, publicly, results);
  integer(injury, 'Injury');
  prepare(this);
  const result = await request(this.actor, {
    kind: 'damage',
    amount: injury,
    bypass: !!this._gvrBypass,
    publicly,
    label: `Injury (${this._calculator.hitLocation || 'unspecified location'})`,
  });
  // Preserve GGA's last-injury bookkeeping for macros. The split is explicit.
  const data = {
    id: foundry.utils.randomID(),
    injury: -result.hpChange,
    totalInjury: injury,
    vitalitySpent: -result.vrChange,
    defender: this.actor.name,
    current: result.before.hp,
    location: this._calculator.hitLocation,
    type: 'HP',
    actorUuid: this.actor.uuid,
  };
  GURPS.lastInjuryRoll = data;
  GURPS.lastInjuryRolls ??= {};
  GURPS.lastInjuryRolls[this.actor.id] = data;
  if (keepOpen) this.render(false);
  else await this.close();
  return result;
}
export function enhanceDialog(dialog, html) {
  if (!setting('enabled') || !findVR(dialog.actor)) return;
  const root = html?.[0] ?? html;
  if (!root?.querySelector || root.querySelector('.gvr-add-panel')) return;
  const vr = findVR(dialog.actor),
    hp = dialog.actor.system.HP;
  const panel = document.createElement('section');
  panel.className = 'gvr-add-panel';
  const amount = Math.max(0, Number(dialog._calculator.pointsToApply) || 0),
    spent = dialog._gvrBypass ? 0 : Math.min(vr.value, amount);
  panel.innerHTML = `<strong>Vitality Reserve ${vr.value}/${vr.max}</strong> · HP ${esc(hp.value)}/${esc(hp.max)}<p>Calculated injury ${amount}: VR −${spent}, HP −${amount - spent}. Each additional application uses the remaining reserve.</p><label><input type="checkbox" class="gvr-bypass" ${dialog._gvrBypass ? 'checked' : ''}> Bypass VR for this dialogue (HP only)</label><p>Injury effects below use remaining HP injury. Physical knockback is unchanged. ${setting('cripplingPolicy') === 'original' ? 'Original GGA crippling assessment retained.' : 'Crippling uses HP injury only.'}</p>`;
  root.prepend(panel);
  panel.querySelector('input').addEventListener('change', (event) => {
    dialog._gvrBypass = event.target.checked;
    dialog.render(false);
  });
}
export function installAdapter() {
  const klass = globalThis.GURPS?.ApplyDamageDialog;
  if (
    !/^0\.18\./.test(game.system.version) ||
    !klass?.prototype?.resolveInjury ||
    !globalThis.libWrapper?.register
  )
    throw new Error('VR requires GGA 0.18.x and libWrapper.');
  libWrapper.register(
    ID,
    'GURPS.ApplyDamageDialog.prototype.getData',
    async function (wrapped, ...args) {
      prepare(this);
      return wrapped(...args);
    },
    'WRAPPER',
  );
  libWrapper.register(ID, 'GURPS.ApplyDamageDialog.prototype.resolveInjury', resolve, 'MIXED');
  Hooks.on('renderApplication', (app, html) => {
    if (app instanceof klass) {
      try {
        enhanceDialog(app, html);
      } catch (error) {
        ui.notifications.error(`Vitality Reserve: ${error.message}`);
      }
    }
  });
}
