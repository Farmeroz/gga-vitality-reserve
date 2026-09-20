import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const sha = '90ca003f68e8dd5e66de44de5c9ea76c9f463364';
await mkdir('tests/upstream-source', { recursive: true });
for (const file of ['damage/damagecalculator.js', 'damage/applydamage.js', 'chat.js']) {
  const bytes = execFileSync(
    'curl',
    ['-fsSL', `https://raw.githubusercontent.com/crnormand/gurps/${sha}/module/${file}`],
    { maxBuffer: 2e6 },
  );
  await writeFile(`tests/upstream-source/${file.split('/').at(-1)}`, bytes);
}
console.log(`GGA 0.18.23 source pinned to ${sha}`);
const armourCommit = '3a5cf7179fa49b1a80ef9b2681422a1cfb9ea4bd';
for (const file of ['core', 'integration']) {
  const bytes = execFileSync(
    'curl',
    [
      '-fsSL',
      `https://raw.githubusercontent.com/Farmeroz/gurps-layered-armour/${armourCommit}/scripts/${file}.mjs`,
    ],
    { maxBuffer: 2e6 },
  );
  await writeFile(`tests/upstream-source/layered-${file}.mjs`, bytes);
}
