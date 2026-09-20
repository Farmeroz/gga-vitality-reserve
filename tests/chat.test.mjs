import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { registerCommand } from '../scripts/ui.mjs';
const source = await readFile(new URL('./upstream-source/chat.js', import.meta.url), 'utf8');
async function registry() {
  const handlers = {},
    init = [];
  const context = vm.createContext({
    ChatProcessor: class {},
    GURPS: { ChatCommandsInProcess: [] },
    game: { user: { isGM: false } },
    Hooks: {
      once: (name, fn) => init.push(fn),
      on: (name, fn) => {
        handlers[name] = fn;
      },
    },
  });
  const r = vm.runInContext(
    source
      .replace(/^import .*\n/gm, '')
      .replace('export let ChatProcessors', 'let ChatProcessors')
      .replace('export default function', 'function') + '\n;addChatHooks(); ChatProcessors',
    context,
  );
  for (const fn of init) await fn();
  // Supply only the base Help processor methods normally inherited from ChatProcessor.
  r._processors[0].matches = () => false;
  r._processors[0].usagematches = () => false;
  r._processors[0].isGMOnly = () => false;
  return { r, handlers };
}
test('GGA registry handles /vr and OtF with owner permission evaluated by the window', async () => {
  const { r } = await registry();
  let opened = 0;
  registerCommand(r, async () => opened++);
  assert.equal(r.willTryToHandle('/vr'), true);
  assert.equal(r.willTryToHandle('!/vr'), true);
  assert.equal(r.willTryToHandle('/vr-other'), false);
  await r.handle('/vr');
  assert.equal(opened, 1);
});
test('actual GGA hook normalises v14 paragraph-wrapped input before routing', async () => {
  const { r, handlers } = await registry();
  registerCommand(r, async () => {});
  let line;
  r.startProcessingLines = (text) => {
    line = text;
  };
  assert.equal(handlers.chatMessage(null, '<p>/vr</p>', {}), false);
  assert.equal(line, '/vr\n');
});
test('command recognises surrounding whitespace and uppercase', async () => {
  const { r } = await registry();
  registerCommand(r, async () => {});
  assert.equal(r.willTryToHandle(' /VR '), true);
});
test('errors reported once and command consumed', async () => {
  const { r } = await registry();
  let errors = 0;
  registerCommand(
    r,
    async () => {
      throw Error('Select a token');
    },
    () => errors++,
  );
  await r.handle('/vr');
  assert.equal(errors, 1);
});
test('re-registration does not open two windows', async () => {
  const { r } = await registry();
  let errors = 0;
  assert.equal(
    registerCommand(
      r,
      async () => {},
      () => errors++,
    ),
    true,
  );
  assert.equal(
    registerCommand(
      r,
      async () => {},
      () => errors++,
    ),
    false,
  );
  assert.equal(errors, 1);
});
