#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { readSource, analyzeSource, exportSource, exportFormats, renderSource } from './index.js';

const help = `tetorica-vgm — VGM/VGZ analysis without a browser

  tetorica-vgm analyze FILE [--json]
  tetorica-vgm export FILE --format FORMAT --output FILE [--bpm 120] [--force]
  tetorica-vgm render FILE --output FILE.wav [--max-seconds 120] [--force]

Formats: ${exportFormats.join(', ')}
BPM defaults to the browser score tempo suggestion (fallback: 120).
Output files are never overwritten unless --force is supplied.
Render: standalone YM2612/YM2151/YM2413/YM3526/YM3812/YMF262 (optional Sega PSG),
YM2612 + RF5C164 (optional Sega PSG), standalone YM2203 (FM + internal SSG), Sega PSG alone, AY-3-8910, or Game Boy DMG. Other configurations may require additional WASM factories or ROMs; see CLI.md.
--max-seconds: >0 to 600; loops are not expanded. See CLI.md for limitations.
`;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: {type:'boolean',short:'h'}, version:{type:'boolean',short:'v'}, json:{type:'boolean'},
    format:{type:'string'}, output:{type:'string',short:'o'}, bpm:{type:'string'},
    'max-seconds':{type:'string'}, force:{type:'boolean'},
  } });
  if (values.help) { console.log(help); }
  else if (values.version) {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
    console.log(pkg.version);
  } else {
    const [command, input] = positionals;
    if (!['analyze','export','render'].includes(command) || !input || positionals.length !== 2) throw new Error(help);
    const allowed = { analyze:['json'], export:['format','output','bpm','force'], render:['output','max-seconds','force'] }[command];
    for (const key of Object.keys(values)) if (!allowed.includes(key)) throw new Error(`--${key} is not valid for ${command}`);
    if (command !== 'analyze' && !values.output) throw new Error('--output is required');
    if (command === 'export' && !exportFormats.includes(values.format)) throw new Error(`--format must be one of: ${exportFormats.join(', ')}`);
    const source = await readSource(input);
    if (command === 'analyze') {
      const result = analyzeSource(source);
      console.log(values.json ? JSON.stringify(result, null, 2) : [
        `File: ${input}`, `Chips: ${result.chips.map(c => `${c.id} (${c.clockHz} Hz)`).join(', ') || 'none declared'}`,
        `Declared duration: ${result.declaredDurationSeconds.toFixed(3)} s`,
        `Commands: ${Object.values(result.commandUsage).reduce((a,b)=>a+b,0)}`,
        `Data blocks: ${result.dataBlocks.length}`,
      ].join('\n'));
    } else {
      const result = command === 'export'
        ? exportSource(source, { format: values.format, bpm: values.bpm === undefined ? undefined : Number(values.bpm), fileName: basename(input) })
        : await renderSource(source, { maxSeconds: values['max-seconds'] === undefined ? 120 : Number(values['max-seconds']) });
      await writeFile(values.output, result.bytes ?? result.text, { flag: values.force ? 'w' : 'wx' });
      console.error(`Wrote ${values.output}`);
      if (result.truncated) console.error('Warning: rendering stopped at --max-seconds.');
      for (const warning of result.warnings ?? []) console.error(`Warning: ${warning}`);
    }
  }
} catch (error) {
  console.error(`tetorica-vgm: ${error.message}`);
  process.exitCode = 1;
}
