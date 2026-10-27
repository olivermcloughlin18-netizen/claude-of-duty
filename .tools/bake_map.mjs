import { spawn } from 'node:child_process';
import { copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Defaults are Hijacked's. Other maps: --source <gltf/glb> --output <glb> [--textures etc1s|webp|keep]
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? path.resolve(root, process.argv[i + 1]) : fallback;
}
const textures = process.argv.includes('--textures') ? process.argv[process.argv.indexOf('--textures') + 1] : 'etc1s';
const source = arg('source', path.join(root, 'export', 'web', 'hijacked.gltf'));
const output = arg('output', path.join(root, 'export', 'web', 'hijacked_optimized.glb'));
const intermediate = path.join(path.dirname(output), `${path.basename(output, '.glb').replace('_optimized', '')}_geometry.glb`);

function run(args) {
  return new Promise((resolve, reject) => {
    const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const child = spawn(executable, ['--yes', '@gltf-transform/cli@4.4.2', ...args], {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`glTF Transform exited with status ${code}`));
    });
  });
}

try {
  await run([
    'optimize', source, intermediate,
    '--compress', 'meshopt',
    '--flatten', 'false',
    '--join', 'false',
    '--instance', 'true',
    '--instance-min', '3',
    '--palette', 'false',
    '--simplify', 'false',
    '--texture-compress', 'false',
  ]);
  // ETC1S, not UASTC. Every texture in this map is a baseColor map -- there are
  // no normal or metal-rough maps, which are the maps ETC1S actually degrades.
  // UASTC was costing ~34 MB of the 45 MB export for quality nothing here uses.
  if (textures === 'keep') await copyFile(intermediate, output);
  else if (textures === 'webp') await run(['webp', intermediate, output, '--quality', '85', '--effort', '100']);
  else await run([
    'etc1s', intermediate, output,
    '--quality', '200',
    '--compression', '5',
    '--jobs', '8',
  ]);
} finally {
  await rm(intermediate, { force: true });
}
