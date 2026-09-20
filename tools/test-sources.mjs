import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const sha = '90ca003f68e8dd5e66de44de5c9ea76c9f463364';
await mkdir('tests/upstream-source', { recursive: true });
for (const file of ['damagecalculator.js', 'applydamage.js']) {
  const bytes = execFileSync(
    'curl',
    ['-fsSL', `https://raw.githubusercontent.com/crnormand/gurps/${sha}/module/damage/${file}`],
    { maxBuffer: 2e6 },
  );
  await writeFile(`tests/upstream-source/${file}`, bytes);
}
console.log(`GGA 0.18.23 source pinned to ${sha}`);
