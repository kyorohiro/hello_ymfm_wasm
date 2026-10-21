#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile, readFile, open } from 'node:fs/promises';
import { basename } from 'node:path';
import { vgmToJson, jsonToVgm, readSourceDocument, inspectSourceSupport, listSourceScoreChannels, exportNodeSamples, listSourceSamples, analyzeSource, exportSource, exportFormats, renderSource } from './index.js';
import { isSpcSource, analyzeSpcSource, listSpcScoreChannels, exportSpcAnalysis } from './spc.js';

const help = `tetorica-vgm — VGM/VGZ/S98/SPC analysis without a browser

  tetorica-vgm to-json FILE --output FILE.json [--comments] [--force]
  tetorica-vgm from-json FILE.json --output FILE.vgm [--force]
  tetorica-vgm support FILE [--json]
  tetorica-vgm samples FILE [--json]
  tetorica-vgm samples FILE (--id N | --all) --output FILE [--force]
  tetorica-vgm score-channels FILE [--json]
  tetorica-vgm analyze FILE [--json]
  tetorica-vgm export FILE --format FORMAT --output FILE [--bpm 120] [--force]
  tetorica-vgm render FILE --output FILE.wav [--max-seconds 120] [--force]

Formats: ${exportFormats.join(', ')}
Snapshot formats sbi/tfi/vgi/opm require --at SECONDS --channel N (1-based).
--group Name=ID,ID (repeatable) or --merge-all: group score channels.
--channels ID,ID: select MusicXML/LilyPond staves; list IDs with score-channels.
BPM defaults to the browser score tempo suggestion (fallback: 120).
SPC analyze/support/score-channels/export options:
--spc-seconds N: capture the first N seconds (0.1–600; default: min(120, tag duration)).
--spc-control-step-ms N: coalesce continuous controls (0–1000; default: 20; 0 keeps all).
--spc-references FILE.json: array of {sampleId, note, cents?} or {sampleId, referenceHz}.
SPC exports: midi, musicxml, lilypond; references affect analysis/exports only.
SPC capture limits: 20,000 events, 256 BRR versions, 64,512 total BRR bytes.
SPC PCM rendering, sample export and lossless JSON are not supported by this CLI.
Output files are never overwritten unless --force is supplied.
--mute ID,ID: existing Browser mute controls (see CLI.md); unsupported IDs fail.
Render: standalone YM2612/YM2151/YM2413/YM3526/YM3812/YMF262 (optional Sega PSG),
YM2612 + RF5C164 (optional Sega PSG), standalone YM2203 (FM + internal SSG), YM2608 and YM2610/B (FM / SSG / ADPCM), Sega PSG alone, AY-3-8910, or Game Boy DMG. Other configurations may require additional WASM factories or ROMs; see CLI.md.
Y8950 (FM / embedded ADPCM, optional Sega PSG) is supported.
OKIM6295 alone or with YM2151 / YM2164 / YM3812 is supported (embedded sample ROM).
OKIM6258 alone or with YM2151 is supported (4-bit ADPCM only).
YMF278B (FM / PCM, optional Sega PSG) is supported.
32X PWM alone or with Genesis FM / PSG / RF5C164 uses the shared C++/WASM PWM core.
MSX: any subset of AY-3-8910 / YM2413 / Y8950 / K051649 or K052539 / YM2151 or YM2164 (one of each family) is supported.
Sega PCM with embedded samples, alone or with YM2151, optionally with Sega PSG, is supported.
--ymf278b-rom FILE: 2097152-byte wave ROM; needed for PCM key-on without embedded sample blocks.
--ym2608-rom FILE: 8192-byte rhythm ROM for YM2608; required only for rhythm key-on.
--start SECONDS: render and discard preceding PCM; start + max-seconds <= 600.
--max-seconds: output duration >0 to 600; loops are not expanded. See CLI.md for limitations.
`;

const spcOptionNames = ['spc-seconds','spc-control-step-ms','spc-references'];
const spcCommands = ['analyze','support','score-channels','export'];
const spcFormats = ['midi','musicxml','lilypond'];

// Detect the signature before the register-stream decoder sees the input. Read
// only a header for other formats, and reject oversized SPCs before loading RAM.
async function readSpcInput(path) {
  const file = await open(path, 'r');
  try {
    const header = new Uint8Array(32);
    const {bytesRead} = await file.read(header, 0, header.length, 0);
    if (!isSpcSource(header.subarray(0,bytesRead))) return null;
    const maximum = 16 * 1024 * 1024;
    if ((await file.stat()).size > maximum) throw new RangeError('SPC exceeds the 16 MiB file limit');
    // Explicit positioned reads above do not advance the file handle offset.
    const bytes = await file.readFile();
    if (bytes.length > maximum) throw new RangeError('SPC exceeds the 16 MiB file limit');
    return bytes;
  } finally { await file.close(); }
}

