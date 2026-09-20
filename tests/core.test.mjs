import test from 'node:test';
import assert from 'node:assert/strict';
import {
  route,
  setupUpdate,
  findVR,
  detectLevels,
  injuryAllocation,
  own,
  escapeHTML,
  queueByKey,
} from '../scripts/core.mjs';
const pools = { hp: 10, hpMax: 12, vr: 5, vrMax: 5 };
const actor = () => ({
  uuid: 'Actor.a',
  documentName: 'Actor',
  testUserPermission: () => true,
  system: {
    HP: { value: 10, max: 12 },
    ads: {},
    additionalresources: {
      tracker: {
        '0000': { name: 'Vitality Reserve', value: 5, max: 5, gvr: { kind: 'vitality' } },
      },
    },
  },
});
const cases = [
  ['damage absorbed', 'damage', 3, 'hp', false, { hp: 10, vr: 2 }],
  ['damage spills', 'damage', 8, 'hp', false, { hp: 7, vr: 0 }],
  ['damage bypass', 'damage', 8, 'hp', true, { hp: 2, vr: 5 }],
  ['zero injury', 'damage', 0, 'hp', false, { hp: 10, vr: 5 }],
  ['HP can go negative', 'damage', 30, 'hp', false, { hp: -15, vr: 0 }],
  ['healing capped', 'heal', 50, 'hp', false, { hp: 12, vr: 5 }],
  ['VR-only recovery', 'recover', 8, 'none', false, { hp: 10, vr: 5 }],
  ['VR-only spending', 'spend', 5, 'hp', false, { hp: 10, vr: 0 }],
];
for (const [name, kind, n, policy, bypass, expected] of cases)
  test(name, () => assert.deepEqual(route(pools, kind, n, policy, bypass).after, expected));
for (const [policy, expected] of [
  ['hp', { hp: 12, vr: 2 }],
  ['vr', { hp: 9, vr: 5 }],
  ['none', { hp: 12, vr: 0 }],
])
  test(`healing policy ${policy}`, () =>
    assert.deepEqual(
      route({ hp: 7, hpMax: 12, vr: 0, vrMax: 5 }, 'heal', 7, policy).after,
      expected,
    ));
test('HP-only healing bypasses VR-first', () =>
  assert.deepEqual(route({ hp: 7, hpMax: 12, vr: 0, vrMax: 5 }, 'heal', 7, 'vr', true).after, {
    hp: 12,
    vr: 0,
  }));
test('heals from negative HP', () =>
  assert.deepEqual(route({ hp: -5, hpMax: 12, vr: 0, vrMax: 5 }, 'heal', 20).after, {
    hp: 12,
    vr: 3,
  }));
test('healing never lowers over-max HP', () =>
  assert.deepEqual(route({ ...pools, hp: 15, vr: 0 }, 'heal', 3).after, { hp: 15, vr: 3 }));
for (const n of [-1, 1.5, NaN, Infinity, '', null, true])
  test(`reject invalid amount ${String(n)}`, () => assert.throws(() => route(pools, 'damage', n)));
test('overspending VR does not consume HP', () => assert.throws(() => route(pools, 'spend', 6)));
test('unknown policies rejected', () => assert.throws(() => route(pools, 'heal', 1, 'bogus')));
test('sequential hits use remaining VR', () =>
  assert.deepEqual(injuryAllocation([3, 4, 6], 5), [
    { amount: 3, absorbed: 3, hp: 0 },
    { amount: 4, absorbed: 2, hp: 2 },
    { amount: 6, absorbed: 0, hp: 6 },
  ]));
test('tracker identity survives reindexing', () => {
  const a = actor();
  a.system.additionalresources.tracker['0009'] = a.system.additionalresources.tracker['0000'];
  delete a.system.additionalresources.tracker['0000'];
  assert.equal(findVR(a).key, '0009');
});
test('duplicate tagged pools rejected', () => {
  const a = actor();
  a.system.additionalresources.tracker['0001'] = structuredClone(
    a.system.additionalresources.tracker['0000'],
  );
  assert.throws(() => findVR(a), /Multiple/);
});
test('damage tally rejected', () => {
  const a = actor();
  a.system.additionalresources.tracker['0000'].isDamageTracker = true;
  assert.throws(() => findVR(a), /tally/);
});
test('does not silently create duplicate named VR', () =>
  assert.throws(() => setupUpdate(actor(), { maximum: 5, current: 5 }), /already exists/));
test('link keeps chosen current value', () => {
  const updates = setupUpdate(actor(), { key: '0000', maximum: 8, current: 2 });
  assert.equal(updates['system.additionalresources.tracker.0000'].value, 2);
});
test('unsafe tracker paths rejected', () =>
  assert.throws(() => setupUpdate(actor(), { key: '__proto__', maximum: 5, current: 5 })));
test('nested traits and modifiers do not confuse levels with points', () => {
  const a = actor();
  a.system.ads = {
    a: {
      contains: { x: { name: 'Vitality Reserve 7 (Magical, -10%)', points: 13 } },
      collapsed: { y: { name: 'Vitality Reserve', points: 20 } },
    },
  };
  assert.deepEqual(
    detectLevels(a).map((x) => x.level),
    [7, null],
  );
});
test('zero explicit level remains zero', () => {
  const a = actor();
  a.system.ads = { x: { name: 'Vitality Reserve', levels: 0 } };
  assert.equal(detectLevels(a)[0].level, 0);
});
test('permissions enforced', () => {
  const a = actor();
  a.testUserPermission = () => false;
  assert.throws(() => own(a, { isGM: false }));
  own(a, { isGM: true });
});
test('HTML escaped', () =>
  assert.equal(escapeHTML('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;'));
test('queue serialises and recovers after rejection', async () => {
  const q = queueByKey(),
    output = [];
  const p = q('a', async () => {
    output.push(1);
    throw Error('bad');
  });
  const p2 = q('a', async () => {
    output.push(2);
  });
  await assert.rejects(p);
  await p2;
  assert.deepEqual(output, [1, 2]);
});
test('routing conserves points across a grid of HP/VR states', () => {
  for (let hp = -10; hp <= 12; hp += 2)
    for (let vr = 0; vr <= 5; vr++)
      for (let amount = 0; amount <= 25; amount++) {
        const p = { hp, hpMax: 12, vr, vrMax: 5 };
        const d = route(p, 'damage', amount);
        assert.equal(Math.abs(d.hpChange + d.vrChange), amount);
        assert.ok(d.after.vr >= 0);
        for (const policy of ['hp', 'vr', 'none']) {
          const h = route(p, 'heal', amount, policy);
          assert.equal(h.hpChange + h.vrChange + h.unused, amount);
          assert.ok(h.after.hp <= 12 && h.after.vr <= 5);
        }
      }
});
export { actor };
