import test from 'node:test';
import assert from 'node:assert/strict';
import { perform, request, installRequests } from '../scripts/service.mjs';
import { resolve } from '../scripts/adapter.mjs';
import { readPools, ID } from '../scripts/core.mjs';
const gm = { id: 'gm', isGM: true, active: true },
  player = { id: 'p', isGM: false, active: true };
let settings = { enabled: true, healingPolicy: 'hp', cripplingPolicy: 'hp' };
function fixture({ owned = true, synthetic = false } = {}) {
  const a = {
    uuid: synthetic ? 'Scene.s.Token.t.Actor.a' : 'Actor.a',
    id: 'a',
    name: 'Test',
    documentName: 'Actor',
    testUserPermission: () => owned,
    system: {
      HP: { value: 10, max: 12 },
      additionalresources: {
        tracker: {
          '0000': { name: 'Vitality Reserve', value: 5, max: 5, gvr: { kind: 'vitality' } },
        },
      },
    },
    updates: [],
    async update(changes) {
      a.updates.push(changes);
      for (const [path, value] of Object.entries(changes)) {
        const parts = path.split('.');
        let target = a;
        for (const p of parts.slice(0, -1)) target = target[p] ??= {};
        const last = parts.at(-1);
        if (last.startsWith('-=')) delete target[last.slice(2)];
        else target[last] = structuredClone(value);
      }
      return a;
    },
  };
  globalThis.game = {
    user: gm,
    users: Object.assign([gm, player], {
      get(id) {
        return this.find((u) => u.id === id);
      },
    }),
    settings: { get: (_id, key) => settings[key] },
  };
  globalThis.ui = { notifications: { warn() {}, error() {} } };
  globalThis.foundry = { utils: { randomID: () => 'generated' } };
  globalThis.GURPS = {};
  return a;
}
test('service writes HP and VR together', async () => {
  const a = fixture();
  const result = await perform(a, { kind: 'damage', amount: 8, expected: readPools(a) }, gm);
  assert.equal(result.after.hp, 7);
  assert.equal(a.updates.length, 1);
  assert.deepEqual(Object.keys(a.updates[0]), [
    'system.HP.value',
    'system.additionalresources.tracker.0000.value',
  ]);
});
test('stale update rejected without changing pools', async () => {
  const a = fixture();
  const expected = readPools(a);
  a.system.HP.value = 9;
  await assert.rejects(perform(a, { kind: 'heal', amount: 7, expected }, gm), /changed/);
  assert.equal(a.updates.length, 0);
});
test('unowned actor rejected for player', async () => {
  const a = fixture({ owned: false });
  await assert.rejects(
    perform(a, { kind: 'damage', amount: 8, expected: readPools(a) }, player),
    /own/,
  );
  assert.equal(a.updates.length, 0);
});
test('two simultaneous requests cannot spend the same VR twice', async () => {
  const a = fixture(),
    expected = readPools(a);
  const result = await Promise.allSettled([
    perform(a, { kind: 'damage', amount: 3, expected }, gm),
    perform(a, { kind: 'damage', amount: 3, expected }, gm),
  ]);
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(a.system.additionalresources.tracker['0000'].value, 2);
});
test('disabled module rejects mutations', async () => {
  const a = fixture();
  settings.enabled = false;
  await assert.rejects(
    perform(a, { kind: 'damage', amount: 3, expected: readPools(a) }, gm),
    /disabled/,
  );
  settings.enabled = true;
});
test('synthetic actor changes its own pool', async () => {
  const a = fixture({ synthetic: true });
  await perform(a, { kind: 'heal', amount: 2, expected: readPools(a) }, gm);
  assert.equal(a.system.HP.value, 12);
});
test('unlink retains tracker and values', async () => {
  const a = fixture();
  await perform(a, { kind: 'unlink' }, gm);
  assert.equal(a.system.additionalresources.tracker['0000'].value, 5);
  assert.equal(a.system.additionalresources.tracker['0000'].gvr, undefined);
});
test('setup can resolve multiple tagged trackers without findVR', async () => {
  const a = fixture();
  a.system.additionalresources.tracker['0001'] = structuredClone(
    a.system.additionalresources.tracker['0000'],
  );
  await perform(a, { kind: 'setup', input: { key: '0001', maximum: 10, current: 3 } }, gm);
  assert.equal(a.system.additionalresources.tracker['0000'].gvr, undefined);
  assert.equal(a.system.additionalresources.tracker['0001'].value, 3);
});
test('non-HP ADD resources delegate without touching pools', async () => {
  const a = fixture();
  let calls = 0;
  await resolve.call(
    { actor: a, _calculator: { resource: [{}, 'system.FP'] } },
    async () => calls++,
    false,
    5,
    true,
  );
  assert.equal(calls, 1);
  assert.equal(a.updates.length, 0);
});
test('no-GM path respects private chat and updates actor', async () => {
  const a = fixture();
  game.users = [player];
  game.user = player;
  const cards = [];
  globalThis.ChatMessage = { getSpeaker: () => ({}), create: async (d) => cards.push(d) };
  await request(a, { kind: 'damage', amount: 8, publicly: false });
  assert.equal(a.system.HP.value, 7);
  assert.deepEqual(cards[0].whisper, ['p']);
  assert.match(cards[0].content, /VR −5/);
});
test('GM request uses server-authored user, never claimed userId', async () => {
  const a = fixture({ owned: false }),
    hooks = {};
  globalThis.Hooks = {
    on: (event, fn) => {
      hooks[event] = fn;
    },
  };
  globalThis.fromUuid = async () => a;
  installRequests();
  const message = {
    id: 'malicious',
    author: player,
    flags: {
      [ID]: {
        request: {
          actorUuid: a.uuid,
          kind: 'damage',
          amount: 8,
          expected: readPools(a),
          userId: 'gm',
        },
      },
    },
    getFlag(scope, key) {
      return this.flags[scope]?.[key];
    },
    async update(change) {
      this.change = change;
    },
  };
  hooks.createChatMessage(message);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(a.updates.length, 0);
  assert.equal(message.change[`flags.${ID}.receipt`].ok, false);
});
test('GM request authorises a valid owner and preserves private recipients', async () => {
  const a = fixture(),
    hooks = {};
  globalThis.Hooks = {
    on: (event, fn) => {
      hooks[event] = fn;
    },
  };
  globalThis.fromUuid = async () => a;
  installRequests();
  const message = {
    id: 'owned',
    author: player,
    flags: {
      [ID]: {
        request: {
          actorUuid: a.uuid,
          kind: 'damage',
          amount: 8,
          expected: readPools(a),
          publicly: false,
        },
      },
    },
    getFlag(scope, key) {
      return this.flags[scope]?.[key];
    },
    async update(change) {
      this.change = change;
    },
  };
  hooks.createChatMessage(message);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(a.system.HP.value, 7);
  assert.equal(message.change.whisper, undefined);
  assert.equal(message.change[`flags.${ID}.receipt`].ok, true);
});
