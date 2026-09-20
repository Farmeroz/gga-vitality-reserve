import { injuryAllocation } from './core.mjs';
const originals = new WeakMap();
// Delegate to GGA's own effect getters, changing only the injury they see.
// Install on instances: no global DamageCalculator prototype replacement.
export function installEffects(parent, state) {
  const children = parent?._calculators;
  if (!Array.isArray(children)) throw new Error('Unsupported GGA damage calculator.');
  for (const child of children) {
    if (originals.has(child)) continue;
    const getters = {};
    for (const name of ['effects', 'calculatedShock', 'isMajorWound', 'isCripplingInjury']) {
      let proto = Object.getPrototypeOf(child),
        descriptor;
      while (proto && !descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(proto, name);
        proto = Object.getPrototypeOf(proto);
      }
      if (!descriptor?.get) throw new Error(`Unsupported GGA effect getter: ${name}.`);
      getters[name] = descriptor.get;
    }
    originals.set(child, getters);
    for (const name of Object.keys(getters))
      Object.defineProperty(child, name, {
        configurable: true,
        get() {
          const current = state();
          if (!current || current.bypass || parent.resource?.[1] !== 'system.HP')
            return getters[name].call(this);
          const allocation = injuryAllocation(
            children.map((c) => c.pointsToApply),
            current.vr,
          )[children.indexOf(this)];
          const proxy = new Proxy(this, {
            get(target, property, receiver) {
              if (property === 'pointsToApply') return allocation.hp;
              // Default ruling: only HP injury contributes to crippling, after GGA's location cap.
              if (property === 'unmodifiedPointsToApply')
                return current.crippling === 'original'
                  ? target.unmodifiedPointsToApply
                  : allocation.hp;
              if (Object.hasOwn(getters, property)) return getters[property].call(receiver);
              return Reflect.get(target, property, receiver);
            },
          });
          if (name === 'effects' && current.crippling === 'original') {
            // Preserve physical crippling advice even when no HP was lost. Do not
            // reintroduce shock or knockdown caused solely by spending VR.
            const effects = getters.effects.call(proxy);
            const cripple = getters.effects.call(this).find((e) => e.type === 'crippling');
            if (cripple && !effects.some((e) => e.type === 'crippling')) effects.push(cripple);
            return effects;
          }
          return getters[name].call(proxy);
        },
      });
  }
}
