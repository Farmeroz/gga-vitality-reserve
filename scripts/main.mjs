import { ID, POLICIES, findVR } from './core.mjs';
import { installRequests, request } from './service.mjs';
import { installAdapter } from './adapter.mjs';
import { installUI, open, setup, report } from './ui.mjs';
Hooks.once('init', () => {
  game.settings.register(ID, 'enabled', {
    name: 'Enable Vitality Reserve',
    hint: 'Route supported damage and healing through linked VR trackers. Manual sheet corrections remain direct edits.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(ID, 'healingPolicy', {
    name: 'Vitality Reserve healing',
    hint: 'External healing order. Natural VR recovery remains separate.',
    scope: 'world',
    config: true,
    type: String,
    choices: POLICIES,
    default: 'hp',
  });
  game.settings.register(ID, 'cripplingPolicy', {
    name: 'Crippling assessment',
    hint: 'Pyramid does not explicitly settle crippling. HP injury only is the default interpretation; original GGA assessment retains its pre-VR crippling advice.',
    scope: 'world',
    config: true,
    type: String,
    choices: { hp: 'HP injury only', original: 'Original GGA crippling assessment' },
    default: 'hp',
  });
});
Hooks.once('ready', () => {
  if (game.system.id !== 'gurps') return;
  try {
    installAdapter();
    installRequests();
    installUI();
    game.modules.get(ID).api = Object.freeze({
      open,
      setup,
      hasVR: (actor) => !!findVR(actor),
      damage: (actor, amount, options = {}) =>
        request(actor, { ...options, kind: 'damage', amount }),
      heal: (actor, amount, options = {}) => request(actor, { ...options, kind: 'heal', amount }),
      recover: (actor, amount = 1, options = {}) =>
        request(actor, { ...options, kind: 'recover', amount }),
      spend: (actor, amount, options = {}) => request(actor, { ...options, kind: 'spend', amount }),
    });
  } catch (error) {
    report(error);
  }
});