async function spcOptions(values) {
  const options = {};
  for (const [flag,key,min,max] of [['spc-seconds','durationSeconds',.1,600],['spc-control-step-ms','controlStepMs',0,1000]]) {
    if (values[flag] === undefined) continue;
    const value = Number(values[flag]);
    if (!values[flag].trim() || !Number.isFinite(value) || value < min || value > max) throw new RangeError(`--${flag} must be a finite number from ${min} to ${max}`);
    options[key] = value;
  }
  if (values['spc-references'] !== undefined) {
    const file = await open(values['spc-references'],'r');
    try {
      if ((await file.stat()).size > 1024 * 1024) throw new RangeError('SPC reference JSON exceeds the 1 MiB limit');
      const text = await file.readFile('utf8');
      if (Buffer.byteLength(text) > 1024 * 1024) throw new RangeError('SPC reference JSON exceeds the 1 MiB limit');
      options.references = JSON.parse(text);
      if (!Array.isArray(options.references)) throw new TypeError('--spc-references must contain a JSON array');
    } finally { await file.close(); }
  }
  return options;
}

function inspectSpcSupport(score) {
  const exports = {};
  for (const format of exportFormats) {
    if (!spcFormats.includes(format)) {
      exports[format] = {status:'unsupported',reason:'SPC exports support midi, musicxml and lilypond only.'};
      continue;
    }
    try {
      const result = exportSpcAnalysis(score,{format,bpm:120});
      exports[format] = {status:'available',...(result.warnings ? {warnings:result.warnings} : {})};
    } catch (error) { exports[format] = {status:'unavailable',reason:error.message}; }
  }
  return {
    schemaVersion:1,format:'SPC',metadata:score.metadata,
    declaredChips:[{id:'snes',name:'SNES S-DSP'}],
    analysis:{status:'available',durationSeconds:score.durationSeconds},
    render:{status:'unsupported',code:'SPC_RENDER_UNSUPPORTED',reason:'SPC PCM rendering is not included in this Node CLI.'},
    exportProbeOptions:{bpm:120},exports,
    scoreChannels:{status:'available',result:listSpcScoreChannels(score)},
    samples:{status:'unsupported',reason:'SPC sample listing/export is not included in this Node CLI; analyze includes captured BRR reference metadata.'},
    limitations:[
      `Analysis and exports cover only the first ${score.durationSeconds} seconds; they do not imply the complete song.`,
      'Capture limits: 20,000 events, 256 BRR versions and 64,512 total BRR bytes. Exceeding a limit fails without writing output; use a shorter interval or a larger control step.',
      'Export probes use the real exporters at BPM 120 and write no files. Available output may be empty or approximate.',
      ...score.warnings,
    ],
  };
}

