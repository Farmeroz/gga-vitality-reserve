import {
  ID,
  TRACKERS,
  escapeHTML as esc,
  own,
  findVR,
  readPools,
  route,
  setupUpdate,
  queueByKey,
} from './core.mjs';
export const enqueue = queueByKey();
export const setting = (key) => game.settings.get(ID, key);
export function activeGM() {
  return [...game.users]
    .filter((u) => u.active && u.isGM)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
}
export function assertEnabled() {
  if (!setting('enabled')) throw new Error('Vitality Reserve is disabled.');
}
export function renderResult(actor, result, label = '') {
  if (result.kind === 'setup')
    return `<p><strong>${esc(actor.name)}:</strong> Vitality Reserve tracker configured.</p>`;
  if (result.kind === 'unlink')
    return `<p><strong>${esc(actor.name)}:</strong> VR automation unlinked; tracker values retained.</p>`;
  const delta = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n)}`;
  return `<div class="gvr-result"><strong>${esc(actor.name)} · ${esc(label || { damage: 'Injury', heal: 'Healing', recover: 'VR recovery', spend: 'VR expenditure' }[result.kind])}</strong><p>${result.amount} points: HP ${delta(result.hpChange)}, VR ${delta(result.vrChange)}.</p><p>HP ${result.before.hp} → ${result.after.hp}; VR ${result.before.vr} → ${result.after.vr}.${result.unused ? ` Unused: ${result.unused}.` : ''}</p></div>`;
}
export async function perform(actor, request, user) {
  own(actor, user);
  assertEnabled();
  return enqueue(actor.uuid, async () => {
    own(actor, user);
    let result, update;
    if (request.kind === 'setup') {
      update = setupUpdate(actor, request.input);
      result = { kind: 'setup' };
    } else if (request.kind === 'unlink') {
      update = {};
      for (const [key, t] of Object.entries(actor.system?.additionalresources?.tracker ?? {}))
        if (t?.gvr?.kind === 'vitality' && /^\d+$/.test(key))
          update[`${TRACKERS}.${key}.-=gvr`] = null;
      result = { kind: 'unlink' };
    } else {
      const pools = readPools(actor);
      if (
        !request.expected ||
        ['hp', 'hpMax', 'vr', 'vrMax'].some((k) => request.expected[k] !== pools[k])
      )
        throw new Error(
          'HP or VR changed since this action was prepared. Review the current values and try again.',
        );
      result = route(
        pools,
        request.kind,
        request.amount,
        setting('healingPolicy'),
        request.bypass === true,
      );
      const vr = findVR(actor);
      update = { 'system.HP.value': result.after.hp, [`${vr.path}.value`]: result.after.vr };
    }
    // Both pools are updated together; do not intercept unrelated sheet edits.
    await actor.update(update);
    return result;
  });
}
const waiters = new Map(),
  handled = new Set();
function authorId(message) {
  return message.author?.id ?? message.user?.id ?? message.user;
}
function settle(message) {
  const receipt = message.getFlag(ID, 'receipt');
  const waiting = waiters.get(message.id);
  if (!receipt || !waiting) return;
  waiters.delete(message.id);
  clearTimeout(waiting.timer);
  if (receipt.ok) waiting.resolve(receipt.result);
  else waiting.reject(new Error(receipt.error));
}
async function processRequest(message) {
  const request = message.getFlag(ID, 'request');
  if (
    !request ||
    message.getFlag(ID, 'receipt') ||
    activeGM()?.id !== game.user.id ||
    handled.has(message.id)
  )
    return;
  handled.add(message.id);
  if (handled.size > 1000) handled.delete(handled.values().next().value);
  let actor, receipt, content;
  try {
    const user = game.users.get(authorId(message));
    if (!user) throw new Error('Request author is unavailable.');
    actor = await fromUuid(request.actorUuid);
    const result = await perform(actor, request, user);
    receipt = { ok: true, result };
    content = renderResult(actor, result, request.label);
  } catch (error) {
    receipt = { ok: false, error: error.message };
    content = `<p>Vitality Reserve: ${esc(error.message)}</p>`;
  }
  try {
    await message.update({
      content,
      [`flags.${ID}.receipt`]: receipt,
      ...(receipt.ok && request.publicly ? { whisper: [] } : {}),
    });
  } catch (error) {
    console.error(`${ID} | Receipt failed after processing; do not repeat blindly.`, error);
    ui.notifications.error(
      'VR request processed, but its receipt could not be saved. Inspect HP/VR before repeating.',
    );
  }
  settle(message);
}
export function installRequests() {
  Hooks.on('createChatMessage', (message) => {
    processRequest(message).catch((error) => console.error(`${ID} |`, error));
  });
  Hooks.on('updateChatMessage', (message) => settle(message));
}
export async function request(actor, operation) {
  own(actor, game.user);
  assertEnabled();
  const payload = { ...operation, actorUuid: actor.uuid };
  if (!['setup', 'unlink'].includes(payload.kind)) payload.expected = readPools(actor);
  // Without an active GM, only the local owner performs the action. An expected
  // snapshot still catches stale locally queued requests.
  if (!activeGM()) {
    const result = await perform(actor, payload, game.user);
    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: renderResult(actor, result, payload.label),
        whisper: payload.publicly
          ? []
          : [game.user.id, ...game.users.filter((u) => u.isGM).map((u) => u.id)],
      });
    } catch (error) {
      console.error(`${ID} | Chat failed after update`, error);
      ui.notifications.warn(
        'HP/VR updated, but the chat result failed. Do not apply the action again.',
      );
    }
    return result;
  }
  // Chat document authorship is server-controlled, unlike a custom socket's
  // claimed userId. The GM validates that author before changing any actor.
  const message = await ChatMessage.create({
    content: `<p>Vitality Reserve: processing ${esc(payload.kind)} for ${esc(actor.name)}…</p>`,
    whisper: [...new Set([game.user.id, ...game.users.filter((u) => u.isGM).map((u) => u.id)])],
    flags: { [ID]: { request: payload } },
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(message.id);
      reject(
        new Error(
          'VR request timed out. Check its chat receipt and current HP/VR before retrying.',
        ),
      );
    }, 30000);
    waiters.set(message.id, { resolve, reject, timer });
    settle(message);
    // Handles the creating GM too, regardless of hook dispatch timing.
    processRequest(message).catch((error) => console.error(`${ID} |`, error));
  });
}
