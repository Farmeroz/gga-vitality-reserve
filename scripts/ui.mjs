import {
  ID,
  POLICIES,
  escapeHTML as esc,
  findVR,
  trackers,
  detectLevels,
  own,
  integer,
} from './core.mjs';
import { request, setting } from './service.mjs';
export function selectedActor() {
  const selected = canvas?.tokens?.controlled ?? [];
  if (selected.length > 1) throw new Error('Select one token for Vitality Reserve.');
  const actor = selected[0]?.actor ?? game.user.character;
  own(actor, game.user);
  return actor;
}
export async function setup(actor = selectedActor()) {
  own(actor, game.user);
  const root = trackers(actor),
    linked = Object.entries(root).find(([, t]) => t?.gvr?.kind === 'vitality');
  const named = Object.entries(root).find(([, t]) =>
    /^(vitality reserve|vr)$/i.test(t?.name?.trim() ?? ''),
  );
  const existing = linked ?? named;
  const candidates = detectLevels(actor),
    detected = candidates.length === 1 ? candidates[0].level : null;
  const suggested = existing?.[1]?.max ?? detected ?? 0;
  const options = Object.entries(root)
    .filter(([key]) => /^\d+$/.test(key))
    .map(
      ([key, t]) =>
        `<option value="${key}" ${key === existing?.[0] ? 'selected' : ''}>${esc(t.name || `Tracker ${key}`)}</option>`,
    )
    .join('');
  const content = `<div class="gvr-form"><p>Link a standard Resource Tracker to Vitality Reserve. Existing values are retained unless you change them here.</p><p>${candidates.length ? `Sheet: ${candidates.map((c) => `${esc(c.name)}${c.level == null ? ' (enter level manually)' : ''}`).join('; ')}` : 'No clearly named Vitality Reserve advantage found; enter its level below.'}</p><div class="form-group"><label>Tracker</label><select name="key"><option value="" ${existing ? '' : 'selected'}>Create Vitality Reserve tracker</option>${options}</select></div><div class="form-group"><label>Maximum VR</label><input name="maximum" type="number" min="0" step="1" value="${esc(suggested)}"></div><div class="form-group"><label>Current VR</label><input name="current" type="number" min="0" step="1" value="${esc(existing?.[1]?.value ?? suggested)}"></div><p>Check both values before saving. Linking a tracker changes it to a remaining-points pool. Updating the maximum does not automatically refill it.</p></div>`;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `VR setup: ${actor.name}` },
    content,
    buttons: [
      {
        action: 'save',
        label: 'Save tracker',
        default: true,
        callback: (_event, button) => {
          const f = button.form.elements;
          return { key: f.key.value, maximum: f.maximum.value, current: f.current.value };
        },
      },
      { action: 'cancel', label: 'Cancel', callback: () => null },
    ],
    render: (_event, app) => {
      const form = app.element?.querySelector('form') ?? app.element;
      form?.querySelector('[name="key"]')?.addEventListener('change', (e) => {
        const t = root[e.target.value];
        if (t) {
          form.querySelector('[name="maximum"]').value = t.max ?? 0;
          form.querySelector('[name="current"]').value = t.value ?? 0;
        }
      });
    },
    rejectClose: false,
  });
  if (result) return request(actor, { kind: 'setup', input: result, publicly: false });
}
export async function open(actor = selectedActor()) {
  own(actor, game.user);
  let vr;
  try {
    vr = findVR(actor);
  } catch (error) {
    ui.notifications.warn(error.message);
    return setup(actor);
  }
  if (!vr) return setup(actor);
  const content = `<div class="gvr-form"><p><strong>HP ${esc(actor.system.HP.value)}/${esc(actor.system.HP.max)} · VR ${vr.value}/${vr.max}</strong></p><p>Healing: ${esc(POLICIES[setting('healingPolicy')])}.</p><div class="form-group"><label>Operation</label><select name="kind"><option value="heal">Heal (use world policy)</option><option value="damage">Apply injury / HP expenditure</option><option value="recover">Recover VR only</option><option value="spend">Spend VR only</option></select></div><div class="form-group"><label>Amount</label><input name="amount" type="number" value="1" min="0" step="1"></div><label><input name="bypass" type="checkbox"> HP only (bypass VR for injury or healing)</label><label><input name="publicly" type="checkbox" checked> Show result publicly</label><p>Enter final injury after DR and wounding modifiers. Use GGA’s damage dialogue for hit-location effects.</p><p>Natural recovery: roll HT once per day; on success, use Recover VR only for 1 point (Pyramid #3/75, p. 20).</p></div>`;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `Vitality Reserve: ${actor.name}` },
    content,
    buttons: [
      {
        action: 'apply',
        label: 'Apply',
        default: true,
        callback: (_e, b) => {
          const f = b.form.elements;
          return {
            kind: f.kind.value,
            amount: integer(f.amount.value, 'Amount'),
            bypass: f.bypass.checked,
            publicly: f.publicly.checked,
          };
        },
      },
      { action: 'setup', label: 'Set up tracker', callback: () => ({ kind: 'setup' }) },
      { action: 'unlink', label: 'Unlink', callback: () => ({ kind: 'unlink' }) },
      { action: 'cancel', label: 'Cancel', callback: () => null },
    ],
    rejectClose: false,
  });
  if (!result) return;
  if (result.kind === 'setup') return setup(actor);
  if (result.kind === 'unlink') {
    const yes = await foundry.applications.api.DialogV2.confirm({
      window: { title: 'Unlink Vitality Reserve' },
      content:
        '<p>Disable VR automation for this actor? The tracker and its points will remain on the sheet.</p>',
      rejectClose: false,
    });
    if (!yes) return;
  }
  return request(actor, result);
}
export function report(error) {
  console.error(`${ID} |`, error);
  ui.notifications.error(`Vitality Reserve: ${error.message}`);
}
export function installUI() {
  Hooks.on('getActorSheetHeaderButtons', (sheet, buttons) => {
    if (sheet.actor?.isOwner)
      buttons.unshift({
        label: 'VR',
        class: 'gvr-open',
        icon: 'fas fa-heart-circle-plus',
        onclick: () => open(sheet.actor).catch(report),
      });
  });
  registerCommand();
}

export function registerCommand(
  registry = globalThis.GURPS?.ChatProcessors,
  openWindow = open,
  onError = report,
) {
  if (typeof registry?.registerProcessor !== 'function') {
    onError(
      new Error('GGA chat integration is unavailable. Use the VR sheet button or module API.'),
    );
    return false;
  }
  const existing = [...registry.processorsForAll(), ...registry.processorsForGMOnly()];
  if (existing.some((p) => p.matches('/vr'))) {
    onError(new Error('/vr is already registered. Use the VR sheet button or module API.'));
    return false;
  }
  registry.registerProcessor({
    registry: null,
    matches: (line) => /^\/vr(?:\s|$)/i.test(String(line).trim()),
    usagematches: () => false,
    help: () => '/vr – open Vitality Reserve',
    isGMOnly: () => false,
    async process() {
      try {
        await openWindow();
      } catch (error) {
        onError(error);
      }
      return true;
    },
  });
  return true;
}
