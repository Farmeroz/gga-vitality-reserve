import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { enhanceDialog, calculationText } from '../scripts/adapter.mjs';
import { detectLevels } from '../scripts/core.mjs';
import { renderResult } from '../scripts/service.mjs';
function fixture(simple = false) {
  const { document } = parseHTML(
    `<html><body><section class="app"><header>Manual Damage</header><div class="window-content"><div class="gga-app"><div class="apply-damage-column"><div class="damage-entry"><input id="basicDamage" value="6"><div><select id="apply-to"></select></div></div></div>${simple ? '' : '<div class="results-table gurps-3col"><div>Injury</div><div>6</div><div>6 × 1</div></div><div class="apply-results"><div><input id="result-apply-injury" disabled value="6"></div></div>'}</div></div></section></body></html>`,
  );
  globalThis.document = document;
  globalThis.game = {
    settings: { get: () => true },
    i18n: { localize: (key) => (key === 'GURPS.addInjury' ? 'Injury' : key) },
  };
  const actor = {
    system: {
      HP: { value: 25, max: 25 },
      additionalresources: {
        tracker: { '0000': { name: 'VR', max: 4, value: 4, gvr: { kind: 'vitality' } } },
      },
    },
  };
  const dialog = {
    actor,
    _calculator: { resource: [{}, 'system.HP'], pointsToApply: 6 },
    render() {},
  };
  return { document, root: document.querySelector('.app'), dialog };
}
test('screenshot advantage syntax is detected', () =>
  assert.equal(
    detectLevels({ system: { ads: { a: { name: 'Vitality Reserve (4)' } } } })[0].level,
    4,
  ));
test('bracketed level with modifiers is detected without mistaking modifier percentage for level', () =>
  assert.equal(
    detectLevels({ system: { ads: { a: { name: 'Vitality Reserve (4) (Magical, -10%)' } } } })[0]
      .level,
    4,
  ));
test('modifiers without a level remain manual', () =>
  assert.equal(
    detectLevels({ system: { ads: { a: { name: 'Vitality Reserve (Magical, -10%)' } } } })[0].level,
    null,
  ));
test('VR lives inside application content, never above window header', () => {
  const { root, dialog } = fixture();
  enhanceDialog(dialog, root);
  assert.equal(root.firstElementChild.tagName, 'HEADER');
  assert.equal(root.querySelectorAll('.gvr-controls').length, 1);
  assert.ok(root.querySelector('.apply-results .gvr-controls'));
  assert.ok(root.querySelector('.apply-damage-column > .gvr-bypass'));
  assert.equal(root.querySelector('.apply-results input[type=checkbox]'), null);
  assert.equal(root.querySelector('.gvr-add-panel'), null);
});
test('rerender cannot duplicate controls or result rows', () => {
  const { root, dialog } = fixture();
  enhanceDialog(dialog, root);
  enhanceDialog(dialog, root.querySelector('.window-content'));
  assert.equal(root.querySelectorAll('.gvr-controls').length, 1);
  assert.equal(root.querySelectorAll('.gvr-result-cell').length, 6);
  assert.equal(root.querySelectorAll('.gvr-bypass').length, 1);
});
test('final application field and calculation rows show 2 HP plus 4 VR; arithmetic stays 6', () => {
  const { root, dialog } = fixture();
  enhanceDialog(dialog, root);
  assert.equal(root.querySelector('#result-apply-injury').value, '2 HP + 4 VR');
  assert.deepEqual(
    [...root.querySelectorAll('.gvr-result-cell')].map((n) => n.textContent),
    ['VR absorbed', '4', '4 available', 'HP injury', '2', '6 − 4'],
  );
  assert.equal(dialog._calculator.pointsToApply, 6);
});
test('bypass updates the displayed split', () => {
  const { root, dialog } = fixture();
  dialog._gvrBypass = true;
  enhanceDialog(dialog, root);
  assert.equal(root.querySelector('#result-apply-injury').value, '6 HP + 0 VR');
});
test('FP destination remains unchanged', () => {
  const { root, dialog } = fixture();
  dialog._calculator.resource = [{}, 'system.FP'];
  enhanceDialog(dialog, root);
  assert.equal(root.querySelector('#result-apply-injury').value, '6');
  assert.equal(root.querySelector('.gvr-controls'), null);
});
test('simple ADD still mounts within content', () => {
  const { root, dialog } = fixture(true);
  enhanceDialog(dialog, root);
  assert.ok(root.querySelector('.gga-app .gvr-controls'));
});
test('audit collapses indented HTML into legible calculation rows', () => {
  fixture();
  const audit = calculationText(
    '<div> Basic Damage </div>\n<div> 6 </div><div> HP </div><div> DR </div><div>0</div><div> Torso </div>',
  );
  assert.equal(audit, 'Basic Damage: 6 · HP\nDR: 0 · Torso');
});
test('chat audit uses normal paragraphs and escapes hostile content', () => {
  fixture();
  const html = renderResult(
    { name: 'Test' },
    {
      kind: 'damage',
      amount: 6,
      hpChange: -2,
      vrChange: -4,
      before: { hp: 25, vr: 4 },
      after: { hp: 23, vr: 0 },
    },
    '',
    'Basic Damage: 6 · HP\n<script>bad</script>',
  );
  assert.ok(!html.includes('<pre'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /Basic Damage: 6 · HP<\/p>/);
});
