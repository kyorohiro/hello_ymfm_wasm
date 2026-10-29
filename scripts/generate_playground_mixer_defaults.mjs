import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {validatePs1MixerCalibration,validatePs1MixerCalibrationSources} from './ps1_mixer_calibration.mjs';
import {validateWonderSwanMixerCalibration,validateWonderSwanMixerCalibrationSources} from './wonderswan_mixer_calibration.mjs';
import {validatePokeyMixerCalibration,validatePokeyMixerCalibrationSources} from './pokey_mixer_calibration.mjs';

// Deliberately fixed coverage: a partial calibration must never become System.
export const PLAYGROUND_CALIBRATION_KINDS = Object.freeze([
  'ym2612','ym2203','ym2608','ym2610','ym2610b','ym2151','ym2413','ym3526','ym3812','y8950','ymf262','dx7',
  'segapsg','ay8910','rf5c164','okim6258','gameboy','nes','huc6280','pwm','snes','spc',
]);
export const PLAYGROUND_CALIBRATION_ENGINES = Object.freeze([
  Object.freeze({kind:'ym2612',chipEngine:'nuked'}),
]);
export const PLAYGROUND_CALIBRATION_PRIMARIES = Object.freeze([
  ['genesis','ym2612'],['genesis','segapsg'],['mega-cd','rf5c164'],['genesis-full','pwm'],
  ['genesis-full-nuked','ym2612'],['genesis-full-nuked','segapsg'],
  ['pc98-26','ym2203'],['pc98','ym2608'],['neogeo','ym2610'],['neogeo-b','ym2610','ym2610b'],
  ['x68000','ym2151'],['x68000','okim6258'],['master-system','segapsg'],['master-system','ym2413'],
  ['game-gear','segapsg'],['msx','ym2413'],['msx','ay8910'],
  ['msx-audio','y8950'],['msx-audio','ym2413'],['msx-audio','ay8910'],
  ['ym3526','ym3526'],['ym3812','ym3812'],['ymf262','ymf262'],['gameboy','gameboy'],['nes','nes'],
  ['snes','snes'],['pc-engine','huc6280'],['dx7','dx7'],
].map(route=>Object.freeze(route)));
const FREQUENCIES = Object.freeze([220,440,880]);
const GENESIS_MODES = ['genesis','mega-cd','genesis-full','genesis-full-nuked','genesis-nuked'];
const GENESIS_LEGACY_TRIMS = Object.freeze({ym2612:.9,segapsg:.35});
export function playgroundLegacyMixerTrims(modeId) {
  return GENESIS_MODES.includes(modeId)?{...GENESIS_LEGACY_TRIMS}:{};
}
// Authored listening balance, independent of the immutable unit measurements.
export const MIXER_LISTENING_LEVELS = Object.freeze({
  segapsg: 0.35, ay8910: 0.85, nes: 1.16, gameboy: 0.36, huc6280: 0.44,
});
const REFERENCE_FREQUENCY = 440;
const key = ({kind,role,mode,chipEngine}) => `${role}/${mode}/${kind}${chipEngine ? '/'+chipEngine : ''}`;
const fail = message => {throw new Error(`Invalid Playground Mixer calibration: ${message}`);};
const close = (a,b,tolerance=1e-12) => Math.abs(a-b)<=tolerance*Math.max(1,Math.abs(a),Math.abs(b));
const positive = value => Number.isFinite(value)&&value>1e-6;
const ordered = records => records.sort((a,b)=>a<b?-1:a>b?1:0);

function expectedRoutes() {
  return new Map([
    ...PLAYGROUND_CALIBRATION_KINDS.map(kind=>({kind,role:'extra',mode:'genesis',name:'calibration-source'})),
    ...PLAYGROUND_CALIBRATION_ENGINES.map(route=>({...route,role:'extra',mode:'genesis',name:'calibration-source'})),
    ...PLAYGROUND_CALIBRATION_PRIMARIES.map(([mode,kind,name=kind])=>({kind,role:'primary',mode,name})),
  ].map(route=>[key(route),route]));
}

/** Use the report's measured unit-amplitudes and rounded gains verbatim.
 * No nominal chip balance, codec correction, or audio normalization occurs here. */
