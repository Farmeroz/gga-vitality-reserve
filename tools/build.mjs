import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { zipSync, unzipSync } from 'fflate';
const manifest = JSON.parse(await readFile('module.json', 'utf8'));
for (const folder of ['scripts', 'tools', 'tests'])
  for (const name of await readdir(folder))
    if (name.endsWith('.mjs')) execFileSync(process.execPath, ['--check', `${folder}/${name}`]);
const files = [
  'module.json',
  'README.md',
  'USER_GUIDE.md',
  'LICENSE',
  ...(await readdir('scripts')).map((f) => `scripts/${f}`),
  ...(await readdir('styles')).map((f) => `styles/${f}`),
];
const entries = {};
for (const path of files)
  entries[`${manifest.id}/${path}`] = new Uint8Array(await readFile(path));
const zipped = zipSync(entries, { level: 9 });
const restored = unzipSync(zipped);
assert.deepEqual(Object.keys(restored).sort(), Object.keys(entries).sort());
assert.ok(Object.keys(restored).every((path) => path.startsWith(`${manifest.id}/`)));
assert.equal(
  JSON.parse(Buffer.from(restored[`${manifest.id}/module.json`]).toString()).id,
  manifest.id,
);
for (const [path, bytes] of Object.entries(entries))
  assert.deepEqual(Buffer.from(restored[path]), Buffer.from(bytes), path);
await mkdir('dist', { recursive: true });
const name = `${manifest.id}-v${manifest.version}.zip`;
await writeFile(`dist/${name}`, zipped);
await writeFile('dist/module.json', await readFile('module.json'));
console.log(
  `Verified ${name}: ${files.length} runtime and guide files; no tests or development dependencies.`,
);
