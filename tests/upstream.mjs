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

// Exercise the patched Layered Armour source alongside the real GGA calculator.
const armour = await import('./upstream-source/layered-core.mjs');
const armourSource = await readFile(
  new URL('./upstream-source/layered-integration.mjs', import.meta.url),
  'utf8',
);
const { parseHTML } = await import('linkedom');
const { resolve: vrResolve, prepare: vrPrepare } = await import('../scripts/adapter.mjs');
function combined(order, { invalid = false } = {}) {
  const { document } = parseHTML('<html><body></body></html>');
  globalThis.document = document;
  const messages = [];
  globalThis.game = {
    user: { id: 'gm', isGM: true },
    users: [],
    settings: {
      get: (_scope, key) => ({ enabled: true, healingPolicy: 'hp', cripplingPolicy: 'hp' })[key],
    },
    i18n: { localize: (s) => s },
  };
  globalThis.ui = { notifications: { error() {}, warn() {} } };
  globalThis.foundry = { utils: { randomID: () => 'result' } };
  globalThis.GURPS = { lastInjuryRolls: {} };
  globalThis.ChatMessage = { getSpeaker: () => ({}), create: async (data) => messages.push(data) };
  const actor = {
    id: 'a',
    uuid: 'Actor.a',
    documentName: 'Actor',
    name: 'Test',
    isOwner: true,
    system: {
      HP: { value: 12, max: 12 },
      additionalresources: { tracker: { '0000': { value: 3, max: 3, gvr: { kind: 'vitality' } } } },
    },
    testUserPermission: () => true,
    getFlag: () => ({
      schema: 1,
      enabled: true,
      layers: [
        { ...armour.newLayer(['Torso']), dr: 4 },
        { ...armour.newLayer(['Torso']), dr: 2 },
      ],
    }),
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        let obj = this;
        const parts = path.split('.');
        for (const p of parts.slice(0, -1)) obj = obj[p];
        obj[parts.at(-1)] = value;
      }
    },
  };
  const { parent } = make([12], 3, {
    _defender: actor,
    armorDivisor: 1,
    useArmorDivisor: true,
    viewId: 0,
    hitLocation: invalid ? 'Random' : 'Torso',
  });
  for (const [key, get] of Object.entries({
    DR: () => 0,
    effectiveDR: function () {
      return this.DR;
    },
    isFlexibleArmor: () => false,
  }))
    Object.defineProperty(parent, key, { configurable: true, get });
  Object.defineProperty(
    parent,
    'pointsToApply',
    Object.getOwnPropertyDescriptor(CompositeDamageCalculator.prototype, 'pointsToApply'),
  );
  let nativeWrites = 0;
  class ADD {
    constructor() {
      this.actor = actor;
      this._calculator = parent;
      this.options = {};
      this.position = {};
    }
    async getData() {
      return {};
    }
    activateListeners() {}
    async resolveInjury() {
      nativeWrites++;
    }
    _renderTemplate() {}
    render() {}
    async close() {}
  }
  const chains = new Map();
  // libWrapper's documented priority: WRAPPER always precedes MIXED, independent
  // of registration order. Exercise the real module wrapper functions here.
  const wrapper = {
    register(_id, path, fn, type) {
      const method = path.split('.').at(-1);
      let chain = chains.get(method);
      if (!chain) {
        chain = { native: ADD.prototype[method], items: [] };
        chains.set(method, chain);
      }
      chain.items.push({ fn, type });
      ADD.prototype[method] = function (...args) {
        const ordered = [...chain.items].sort(
          (a, b) => (a.type === 'WRAPPER' ? 0 : 1) - (b.type === 'WRAPPER' ? 0 : 1),
        );
        const call = (i, a) =>
          i === ordered.length
            ? chain.native.apply(this, a)
            : ordered[i].fn.call(this, (...next) => call(i + 1, next), ...a);
        return call(0, args);
      };
    },
  };
  const env = vm.createContext({
    ...armour,
    esc: armour.escapeHTML,
    document,
    game,
    ui,
    libWrapper: wrapper,
    attachHelp: () => () => {},
    helpEnabled: () => false,
  });
  const patch = vm.runInContext(
    armourSource
      .replace(/^import [\s\S]*? from ['"][^'"]+['"];?\s*$/gm, '')
      .replace(/export function/g, 'function') + '\npatchADD',
    env,
  );
  const installVR = () => {
    wrapper.register(
      'vr',
      'GURPS.ApplyDamageDialog.prototype.getData',
      async function (w, ...a) {
        vrPrepare(this);
        return w(...a);
      },
      'WRAPPER',
    );
    wrapper.register('vr', 'GURPS.ApplyDamageDialog.prototype.resolveInjury', vrResolve, 'MIXED');
  };
  if (order === 'VR first') {
    installVR();
    patch(ADD, () => {});
  } else {
    patch(ADD, () => {});
    installVR();
  }
  return { dialog: new ADD(), actor, messages, nativeWrites: () => nativeWrites };
}
for (const order of ['VR first', 'Armour first']) {
  test(`layered DR then VR and HP, audit retained: ${order}`, async () => {
    const { dialog, actor, messages, nativeWrites } = combined(order);
    await dialog.getData();
    assert.equal(dialog._calculator.effectiveDR, 6);
    assert.equal(dialog._calculator.pointsToApply, 6);
    assert.equal(dialog._calculator._calculators[0].calculatedShock, 3);
    await dialog.resolveInjury(true, 6, true, '<p>Final injury 6</p>');
    assert.equal(actor.system.HP.value, 9);
    assert.equal(actor.system.additionalresources.tracker['0000'].value, 0);
    assert.equal(nativeWrites(), 0);
    assert.match(messages[0].content, /effective DR 6/);
    assert.match(messages[0].content, /VR −3/);
  });
  test(`unresolved armour prevents VR and HP writes: ${order}`, async () => {
    const { dialog, actor } = combined(order, { invalid: true });
    await dialog.getData();
    await assert.rejects(
      dialog.resolveInjury(true, 12, true, '<p>injury</p>'),
      /specific hit location/,
    );
    assert.equal(actor.system.HP.value, 12);
    assert.equal(actor.system.additionalresources.tracker['0000'].value, 3);
  });
}

test('25 HP screenshot scenario gives shock 1 for 2 HP injury after VR', () => {
  const {
    children: [c],
  } = make([6], 4, { HP: { max: 25 } });
  assert.equal(c.calculatedShock, 1);
  assert.equal(c.effects.find((e) => e.type === 'shock').amount, 1);
});