export function buildPlaygroundMixerDefaults(report) {
  if(report?.gainUnits!==undefined&&!['legacy','source'].includes(report.gainUnits))fail('unknown measured gain units');
  if(report?.schemaVersion!==1||report.passed!==true||report.verify!==false)fail('a successful, non-verification schemaVersion 1 report is required');
  if(!Array.isArray(report.frequencies)||report.frequencies.length!==FREQUENCIES.length||
    FREQUENCIES.some(frequency=>report.frequencies.filter(value=>value===frequency).length!==1))fail('all 220, 440 and 880 Hz captures are required');
  const expected = expectedRoutes(), captures = new Map();
  if(!Array.isArray(report.rows)||report.rows.length!==expected.size*FREQUENCIES.length)fail('all 22 extra kinds, the Nuked extra engine, and 28 primary routes at three frequencies are required');
  for(const row of report.rows) {
    const identity = row&&expected.get(key(row));
    if(!identity||!FREQUENCIES.includes(row.frequencyHz))fail('unknown capture route or frequency');
    const captureKey = `${key(row)}/${row.frequencyHz}`;
    if(captures.has(captureKey))fail(`duplicate capture ${captureKey}`);
    if(row.defaultCalibration!==true||row.mixer?.id!==identity.name||!positive(row.amplitude))fail(`invalid measured capture ${captureKey}`);
    if(identity.chipEngine && row.mixer.engine!==identity.chipEngine)fail(`measured engine does not match ${captureKey}`);
    const settings = row.mixer.settings;
    if(settings?.volume!==1||settings.pan!==0||settings.muted!==false||settings.solo!==true) {
      fail(`baseline capture must use unity, centered, unmuted, solo Mixer settings: ${captureKey}`);
    }
    captures.set(captureKey,row);
  }
  for(const route of expected.values())for(const frequency of FREQUENCIES) {
    if(!captures.has(`${key(route)}/${frequency}`))fail(`missing capture ${key(route)}/${frequency}`);
  }
  const calibration = report.calibration;
  if(!calibration||!Number.isFinite(calibration.targetAmplitude)||calibration.targetAmplitude<=0||!positive(calibration.referenceAmplitude)||
    !Number.isFinite(calibration.maxGain)||calibration.maxGain<=0||calibration.maxGain>2||
    !Array.isArray(calibration.routes)||calibration.routes.length!==expected.size)fail('invalid target, Mixer limit, or calibrated route count');
  const routes = new Map();
  for(const route of calibration.routes) {
    const identity = route&&expected.get(key(route));
    if(!identity||route.name!==identity.name||routes.has(key(route)))fail('unknown, duplicate or incorrectly named calibrated route');
    const capture = captures.get(`${key(route)}/${REFERENCE_FREQUENCY}`);
    if(!positive(route.amplitude)||!close(route.amplitude,capture.amplitude)||
      !Number.isFinite(route.volume)||route.volume<=0||route.volume>calibration.maxGain)fail(`invalid calibrated gain for ${key(route)}`);
    // The measuring runner currently records six decimal places. Accept that
    // rounding, but reject a separately clamped or edited per-route gain.
    if(Math.abs(route.volume-calibration.targetAmplitude/route.amplitude)>0.500001e-6)fail(`gain does not match the shared target for ${key(route)}`);
    routes.set(key(route),route);
  }
  const target = Math.min(calibration.referenceAmplitude,...[...routes.values()].map(route=>route.amplitude*calibration.maxGain));
  if(!close(target,calibration.targetAmplitude))fail('target must be common to every measured route without clamping individual gains');
  const reference = captures.get('primary/genesis/ym2612/440');
  if(!close(calibration.referenceAmplitude,reference.amplitude))fail('reference amplitude must match the measured Genesis YM2612 route');
  const kinds = ordered([...PLAYGROUND_CALIBRATION_KINDS]).map(name=>({name,volume:routes.get(`extra/genesis/${name}`).volume}));
  const engines = PLAYGROUND_CALIBRATION_ENGINES.map(route=>({name:route.kind,engine:route.chipEngine,
    volume:routes.get(key({...route,role:'extra',mode:'genesis'})).volume}));
  const modes = new Map();
  for(const [mode,kind,name=kind] of PLAYGROUND_CALIBRATION_PRIMARIES) {
    const entries = modes.get(mode)??new Map();
    entries.set(name,{id:name,name,settings:{volume:routes.get(`primary/${mode}/${kind}`).volume}});
    modes.set(mode,entries);
  }
  // These machines share the already measured source routes. Keep any direct
  // per-mode measurements above, and fill only the constituent routes missing
  // from that mode; Nuked's measured FM/PSG must remain distinct from ymfm.
  function inherit(mode,source,names=undefined) {
    const entries = modes.get(mode)??new Map();
    for(const [id,entry] of modes.get(source))if(!entries.has(id)&&(!names||names.includes(id))) {
      entries.set(id,structuredClone(entry));
    }
    modes.set(mode,entries);
  }
  inherit('mega-cd','genesis');
  inherit('genesis-full','mega-cd');
  inherit('genesis-full-nuked','genesis-full',['rf5c164','pwm']);
  inherit('genesis-nuked','genesis-full-nuked',['ym2612','segapsg']);
  // Atari ST uses the AY-family Mixer policy. This is an inherited default,
  // not a new measurement of its YM2149 clock/type or analogue output stage.
  inherit('atari-st','msx',['ay8910']);
  // CD system sources start at unity; PSG inherits the existing PC Engine policy.
  inherit('pc-engine-cd','pc-engine');
  return {
    calibration:{version:1,referenceFrequencyHz:REFERENCE_FREQUENCY,frequencies:[...FREQUENCIES],
      targetAmplitude:calibration.targetAmplitude,referenceAmplitude:calibration.referenceAmplitude,
      maxGain:calibration.maxGain,targetReduced:target<calibration.referenceAmplitude,
      measuredExtraRoutes:PLAYGROUND_CALIBRATION_KINDS.length,measuredEngineRoutes:PLAYGROUND_CALIBRATION_ENGINES.length,
      measuredPrimaryRoutes:PLAYGROUND_CALIBRATION_PRIMARIES.length},
    factoryDefaults:{version:1,kinds},
    factoryEngines:{version:1,engines},
    factoryModes:Object.fromEntries(ordered([...modes.keys()]).map(mode=>[mode,{version:1,
      entries:[...modes.get(mode).values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)}])),
  };
}

