export const ID = 'gga-vitality-reserve';
export const TRACKERS = 'system.additionalresources.tracker';
export const POLICIES = {
  hp: 'HP first, then VR',
  vr: 'VR first, then HP',
  none: 'Healing cannot restore VR',
};
export const normalise = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase();
export const escapeHTML = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function integer(value, label, min = 0) {
  if (value === '' || value == null || typeof value === 'boolean')
    throw new Error(`${label} must be a whole number.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min)
    throw new Error(`${label} must be a whole number of at least ${min}.`);
  return n;
}
export function signed(value, label) {
  return integer(value, label, -Number.MAX_SAFE_INTEGER);
}
export function own(actor, user) {
  if (
    !actor ||
    actor.documentName !== 'Actor' ||
    (!user?.isGM && !actor.testUserPermission(user, 'OWNER'))
  )
    throw new Error('You must own this actor or be a GM.');
}
export function trackers(actor) {
  return actor.system?.additionalresources?.tracker ?? {};
}
export function findVR(actor) {
  const all = Object.entries(trackers(actor)).filter(([, t]) => t?.gvr?.kind === 'vitality');
  if (all.length > 1)
    throw new Error('Multiple linked Vitality Reserves found. Unlink the duplicates in VR setup.');
  if (!all.length) return null;
  const [key, tracker] = all[0];
  if (!/^\d+$/.test(key)) throw new Error('VR tracker has an invalid slot.');
  if (tracker.isDamageTracker)
    throw new Error('VR must be a remaining-points pool, not a damage tally.');
  const max = integer(tracker.max, 'VR maximum'),
    value = integer(tracker.value, 'Current VR');
  if (value > max) throw new Error('Current VR exceeds its maximum. Correct the tracker first.');
  return { key, tracker, max, value, path: `${TRACKERS}.${key}` };
}
export function readPools(actor) {
  const vr = findVR(actor);
  if (!vr) throw new Error('Set up a Vitality Reserve tracker first.');
  return {
    hp: signed(actor.system?.HP?.value, 'Current HP'),
    hpMax: integer(actor.system?.HP?.max, 'Maximum HP', 1),
    vr: vr.value,
    vrMax: vr.max,
  };
}
export function route(pools, kind, amount, policy = 'hp', bypass = false) {
  amount = integer(amount, 'Amount');
  let { hp, hpMax, vr, vrMax } = pools;
  signed(hp, 'Current HP');
  integer(hpMax, 'Maximum HP', 1);
  integer(vr, 'Current VR');
  integer(vrMax, 'Maximum VR');
  if (vr > vrMax) throw new Error('Current VR exceeds its maximum.');
  if (!Object.hasOwn(POLICIES, policy)) throw new Error('Unknown healing policy.');
  let remaining = amount;
  const healHP = () => {
    const n = Math.min(remaining, Math.max(0, hpMax - hp));
    hp += n;
    remaining -= n;
  };
  const healVR = () => {
    const n = Math.min(remaining, vrMax - vr);
    vr += n;
    remaining -= n;
  };
  if (kind === 'damage') {
    const absorbed = bypass ? 0 : Math.min(vr, remaining);
    vr -= absorbed;
    remaining -= absorbed;
    hp -= remaining;
    remaining = 0;
  } else if (kind === 'heal') {
    if (!bypass && policy === 'vr') healVR();
    healHP();
    if (!bypass && policy === 'hp') healVR();
  } else if (kind === 'recover') healVR();
  else if (kind === 'spend') {
    if (amount > vr) throw new Error('Not enough VR for that expenditure.');
    vr -= amount;
    remaining = 0;
  } else throw new Error('Unknown VR operation.');
  signed(hp, 'Resulting HP');
  integer(vr, 'Resulting VR');
  return {
    before: { hp: pools.hp, vr: pools.vr },
    after: { hp, vr },
    hpChange: hp - pools.hp,
    vrChange: vr - pools.vr,
    unused: remaining,
    amount,
    kind,
  };
}
export function detectLevels(actor) {
  const found = [];
  const walk = (entries) => {
    for (const a of Object.values(entries ?? {})) {
      if (!a || typeof a !== 'object') continue;
      const name = String(a.name ?? '').trim();
      if (/^vitality reserve\b/i.test(name)) {
        const explicit = a.levels ?? a.level;
        const match = name.match(/^vitality reserve\s+(\d+)\b/i);
        const raw = explicit !== undefined && explicit !== '' ? explicit : match?.[1];
        const level = Number(raw);
        found.push({
          name,
          level: raw != null && Number.isSafeInteger(level) && level >= 0 ? level : null,
        });
      }
      walk(a.contains);
      walk(a.collapsed);
    }
  };
  walk(actor.system?.ads);
  return found;
}
export function setupUpdate(actor, { key = '', maximum, current }) {
  maximum = integer(maximum, 'Maximum VR');
  current = integer(current, 'Current VR');
  if (current > maximum) throw new Error('Current VR cannot exceed maximum VR.');
  const root = trackers(actor),
    updates = {};
  if (key && (!/^\d+$/.test(key) || !Object.hasOwn(root, key)))
    throw new Error('Selected tracker no longer exists.');
  if (!key) {
    if (
      Object.values(root).some(
        (t) =>
          t?.gvr?.kind === 'vitality' || ['vitality reserve', 'vr'].includes(normalise(t?.name)),
      )
    )
      throw new Error('A VR tracker already exists. Select it instead of creating another.');
    key = String(
      Math.max(
        -1,
        ...Object.keys(root)
          .filter((k) => /^\d+$/.test(k))
          .map(Number),
      ) + 1,
    ).padStart(4, '0');
  }
  for (const [slot, t] of Object.entries(root))
    if (t?.gvr?.kind === 'vitality' && slot !== key) updates[`${TRACKERS}.${slot}.-=gvr`] = null;
  updates[`${TRACKERS}.${key}`] = {
    ...root[key],
    name: root[key]?.name || 'Vitality Reserve',
    alias: root[key]?.alias || 'VR',
    value: current,
    max: maximum,
    min: 0,
    points: root[key]?.points ?? 0,
    pdf: 'PY3/75:20',
    isDamageTracker: false,
    isDamageType: false,
    isMinimumEnforced: true,
    isMaximumEnforced: true,
    thresholds: [],
    gvr: { kind: 'vitality', version: 1 },
  };
  return updates;
}
export function injuryAllocation(amounts, available) {
  let vr = integer(available, 'Current VR');
  return amounts.map((amount) => {
    amount = integer(amount, 'Injury');
    const absorbed = Math.min(vr, amount);
    vr -= absorbed;
    return { amount, absorbed, hp: amount - absorbed };
  });
}
export function queueByKey() {
  const pending = new Map();
  return (key, operation) => {
    const next = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
    pending.set(key, next);
    return next.finally(() => {
      if (pending.get(key) === next) pending.delete(key);
    });
  };
}
