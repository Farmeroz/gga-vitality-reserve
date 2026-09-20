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
    audit: calculationText(results),
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
  const root = html?.[0] ?? html;
  if (!root?.querySelector) return;
  // Render hooks can run for both the concrete class and its base classes.
  // Remove only our nodes and always mount INSIDE GGA's content, never the frame.
  root
    .querySelectorAll('.gvr-add-panel, .gvr-controls, .gvr-bypass, .gvr-result-cell')
    .forEach((node) => node.remove());
  const calc = dialog._calculator;
  const input = root.querySelector('#result-apply-injury');
  if (input) input.value = String(calc.pointsToApply);
  if (!setting('enabled') || calc.resource?.[1] !== 'system.HP') return;
  const vr = findVR(dialog.actor);
  if (!vr) return;
  const amount = Math.max(0, Number(calc.pointsToApply) || 0);
  const spent = dialog._gvrBypass ? 0 : Math.min(vr.value, amount);
  const hpLoss = amount - spent;
  const content = root.matches?.('.gga-app') ? root : root.querySelector('.gga-app');
  if (!content) return;
  const doc = content.ownerDocument;
  const controls = doc.createElement('div');
  controls.className = 'gvr-controls';
  controls.innerHTML = `<span>VR <strong>${vr.value}/${vr.max}</strong> · HP ${esc(dialog.actor.system.HP.value)}/${esc(dialog.actor.system.HP.max)}</span>`;
  const bypass = doc.createElement('label');
  bypass.className = 'gvr-bypass';
  bypass.title = 'Apply injury to HP without spending VR. Applies to direct and calculated injury.';
  bypass.innerHTML = `<input type="checkbox" ${dialog._gvrBypass ? 'checked' : ''}> Bypass VR (apply injury to HP)`;
  const direct = content.querySelector('#apply-to');
  const damageRow = content.querySelector('#basicDamage')?.parentElement;
  if (damageRow) damageRow.insertAdjacentElement('afterend', bypass);
  else if (direct?.parentElement) direct.parentElement.append(bypass);
  else controls.append(bypass);
  const apply = content.querySelector('.apply-results');
  if (input && apply) {
    input.value = `${hpLoss} HP + ${spent} VR`;
    input.title = `${amount} total injury. Split for the next application using the current reserve.`;
    input.setAttribute('aria-label', 'Injury split between HP and Vitality Reserve');
    input.insertAdjacentElement('afterend', controls);
  } else {
    // Simple ADD: put the small control beside its existing direct-apply area.
    const direct = content.querySelector('#apply-to');
    if (direct?.parentElement) direct.parentElement.append(controls);
    else return;
  }
  const table = content.querySelector('.results-table.gurps-3col');
  if (table) {
    const injuryLabel = game.i18n.localize('GURPS.addInjury');
    for (const cell of table.children)
      if (cell.textContent.trim() === injuryLabel) {
        cell.textContent = `${injuryLabel} (before VR)`;
        break;
      }
    for (const [label, value, detail] of [
      ['VR absorbed', spent, dialog._gvrBypass ? 'Bypassed' : `${vr.value} available`],
      ['HP injury', hpLoss, `${amount} − ${spent}`],
    ])
      for (const text of [label, value, detail]) {
        const cell = doc.createElement('div');
        cell.className = 'gvr-result-cell';
        cell.textContent = String(text);
        table.append(cell);
      }
  }
  bypass.querySelector('input').addEventListener('change', (event) => {
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

export function calculationText(html) {
  if (!html) return '';
  const holder = document.createElement('div');
  holder.innerHTML = html;
  for (const element of holder.querySelectorAll('script,style,button,.gvr-controls'))
    element.remove();
  const clean = (node) => node.textContent.replace(/\s+/g, ' ').trim();
  const lines = [],
    cells = [];
  const flush = () => {
    if (cells.length) lines.push(cells.splice(0).join(' | '));
  };
  for (const element of holder.children) {
    if (element.matches('.armour-report')) {
      flush();
      for (const row of element.querySelectorAll('p,tr')) {
        const columns = [...row.querySelectorAll('th,td')];
        const text = columns.length ? columns.map(clean).join(' | ') : clean(row);
        if (text) lines.push(text);
      }
    } else if (element.tagName === 'DIV' && !element.querySelector('table')) {
      cells.push(clean(element));
      if (cells.length === 3) {
        const [label, value, detail] = cells.splice(0);
        lines.push(`${label}: ${value}${detail ? ` · ${detail}` : ''}`);
      }
    } else {
      flush();
      const text = clean(element);
      if (text) lines.push(text);
    }
  }
  flush();
  return (lines.length ? lines.join('\n') : clean(holder)).slice(0, 20000);
}
