import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { installEffects } from '../scripts/effects.mjs';
// Execute the real, pinned GGA class bodies. Only Foundry-facing imports and
// globals are stubbed; injury/effect calculations below are upstream code.
const source = await readFile(
  new URL('./upstream-source/damagecalculator.js', import.meta.url),
  'utf8',
);
const context = vm.createContext({
  game: { i18n: { localize: (s) => s } },
  hitlocation: { LIMB: 'limb', EXTREMITY: 'extremity', CHEST: 'chest', GROIN: 'groin' },
});
const { DamageCalculator, CompositeDamageCalculator } = vm.runInContext(
  source
    .replace(/^import .*\n/gm, '')
    .replace('export class CompositeDamageCalculator', 'class CompositeDamageCalculator') +
    '\n;({DamageCalculator,CompositeDamageCalculator})',
  context,
);
function make(damages, vr, options = {}) {
  const parent = {
    HP: { max: 12 },
    resource: [{}, 'system.HP'],
    isRangedHalfDamage: false,
    isShotgun: false,
    isExplosion: false,
    effectiveDR: 0,
    totalWoundingModifier: 1,
    _damageReductionLevel: null,
    isInjuryTolerance: false,
    damageType: 'cr',
    useLocationModifiers: true,
    hitLocationRole: 'chest',
    hitLocation: 'Torso',
    isCrippleableLocation: false,
    cripplingThreshold: Infinity,
    locationMaxHP: Infinity,
    attributes: { ST: { value: 10 } },
    _defender: { system: { HP: { max: 12 } } },
    ...options,
  };
  parent._calculators = damages.map((d) => new DamageCalculator(parent, { damage: d }));
  const state = { vr, crippling: 'hp' };
  installEffects(parent, () => state);
  return { parent, state, children: parent._calculators };
}
const types = (c) => Array.from(c.effects, (e) => e.type);
test('fully absorbed injury has no shock or major wound; knockback remains', () => {
  const {
    children: [c],
  } = make([16], 20);
  assert.equal(c.pointsToApply, 16);
  assert.deepEqual(types(c), ['knockback']);
  assert.equal(c.calculatedShock, 0);
  assert.equal(c.isMajorWound, false);
});
test('partial absorption computes shock and major wound from actual HP loss', () => {
  const {
    children: [c],
  } = make([8], 5);
  assert.equal(c.calculatedShock, 3);
  assert.equal(c.isMajorWound, false);
  assert.deepEqual(types(c), ['shock', 'knockback']);
});
test('multi-hit reserve allocated in order', () => {
  const { children } = make([3, 4, 8], 5);
  assert.deepEqual(
    children.map((c) => c.calculatedShock),
    [0, 2, 4],
  );
  assert.deepEqual(
    children.map((c) => c.isMajorWound),
    [false, false, true],
  );
});
test('location cap is retained before pool routing', () => {
  const {
    children: [c],
  } = make([30], 5, {
    hitLocationRole: 'limb',
    hitLocation: 'Left Arm',
    isCrippleableLocation: true,
    cripplingThreshold: 6,
    locationMaxHP: 7,
  });
  assert.equal(c.pointsToApply, 7);
  assert.equal(c.calculatedShock, 2);
  assert.equal(c.isCripplingInjury, false);
});
test('limb with depleted VR can cripple normally', () => {
  const {
    children: [c],
  } = make([30], 0, {
    hitLocationRole: 'limb',
    hitLocation: 'Left Arm',
    isCrippleableLocation: true,
    cripplingThreshold: 6,
    locationMaxHP: 7,
  });
  assert.equal(c.isCripplingInjury, true);
  assert.ok(types(c).includes('crippling'));
  assert.ok(types(c).includes('majorwound'));
});
test('fully absorbed skull injury has no head-hit knockdown', () => {
  const {
    children: [c],
  } = make([5], 5, { hitLocation: 'Skull' });
  assert.deepEqual(types(c), []);
});
test('partial skull injury retains head-hit advice', () => {
  const {
    children: [c],
  } = make([9], 2, { hitLocation: 'Skull' });
  assert.ok(types(c).includes('headvitalshit'));
  assert.equal(c.effects.find((e) => e.type === 'headvitalshit').modifier, 10);
});
test('FP destination does not use VR', () => {
  const {
    children: [c],
  } = make([8], 50, { resource: [{}, 'system.FP'] });
  assert.equal(c.calculatedShock, 4);
});
test('bypass restores original GGA getters', () => {
  const {
    children: [c],
    state,
  } = make([8], 50);
  state.bypass = true;
  assert.equal(c.calculatedShock, 4);
  assert.equal(c.isMajorWound, true);
});
test('live reserve updates change effects without rebuilding calculator', () => {
  const {
    children: [c],
    state,
  } = make([8], 50);
  state.vr = 0;
  assert.equal(c.calculatedShock, 4);
});
test('explicit original crippling policy retains original advice', () => {
  const {
    children: [c],
    state,
  } = make([30], 20, {
    hitLocationRole: 'limb',
    hitLocation: 'Left Arm',
    isCrippleableLocation: true,
    cripplingThreshold: 6,
    locationMaxHP: 7,
  });
  state.crippling = 'original';
  assert.ok(types(c).includes('crippling'));
  assert.ok(!types(c).includes('shock'));
  assert.ok(!types(c).includes('majorwound'));
});
test('original composite aggregates adjusted child effects', () => {
  const { parent } = make([3, 4, 8], 5);
  const getter = Object.getOwnPropertyDescriptor(
    CompositeDamageCalculator.prototype,
    'effects',
  ).get;
  const effects = getter.call(parent);
  assert.equal(effects.find((e) => e.type === 'shock').amount, 4);
  assert.ok(effects.some((e) => e.type === 'majorwound'));
});
test('installing twice is harmless', () => {
  const {
    parent,
    children: [c],
  } = make([5], 5);
  installEffects(parent, () => ({ vr: 0 }));
  assert.equal(c.calculatedShock, 0);
});
