import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Deliberately fixed coverage: a partial calibration must never become System.
export const PLAYGROUND_CALIBRATION_KINDS = Object.freeze([
  'ym2612','ym2203','ym2608','ym2610','ym2610b','ym2151','ym2413','ym3526','ym3812','y8950','ymf262','dx7',
  'segapsg','ay8910','rf5c164','okim6258','gameboy','nes','huc6280','pwm','snes','spc',
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
const REFERENCE_FREQUENCY = 440;
const key = ({kind,role,mode}) => `${role}/${mode}/${kind}`;
const fail = message => {throw new Error(`Invalid Playground Mixer calibration: ${message}`);};
const close = (a,b,tolerance=1e-12) => Math.abs(a-b)<=tolerance*Math.max(1,Math.abs(a),Math.abs(b));
const positive = value => Number.isFinite(value)&&value>1e-6;
const ordered = records => records.sort((a,b)=>a<b?-1:a>b?1:0);

function expectedRoutes() {
  return new Map([
    ...PLAYGROUND_CALIBRATION_KINDS.map(kind=>({kind,role:'extra',mode:'genesis',name:'calibration-source'})),
    ...PLAYGROUND_CALIBRATION_PRIMARIES.map(([mode,kind,name=kind])=>({kind,role:'primary',mode,name})),
  ].map(route=>[key(route),route]));
}

/** Use the report's measured unit-amplitudes and rounded gains verbatim.
 * No nominal chip balance, codec correction, or audio normalization occurs here. */
export function buildPlaygroundMixerDefaults(report) {
  if(report?.schemaVersion!==1||report.passed!==true||report.verify!==false)fail('a successful, non-verification schemaVersion 1 report is required');
  if(!Array.isArray(report.frequencies)||report.frequencies.length!==FREQUENCIES.length||
    FREQUENCIES.some(frequency=>report.frequencies.filter(value=>value===frequency).length!==1))fail('all 220, 440 and 880 Hz captures are required');
  const expected = expectedRoutes(), captures = new Map();
  if(!Array.isArray(report.rows)||report.rows.length!==expected.size*FREQUENCIES.length)fail('all 22 extra and 28 primary routes at three frequencies are required');
  for(const row of report.rows) {
    const identity = row&&expected.get(key(row));
    if(!identity||!FREQUENCIES.includes(row.frequencyHz))fail('unknown capture route or frequency');
    const captureKey = `${key(row)}/${row.frequencyHz}`;
    if(captures.has(captureKey))fail(`duplicate capture ${captureKey}`);
    if(row.defaultCalibration!==true||row.mixer?.id!==identity.name||!positive(row.amplitude))fail(`invalid measured capture ${captureKey}`);
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
  return {
    calibration:{version:1,referenceFrequencyHz:REFERENCE_FREQUENCY,frequencies:[...FREQUENCIES],
      targetAmplitude:calibration.targetAmplitude,referenceAmplitude:calibration.referenceAmplitude,
      maxGain:calibration.maxGain,targetReduced:target<calibration.referenceAmplitude,
      measuredExtraRoutes:PLAYGROUND_CALIBRATION_KINDS.length,measuredPrimaryRoutes:PLAYGROUND_CALIBRATION_PRIMARIES.length},
    factoryDefaults:{version:1,kinds},
    factoryModes:Object.fromEntries(ordered([...modes.keys()]).map(mode=>[mode,{version:1,
      entries:[...modes.get(mode).values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)}])),
  };
}

export function renderPlaygroundMixerDefaults(report) {
  const profile = buildPlaygroundMixerDefaults(report);
  return `// Generated by scripts/generate_playground_mixer_defaults.mjs; do not edit gains here.
// Fixed single-voice output-unit calibration. Timbre, polyphony and authored Mixer values remain unchanged.
import {SoundChipMixer} from '../js/soundchip_mixer.js';

const freeze = value => {
  if(value&&typeof value==='object') {for(const child of Object.values(value))freeze(child);Object.freeze(value);}
  return value;
};
export const PLAYGROUND_MIXER_CALIBRATION = freeze(${JSON.stringify(profile.calibration,null,2)});
const factoryDefaults = freeze(${JSON.stringify(profile.factoryDefaults,null,2)});
const factoryModes = freeze(${JSON.stringify(profile.factoryModes,null,2)});

export function createPlaygroundSoundChipMixer(modeId = 'genesis') {
  if(!Object.hasOwn(factoryModes,modeId))throw new RangeError('No Playground Mixer calibration for mode: '+String(modeId));
  return new SoundChipMixer({factoryDefaults,factoryEntries:factoryModes[modeId]});
}
`;
}

export async function generatePlaygroundMixerDefaults({reportPath,outPath,check=false}) {
  const source = JSON.parse(await readFile(reportPath,'utf8'));
  const output = renderPlaygroundMixerDefaults(source);
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
  return buildPlaygroundMixerDefaults(source).calibration;
}

async function main(args) {
  const options = {outPath:fileURLToPath(new URL('../docs/playground/playground_mixer_defaults.js',import.meta.url))};
  for(let index=0;index<args.length;index++) {
    const arg = args[index];
    if(arg==='--help') {
      console.log('Usage: node scripts/generate_playground_mixer_defaults.mjs --report=<baseline.json> [--out=<module.js>] [--check]');
      return;
    }
    if(arg==='--check') {options.check=true;continue;}
    const match = /^(--report|--out)(?:=(.*))?$/.exec(arg);
    if(!match)throw new Error(`Unknown argument: ${arg}`);
    const value = match[2]??args[++index];
    if(!value||value.startsWith('--'))throw new Error(`Missing value for ${match[1]}`);
    options[match[1]==='--report'?'reportPath':'outPath']=resolve(value);
  }
  if(!options.reportPath)throw new Error('--report is required; only a complete baseline report can generate System defaults');
  const calibration = await generatePlaygroundMixerDefaults(options);
  console.log(`${options.check?'CHECK PASS':'Generated'}: ${options.outPath}; target amplitude ${calibration.targetAmplitude}`);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
