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
for (const path of files) entries[path] = new Uint8Array(await readFile(path));
const zipped = zipSync(entries, { level: 9 });
const restored = unzipSync(zipped);
for (const file of files)
  if (!Buffer.from(restored[file]).equals(Buffer.from(entries[file])))
    throw Error(`ZIP verification failed: ${file}`);
await mkdir('dist', { recursive: true });
const name = `${manifest.id}-v${manifest.version}.zip`;
await writeFile(`dist/${name}`, zipped);
await writeFile('dist/module.json', await readFile('module.json'));
console.log(
  `Verified ${name}: ${files.length} runtime and guide files; no tests or development dependencies.`,
);
