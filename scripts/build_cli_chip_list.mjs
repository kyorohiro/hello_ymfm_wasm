// Reuse the Analyzer's chip names and playback descriptions in the npm README.
import {readFileSync, writeFileSync} from 'node:fs';
const source = new URL('../docs/vgm_analyzer/index.html', import.meta.url);
const target = new URL('../packages/vgm/README.md', import.meta.url);
const start = '<!-- chip-list:start -->';
const end = '<!-- chip-list:end -->';
const dialog = readFileSync(source, 'utf8').match(/<dialog id="chipSupportDialog"[\s\S]*?<\/dialog>/)?.[0];
if (!dialog) throw new Error('Cannot locate the Analyzer chip support dialog');
function plain(html) {
  return html.replace(/<small>[\s\S]*?<\/small>/g, '')
    .replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
}
const rows = [...dialog.matchAll(/<tr><th scope="row">([\s\S]*?)<\/th><td>([\s\S]*?)<\/td>/g)]
  .map(([, chip, playback]) => [plain(chip), plain(playback)])
  .filter(([chip]) => chip !== 'Other supported chip combinations');
if (!rows.length) throw new Error('Cannot locate chip support rows');
const block = `${start}\n| Chip | Playback in the shared core |\n| --- | --- |\n${rows.map(([chip, playback]) => `| ${chip} | ${playback} |`).join('\n')}\n${end}`;
const readme = readFileSync(target, 'utf8');
const from = readme.indexOf(start);
const to = readme.indexOf(end, from);
if (from < 0 || to < 0) throw new Error('Cannot locate README chip list markers');
const updated = readme.slice(0, from) + block + readme.slice(to + end.length);
if (process.argv.includes('--check')) {
  if (updated !== readme) throw new Error('README chip list is stale. Run node scripts/build_cli_chip_list.mjs');
  console.log(`README chip list matches the Analyzer table (${rows.length} rows).`);
} else {
  writeFileSync(target, updated);
  console.log(`Updated npm README chip list (${rows.length} rows).`);
}
