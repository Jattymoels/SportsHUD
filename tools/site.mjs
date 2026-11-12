// What gets published, in one place.
//
//   node tools/site.mjs _site     copy the site into _site and list its files there
//   node tools/site.mjs --list    only write the list, here, for trying offline use at the desk
//
// The list (precache.json) is what sw.js fetches when it is first installed,
// so that every page works with no signal, not only the ones already opened.

import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PARTS = ['index.html', 'manifest.webmanifest', 'offline.js', 'sw.js', 'icons', 'engine', 'apps', 'fixtures'];
const LEFT_OUT = [/^engine\/tests\//];

async function filesUnder(path) {
  if ((await stat(path)).isFile()) return [path];
  const found = [];
  for (const name of (await readdir(path)).sort()) found.push(...(await filesUnder(join(path, name))));
  return found;
}

const files = [];
for (const part of PARTS) {
  for (const file of await filesUnder(join(root, part))) {
    const path = relative(root, file).split(sep).join('/');
    if (!LEFT_OUT.some((pattern) => pattern.test(path))) files.push(path);
  }
}

const target = process.argv[2];
if (!target) {
  console.error('Say where: a folder to copy the site into, or --list');
  process.exit(1);
}
const out = target === '--list' ? root : resolve(target);
if (target !== '--list') {
  for (const path of files) {
    await mkdir(join(out, path, '..'), { recursive: true });
    await cp(join(root, path), join(out, path));
  }
}
// A page is asked for by its folder, so that is the address to keep: "apps/ghost/", not "apps/ghost/index.html".
// The worker itself is not on the list: the browser keeps that.
const list = files.filter((path) => path !== 'sw.js').map((path) => (path === 'index.html' ? './' : path.replace(/(^|\/)index\.html$/, '$1')));
await writeFile(join(out, 'precache.json'), JSON.stringify(list, null, 1) + '\n');
console.log(`${files.length} files${target === '--list' ? ' listed' : ` copied to ${target}`}; precache.json written.`);
