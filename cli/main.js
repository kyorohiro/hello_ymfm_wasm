#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { readSourceDocument, inspectSourceSupport, listSourceScoreChannels, exportNodeSamples, listSourceSamples, analyzeSource, exportSource, exportFormats, renderSource } from './index.js';

const help = `tetorica-vgm — VGM/VGZ/S98 analysis without a browser

  tetorica-vgm support FILE [--json]
  tetorica-vgm samples FILE [--json]
  tetorica-vgm samples FILE (--id N | --all) --output FILE [--force]
  tetorica-vgm score-channels FILE [--json]
  tetorica-vgm analyze FILE [--json]
  tetorica-vgm export FILE --format FORMAT --output FILE [--bpm 120] [--force]
  tetorica-vgm render FILE --output FILE.wav [--max-seconds 120] [--force]

Formats: ${exportFormats.join(', ')}
Snapshot formats tfi/vgi/opm require --at SECONDS --channel N (1-based).
--channels ID,ID: select MusicXML/LilyPond staves; list IDs with score-channels.
BPM defaults to the browser score tempo suggestion (fallback: 120).
Output files are never overwritten unless --force is supplied.
--mute ID,ID: existing Browser mute controls (see CLI.md); unsupported IDs fail.
Render: standalone YM2612/YM2151/YM2413/YM3526/YM3812/YMF262 (optional Sega PSG),
YM2612 + RF5C164 (optional Sega PSG), standalone YM2203 (FM + internal SSG), YM2608 and YM2610/B (FM / SSG / ADPCM), Sega PSG alone, AY-3-8910, or Game Boy DMG. Other configurations may require additional WASM factories or ROMs; see CLI.md.
Y8950 (FM / embedded ADPCM, optional Sega PSG) is supported.
OKIM6258 alone or with YM2151 is supported (4-bit ADPCM only).
YMF278B (FM / PCM, optional Sega PSG) is supported.
32X PWM alone or with Genesis FM / PSG / RF5C164 uses the Browser PWM approximation.
MSX: any subset of AY-3-8910 / YM2413 / Y8950 / K051649 (one of each) is supported.
Sega PCM with embedded samples, alone or with YM2151, optionally with Sega PSG, is supported.
--ymf278b-rom FILE: 2097152-byte wave ROM; needed for PCM key-on without embedded sample blocks.
--ym2608-rom FILE: 8192-byte rhythm ROM for YM2608; required only for rhythm key-on.
--start SECONDS: render and discard preceding PCM; start + max-seconds <= 600.
--max-seconds: output duration >0 to 600; loops are not expanded. See CLI.md for limitations.
`;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: {type:'boolean',short:'h'}, version:{type:'boolean',short:'v'}, json:{type:'boolean'},
    start:{type:'string'}, mute:{type:'string'}, channels:{type:'string'}, occurrence:{type:'string'}, id:{type:'string'}, all:{type:'boolean'}, at:{type:'string'}, channel:{type:'string'}, format:{type:'string'}, output:{type:'string',short:'o'}, bpm:{type:'string'},
    'ymf278b-rom':{type:'string'}, 'ym2608-rom':{type:'string'}, 'max-seconds':{type:'string'}, force:{type:'boolean'},
  } });
  if (values.help) { console.log(help); }
  else if (values.version) {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
    console.log(pkg.version);
  } else {
    const [command, input] = positionals;
    if (!['support','score-channels','samples','analyze','export','render'].includes(command) || !input || positionals.length !== 2) throw new Error(help);
    const allowed = { support:['json'], 'score-channels':['json'], samples:['json','id','all','output','force','format','occurrence'], analyze:['json'], export:['format','output','bpm','force','at','channel','channels'], render:['start','mute','output','max-seconds','force','ym2608-rom','ymf278b-rom'] }[command];
    for (const key of Object.keys(values)) if (!allowed.includes(key)) throw new Error(`--${key} is not valid for ${command}`);
    if (!['support','score-channels','analyze','samples'].includes(command) && !values.output) throw new Error('--output is required');
    if (command === 'export' && !exportFormats.includes(values.format)) throw new Error(`--format must be one of: ${exportFormats.join(', ')}`);
    const source = await readSourceDocument(input);
    if(command==='support'){
      const result=await inspectSourceSupport(source);
      console.log(values.json ? JSON.stringify(result,null,2) : [
        'Declared chips: '+result.declaredChips.map(c=>c.id).join(', '),
        'Render: '+result.render.status+(result.render.reason?' — '+result.render.reason:''),
        'Required ROMs: '+(result.render.requiredRoms??[]).join(', '),
        ...Object.entries(result.exports).map(([format,entry])=>format+': '+entry.status+(entry.reason?' — '+entry.reason:'')),
        ...result.limitations,
      ].join('\n'));
    } else if(command==='score-channels'){
      const result=listSourceScoreChannels(source);
      console.log(values.json?JSON.stringify(result,null,2):result.channels.map(ch=>ch.id+' · '+ch.name+' · '+ch.noteCount+' notes').join('\n'));
      for(const warning of result.warnings)console.error('Warning: '+warning);
    } else if (command === 'samples' && (values.id!==undefined || values.all!==undefined)) {
      if(values.json)throw new Error('--json is for sample listing only');
      if(!values.output)throw new Error('--output is required');
      const result=await exportNodeSamples(source,{format:values.format??'native',occurrence:values.occurrence===undefined?1:Number(values.occurrence),id:values.id===undefined?undefined:Number(values.id),all:values.all??false});
      await writeFile(values.output,result.bytes,{flag:values.force?'w':'wx'});
      console.error('Wrote '+values.output);
      for(const warning of result.warnings)console.error('Warning: '+warning);
    } else if (command === 'samples') {
      if(values.output!==undefined || values.force!==undefined || values.format!==undefined || values.occurrence!==undefined)throw new Error('--output/--force are not valid for sample listing');
      const result=await listSourceSamples(source);
      console.log(values.json ? JSON.stringify(result,null,2) :
        result.samples.map(s=>[s.id,s.chip,s.kind,s.representation,s.size+' bytes',s.exportable?'available':'missing/partial'].join(' · ')).join('\n') || 'No supported samples found.');
      for(const warning of result.warnings) console.error('Warning: '+warning);
    } else if (command === 'analyze') {
      const result = analyzeSource(source);
      console.log(values.json ? JSON.stringify(result, null, 2) : [
        `File: ${input}`, ...(result.sourceHeader ? [`Source: ${result.sourceHeader.format}`, `Source tag: ${result.sourceHeader.tag}`] : []), `Chips: ${result.chips.map(c => `${c.id} (${c.clockHz} Hz)`).join(', ') || 'none declared'}`,
        `Declared duration: ${result.declaredDurationSeconds.toFixed(3)} s`,
        `Commands: ${Object.values(result.commandUsage).reduce((a,b)=>a+b,0)}`,
        `Data blocks: ${result.dataBlocks.length}`,
      ].join('\n'));
    } else {
      const result = command === 'export'
        ? exportSource(source, { format: values.format, channels:values.channels===undefined?undefined:values.channels.split(','), atSeconds: values.at === undefined ? undefined : Number(values.at), channel: values.channel === undefined ? undefined : Number(values.channel), bpm: values.bpm === undefined ? undefined : Number(values.bpm), fileName: basename(input) })
        : await renderSource(source, { startSeconds:values.start===undefined?0:Number(values.start), mute:values.mute===undefined?[]:values.mute.split(','), maxSeconds: values['max-seconds'] === undefined ? 120 : Number(values['max-seconds']), roms: { ...(values['ym2608-rom'] === undefined ? {} : {ym2608AdpcmA:await readFile(values['ym2608-rom'])}), ...(values['ymf278b-rom'] === undefined ? {} : {ymf278bWave:await readFile(values['ymf278b-rom'])}) } });
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