export function buildPlaygroundMixerPolicy(report,ps1Report=undefined,wonderswanReport=undefined,pokeyReport=undefined) {
  const profile = buildPlaygroundMixerDefaults(report);
  for(const entry of profile.factoryDefaults.kinds) {
    if(Object.hasOwn(MIXER_LISTENING_LEVELS,entry.name))entry.volume=MIXER_LISTENING_LEVELS[entry.name];
  }
  for(const [modeId,mode] of Object.entries(profile.factoryModes))for(const entry of mode.entries) {
    if(report.gainUnits!=='source'&&GENESIS_MODES.includes(modeId)&&Object.hasOwn(GENESIS_LEGACY_TRIMS,entry.name)) {
      entry.settings.volume=Number((entry.settings.volume*GENESIS_LEGACY_TRIMS[entry.name]).toFixed(6));
    }
    if(Object.hasOwn(MIXER_LISTENING_LEVELS,entry.name)) {
      entry.settings.volume=MIXER_LISTENING_LEVELS[entry.name];
    }
  }
  // New sources begin at explicit unity. Keep the complete historical
  // measurement set intact rather than fabricating a calibration capture.
  profile.factoryDefaults.kinds.push({name:'wonderswan',volume:1});
  profile.factoryModes.wonderswan={version:1,entries:[{id:'wonderswan',name:'wonderswan',settings:{volume:1}}]};
  profile.factoryDefaults.kinds.push({name:'pokey',volume:1});
  profile.factoryModes.pokey={version:1,entries:[{id:'pokey',name:'pokey',settings:{volume:1}}]};
  profile.factoryModes['pokey-dual']={version:1,entries:[{id:'pokey',name:'pokey',settings:{volume:1}},{id:'pokey:2',name:'pokey',settings:{volume:1}}]};
  profile.factoryDefaults.kinds.push({name:'ps1',volume:1});
  profile.factoryModes.ps1={version:1,entries:[{id:'ps1',name:'ps1',settings:{volume:1}}]};
  profile.calibration.unmeasuredKinds=['wonderswan','pokey','ps1'];
  if(ps1Report!==undefined) {
    const ps1=validatePs1MixerCalibration(report,ps1Report);
    profile.factoryDefaults.kinds.find(entry=>entry.name==='ps1').volume=ps1.extraVolume;
    profile.factoryModes.ps1.entries[0].settings.volume=ps1.primaryVolume;
    profile.calibration.unmeasuredKinds=['wonderswan','pokey'];
    profile.calibration.extensions={ps1:ps1.metadata};
  }
  if(wonderswanReport!==undefined) {
    const wonderswan=validateWonderSwanMixerCalibration(report,wonderswanReport);
    profile.factoryDefaults.kinds.find(entry=>entry.name==='wonderswan').volume=wonderswan.extraVolume;
    profile.factoryModes.wonderswan.entries[0].settings.volume=wonderswan.primaryVolume;
    profile.calibration.unmeasuredKinds=profile.calibration.unmeasuredKinds.filter(name=>name!=='wonderswan');
    profile.calibration.extensions={...profile.calibration.extensions,wonderswan:wonderswan.metadata};
  }
  if(pokeyReport!==undefined) {
    const pokey=validatePokeyMixerCalibration(report,pokeyReport);
    profile.factoryDefaults.kinds.find(entry=>entry.name==='pokey').volume=pokey.extraVolume;
    profile.factoryModes.pokey.entries[0].settings.volume=pokey.primaryVolume;
    profile.factoryModes['pokey-dual'].entries[0].settings.volume=pokey.dualFirstVolume;
    profile.factoryModes['pokey-dual'].entries[1].settings.volume=pokey.dualSecondVolume;
    profile.calibration.unmeasuredKinds=profile.calibration.unmeasuredKinds.filter(name=>name!=='pokey');
    profile.calibration.extensions={...profile.calibration.extensions,pokey:pokey.metadata};
  }
  return profile;
}