async function runSpcCommand(command, input, bytes, values) {
  if (!spcCommands.includes(command)) throw new Error(`SPC ${command} is not supported. Use analyze, support, score-channels, or export (midi/musicxml/lilypond).`);
  if (command === 'export') {
    if (!spcFormats.includes(values.format)) throw new Error('SPC export supports midi, musicxml and lilypond only');
    if (values.at !== undefined || values.channel !== undefined) throw new Error('SPC export does not accept --at or --channel; use --channels for score staves');
  }
  const score = await analyzeSpcSource(bytes,await spcOptions(values));
  if (command === 'analyze') {
    console.log(values.json ? JSON.stringify(score,null,2) : [
      `File: ${input}`, 'Source: SPC', 'Chips: SNES S-DSP (8 voices)',
      `Captured duration: ${score.durationSeconds.toFixed(3)} s (initial interval only)`,
      'Note timeline: 44,100 display ticks per second; SPC event clock: 1,024,000 Hz',
      'Capture limits: 20,000 events; 256 BRR versions; 64,512 total BRR bytes (exceeding limits fails, never silently truncates)',
      `Note segments: ${score.channels.reduce((sum,ch)=>sum+ch.notes.length,0)}`,
      `BRR versions: ${score.samples.length}`,
      ...score.samples.map(sample=>`BRR ${sample.id ?? sample.sampleId}: ${sample.referenceHz ?? 'provisional'} Hz at PITCH 4096 (${sample.referenceKind ?? sample.kind ?? 'reference'})`),
    ].join('\n'));
  } else if (command === 'score-channels') {
    const result = listSpcScoreChannels(score);
    console.log(values.json ? JSON.stringify(result,null,2) : result.channels.map(ch=>`${ch.id} · ${ch.name} · ${ch.noteCount} notes`).join('\n'));
  } else if (command === 'support') {
    const result = inspectSpcSupport(score);
    console.log(values.json ? JSON.stringify(result,null,2) : [
      'Declared chips: snes',
      'Render: '+result.render.status+' — '+result.render.reason,
      ...Object.entries(result.exports).map(([format,entry])=>format+': '+entry.status+(entry.reason?' — '+entry.reason:'')),
      ...result.limitations,
    ].join('\n'));
    return;
  } else {
    const result = exportSpcAnalysis(score,{
      format:values.format,bpm:values.bpm === undefined ? undefined : Number(values.bpm),fileName:basename(input),
      group:values.group,mergeAll:values['merge-all'],channels:values.channels === undefined ? undefined : values.channels.split(','),
    });
    await writeFile(values.output,result.bytes ?? result.text,{flag:values.force?'w':'wx'});
    console.error('Wrote '+values.output);
    for (const warning of result.warnings ?? []) console.error('Warning: '+warning);
    return;
  }
  for (const warning of score.warnings) console.error('Warning: '+warning);
}
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    comments:{type:'boolean'}, help: {type:'boolean',short:'h'}, version:{type:'boolean',short:'v'}, json:{type:'boolean'},
    group:{type:'string',multiple:true}, 'merge-all':{type:'boolean'}, start:{type:'string'}, mute:{type:'string'}, channels:{type:'string'}, occurrence:{type:'string'}, id:{type:'string'}, all:{type:'boolean'}, at:{type:'string'}, channel:{type:'string'}, format:{type:'string'}, output:{type:'string',short:'o'}, bpm:{type:'string'},
    'ymf278b-rom':{type:'string'}, 'ym2608-rom':{type:'string'}, 'max-seconds':{type:'string'}, force:{type:'boolean'},
    'spc-seconds':{type:'string'}, 'spc-control-step-ms':{type:'string'}, 'spc-references':{type:'string'},
  } });
  if (values.help) { console.log(help); }
  else if (values.version) {
    const pkg = JSON.parse(await readFile(new URL('../packages/vgm/package.json', import.meta.url)));
    console.log(pkg.version);
  } else {
    const [command, input] = positionals;
    if (!['to-json','from-json','support','score-channels','samples','analyze','export','render'].includes(command) || !input || positionals.length !== 2) throw new Error(help);
    const allowed = { 'to-json':['output','force','comments'], 'from-json':['output','force'], support:['json'], 'score-channels':['json'], samples:['json','id','all','output','force','format','occurrence'], analyze:['json'], export:['format','output','bpm','force','at','channel','channels','group','merge-all'], render:['start','mute','output','max-seconds','force','ym2608-rom','ymf278b-rom'] }[command];
    if (spcCommands.includes(command)) allowed.push(...spcOptionNames);
    for (const key of Object.keys(values)) if (!allowed.includes(key)) throw new Error(`--${key} is not valid for ${command}`);
    if (!['support','score-channels','analyze','samples'].includes(command) && !values.output) throw new Error('--output is required');
    if (command === 'export' && !exportFormats.includes(values.format)) throw new Error(`--format must be one of: ${exportFormats.join(', ')}`);
    const spcInput = await readSpcInput(input);
    if (!spcInput) {
      for (const flag of spcOptionNames) if (values[flag] !== undefined) throw new Error(`--${flag} requires an SPC input`);
    }
    if (spcInput) await runSpcCommand(command,input,spcInput,values);
    else if(command==='to-json' || command==='from-json'){
      let output;
      if(command==='from-json') output=jsonToVgm(JSON.parse(await readFile(input,'utf8')));
      else {
        const document=await readSourceDocument(input);
        if(document.sourceHeader)throw new Error('Lossless JSON accepts VGM/VGZ only, not S98');
        output=JSON.stringify(vgmToJson(document.bytes,{comments:values.comments??false}),null,2)+'\n';
      }
      await writeFile(values.output,output,{flag:values.force?'w':'wx'});
      console.error('Wrote '+values.output);
    } else {
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
          ? exportSource(source, { format: values.format, group:values.group, mergeAll:values['merge-all'], channels:values.channels===undefined?undefined:values.channels.split(','), atSeconds: values.at === undefined ? undefined : Number(values.at), channel: values.channel === undefined ? undefined : Number(values.channel), bpm: values.bpm === undefined ? undefined : Number(values.bpm), fileName: basename(input) })
          : await renderSource(source, { startSeconds:values.start===undefined?0:Number(values.start), mute:values.mute===undefined?[]:values.mute.split(','), maxSeconds: values['max-seconds'] === undefined ? 120 : Number(values['max-seconds']), roms: { ...(values['ym2608-rom'] === undefined ? {} : {ym2608AdpcmA:await readFile(values['ym2608-rom'])}), ...(values['ymf278b-rom'] === undefined ? {} : {ymf278bWave:await readFile(values['ymf278b-rom'])}) } });
        await writeFile(values.output, result.bytes ?? result.text, { flag: values.force ? 'w' : 'wx' });
        console.error(`Wrote ${values.output}`);
        if (result.truncated) console.error('Warning: rendering stopped at --max-seconds.');
        for (const warning of result.warnings ?? []) console.error(`Warning: ${warning}`);
      }
    }
  }
} catch (error) {
  console.error(`tetorica-vgm: ${error.message}`);
  process.exitCode = 1;
}
