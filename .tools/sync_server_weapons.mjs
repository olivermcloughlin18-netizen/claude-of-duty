// Generates server/weapons.json from export/web/weapons.js so the server's hit validation never drifts.
//   node .tools/sync_server_weapons.mjs          write the file
//   node .tools/sync_server_weapons.mjs --check  exit 1 if the file is stale
// Entry: { damage: damage * pellets (max claim per aggregated hit, before the x2 headshot), rpm: ceil(fastest rpm * 1.25) }.
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WEAPONS } from '../export/web/weapons.js';

export const RPM_SLACK = 1.25;
export const OUTPUT = fileURLToPath(new URL('../server/weapons.json', import.meta.url));

export function buildTable(weapons = WEAPONS) {
  return Object.fromEntries(Object.keys(weapons).sort().map((id) => {
    const def = weapons[id];
    const fastest = Math.max(def.roundsPerMinute, def.initialRoundsPerMinute ?? 0);
    return [id, { damage: def.damage * (def.pellets ?? 1), rpm: Math.ceil(fastest * RPM_SLACK) }];
  }));
}

export const render = (table = buildTable()) => `${JSON.stringify(table, null, 2)}\n`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '';
    if (current !== render()) { console.error('server/weapons.json is stale: run node .tools/sync_server_weapons.mjs'); process.exit(1); }
    console.log('server/weapons.json is up to date');
  } else {
    fs.writeFileSync(OUTPUT, render());
    console.log(`wrote ${OUTPUT} (${Object.keys(buildTable()).length} weapons)`);
  }
}