export function renderPlaygroundMixerDefaults(report,ps1Report=undefined,wonderswanReport=undefined,pokeyReport=undefined) {
  const profile = buildPlaygroundMixerPolicy(report,ps1Report,wonderswanReport,pokeyReport);
  return `// Generated by scripts/generate_playground_mixer_defaults.mjs; do not edit gains here.
// Measured output units with explicit listening balance for PSG and wavetable sources.
// Authored Mixer values and raw sound-chip output remain unchanged.
import {SoundChipMixer} from '../js/soundchip_mixer.js';

const freeze = value => {
  if(value&&typeof value==='object') {for(const child of Object.values(value))freeze(child);Object.freeze(value);}
  return value;
};
export const PLAYGROUND_MIXER_CALIBRATION = freeze(${JSON.stringify(profile.calibration,null,2)});
export const PLAYGROUND_MIXER_LISTENING_LEVELS = freeze(${JSON.stringify(MIXER_LISTENING_LEVELS,null,2)});
const factoryDefaults = freeze(${JSON.stringify(profile.factoryDefaults,null,2)});
const factoryEngines = freeze(${JSON.stringify(profile.factoryEngines,null,2)});
const factoryModes = freeze(${JSON.stringify(profile.factoryModes,null,2)});

/** Used only when reading presets written before source-unit Mixer gains. */
export function playgroundLegacyMixerTrims(modeId) {
  return ${JSON.stringify(GENESIS_MODES)}.includes(modeId) ? ${JSON.stringify(GENESIS_LEGACY_TRIMS)} : {};
}

export function createPlaygroundSoundChipMixer(modeId = 'genesis') {
  if(!Object.hasOwn(factoryModes,modeId))throw new RangeError('No Playground Mixer calibration for mode: '+String(modeId));
  return new SoundChipMixer({gainUnits:'source',factoryDefaults,factoryEngines,factoryEntries:factoryModes[modeId]});
}
`;
}

export async function generatePlaygroundMixerDefaults({reportPath,ps1ReportPath,wonderswanReportPath,pokeyReportPath,outPath,check=false}) {
  const source = JSON.parse(await readFile(reportPath,'utf8'));
  const ps1Report=ps1ReportPath===undefined?undefined:JSON.parse(await readFile(ps1ReportPath,'utf8'));
  const wonderswanReport=wonderswanReportPath===undefined?undefined:JSON.parse(await readFile(wonderswanReportPath,'utf8'));
  const pokeyReport=pokeyReportPath===undefined?undefined:JSON.parse(await readFile(pokeyReportPath,'utf8'));
  const output = renderPlaygroundMixerDefaults(source,ps1Report,wonderswanReport,pokeyReport);
  if(ps1Report!==undefined)await validatePs1MixerCalibrationSources({reportPath,ps1Report});
  if(wonderswanReport!==undefined)await validateWonderSwanMixerCalibrationSources({reportPath,wsReport:wonderswanReport});
  if(pokeyReport!==undefined)await validatePokeyMixerCalibrationSources({reportPath,pokeyReport});
  if(check) {
    // Runtime synchronization owns this import's cache version. Ignore only
    // that one parameter; gains and every other byte must still reproduce.
    const current = (await readFile(outPath,'utf8')).replace(
      /^import \{SoundChipMixer\} from '\.\.\/js\/soundchip_mixer\.js\?v=[^'\r\n&?#]+';$/m,
      "import {SoundChipMixer} from '../js/soundchip_mixer.js';");
    if(current!==output)throw new Error(`Generated Playground Mixer defaults are stale: ${outPath}`);
  }else {
    await mkdir(dirname(outPath),{recursive:true});
    await writeFile(outPath,output);
  }
  return ps1Report===undefined&&wonderswanReport===undefined&&pokeyReport===undefined?buildPlaygroundMixerDefaults(source).calibration:buildPlaygroundMixerPolicy(source,ps1Report,wonderswanReport,pokeyReport).calibration;
}

async function main(args) {
  const options = {
    ps1ReportPath:fileURLToPath(new URL('../docs/issues/ps1_cyclic_chip_levels_01.json',import.meta.url)),
    wonderswanReportPath:fileURLToPath(new URL('../docs/issues/wonderswan_cyclic_chip_levels_02.json',import.meta.url)),
    pokeyReportPath:fileURLToPath(new URL('../docs/issues/pokey_cyclic_chip_levels_02.json',import.meta.url)),
    outPath:fileURLToPath(new URL('../docs/playground/playground_mixer_defaults.js',import.meta.url)),
  };
  let noPs1=false,explicitPs1=false,noWonderSwan=false,explicitWonderSwan=false,noPokey=false,explicitPokey=false;
  for(let index=0;index<args.length;index++) {
    const arg = args[index];
    if(arg==='--help') {
      console.log('Usage: node scripts/generate_playground_mixer_defaults.mjs --report=<baseline.json> [--ps1-report=<extension.json> | --no-ps1] [--wonderswan-report=<extension.json> | --no-wonderswan] [--pokey-report=<extension.json> | --no-pokey] [--out=<module.js>] [--check]');
      return;
    }
    if(arg==='--check') {options.check=true;continue;}
    if(arg==='--no-ps1') {noPs1=true;continue;}
    if(arg==='--no-wonderswan') {noWonderSwan=true;continue;}
    if(arg==='--no-pokey') {noPokey=true;continue;}
    const match = /^(--report|--ps1-report|--wonderswan-report|--pokey-report|--out)(?:=(.*))?$/.exec(arg);
    if(!match)throw new Error(`Unknown argument: ${arg}`);
    const value = match[2]??args[++index];
    if(!value||value.startsWith('--'))throw new Error(`Missing value for ${match[1]}`);
    options[match[1]==='--report'?'reportPath':match[1]==='--ps1-report'?'ps1ReportPath':match[1]==='--wonderswan-report'?'wonderswanReportPath':match[1]==='--pokey-report'?'pokeyReportPath':'outPath']=resolve(value);
    if(match[1]==='--ps1-report')explicitPs1=true;
    if(match[1]==='--wonderswan-report')explicitWonderSwan=true;
    if(match[1]==='--pokey-report')explicitPokey=true;
  }
  if(!options.reportPath)throw new Error('--report is required; only a complete baseline report can generate System defaults');
  if(noPs1&&explicitPs1)throw new Error('--no-ps1 cannot be combined with --ps1-report');
  if(noPs1)delete options.ps1ReportPath;
  if(noWonderSwan&&explicitWonderSwan)throw new Error('--no-wonderswan cannot be combined with --wonderswan-report');
  if(noWonderSwan)delete options.wonderswanReportPath;
  if(noPokey&&explicitPokey)throw new Error('--no-pokey cannot be combined with --pokey-report');
  if(noPokey)delete options.pokeyReportPath;
  const calibration = await generatePlaygroundMixerDefaults(options);
  console.log(`${options.check?'CHECK PASS':'Generated'}: ${options.outPath}; target amplitude ${calibration.targetAmplitude}`);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
