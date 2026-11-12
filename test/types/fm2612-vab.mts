// Installed consumer: identical API in NodeNext, Bundler and DOM without Node types.
import {readVab,prepareVabTone,exportVab,MAX_VAB_FILE_BYTES} from 'tetorica-fm2612';
import {readVab as readJs,prepareVabTone as prepareJs,exportVab as exportJs} from 'tetorica-fm2612/ps1_vab.js';
import {readVab as readBare,prepareVabTone as prepareBare,exportVab as exportBare} from 'tetorica-fm2612/ps1_vab';
import type {Ps1VabBank,Ps1VabProgram,Ps1VabTone,Ps1VabSample,Ps1VabPreparedTone,Ps1VabExportOptions} from 'tetorica-fm2612/ps1_vab.js';
import type {Ps1VabBank as BareBank} from 'tetorica-fm2612/ps1_vab';
import type {Ps1VabBank as RootBank} from 'tetorica-fm2612';
import {Ps1Synth} from 'tetorica-fm2612/ps1synth.js';
import {createPs1Client} from 'tetorica-fm2612/playground_ps1.js';
import type {Ps1InstrumentProcessor} from 'tetorica-fm2612/playground_ps1_worklet.js';

type IsAny<T> = 0 extends (1 & T) ? true : false;
type Assert<T extends true> = T;
type BankIsTyped = Assert<IsAny<ReturnType<typeof readVab>> extends false ? true : false>;
type PreparedIsTyped = Assert<IsAny<ReturnType<typeof prepareVabTone>['preset']> extends false ? true : false>;
type SampleIsTyped = Assert<IsAny<ReturnType<typeof readVab>['samples'][number]['bytes']> extends false ? true : false>;
// Cache query strings must not erase the local PS1 module's inferred types.
type ClientStateIsTyped = Assert<IsAny<ReturnType<ReturnType<typeof createPs1Client>['_getState']>> extends false ? true : false>;
type WorkletSynthIsTyped = Assert<IsAny<Ps1InstrumentProcessor['synth']> extends false ? true : false>;
type WorkletValidationIsTyped = Assert<IsAny<Ps1InstrumentProcessor['validation']> extends false ? true : false>;

const readIdentity:typeof readVab = readJs, readBareIdentity:typeof readVab = readBare;
const prepareIdentity:typeof prepareVabTone = prepareJs, prepareBareIdentity:typeof prepareVabTone = prepareBare;
const exportIdentity:typeof exportVab = exportJs, exportBareIdentity:typeof exportVab = exportBare;
const bytes = new Uint8Array(4096), header = new DataView(bytes.buffer,16,2048);
const source:BufferSource = header;
const bank:Ps1VabBank = readVab(source);
declare const hostBytes:BufferSource;
readVab(hostBytes);
const split:BareBank = readJs(header,new Uint8Array(128));
const rootBank:RootBank = readBare(new ArrayBuffer(4096));
readVab(new Uint16Array(4096));
readVab(new DataView(new SharedArrayBuffer(4096)));
const version:6|7 = bank.version, program:Ps1VabProgram = bank.programs[0];
const tone:Ps1VabTone = program.tones[0], sample:Ps1VabSample = bank.samples[0];
const adpcm:Uint8Array = sample.bytes;
const prepared:Ps1VabPreparedTone = prepareVabTone(bank,0);
const options:Ps1VabExportOptions = {toneNumber:1};
const full:Uint8Array = exportVab(bank), single:Uint8Array = exportJs(bank,options);
const roundTrip:Ps1VabBank = readVab(single);
const limit:number = MAX_VAB_FILE_BYTES;
declare const synth:Ps1Synth;
const loaded = synth.loadADPCM(prepared.adpcm,prepared.options);
synth.setPreset(0,{...prepared.preset,sample:loaded});
declare const port:MessagePort;
const client = createPs1Client(port);
const clientSample = await client.loadADPCM(prepared.adpcm,prepared.options);
await client.setPreset(0,{...prepared.preset,sample:clientSample});
void [readIdentity,readBareIdentity,prepareIdentity,prepareBareIdentity,exportIdentity,exportBareIdentity,
  split,rootBank,version,tone,adpcm,full,roundTrip,limit];

// @ts-expect-error File paths must be read by the host; the parser takes bytes.
readVab('/banks/voice.vab');
// @ts-expect-error Split VB bodies are byte buffers, not numeric arrays.
readVab(header,[0,1]);
// @ts-expect-error A Tone selection is a global numeric index in bank.tones.
prepareVabTone(bank,'3:0');
// @ts-expect-error Parsed bank metadata is required, not arbitrary bytes.
prepareVabTone(bytes,0);
// @ts-expect-error Selected export takes an options descriptor.
exportVab(bank,0);
// @ts-expect-error Program is not a global Tone index; choose bank.tones explicitly.
exportVab(bank,{program:3});
// @ts-expect-error No JSON conversion flag exists; output is standard VAB bytes.
exportVab(bank,{format:'json'});
// @ts-expect-error Tuning is a number of Hz.
prepared.options.baseFrequencyHz='440';
// @ts-expect-error Samples are binary Uint8Array data.
const wrongSample:number[] = sample.bytes;
// @ts-expect-error Preparing a Tone is synchronous, not a live audio Promise.
const wrongPrepared:Promise<Ps1VabPreparedTone> = prepareVabTone(bank,0);
// @ts-expect-error Upload the ADPCM first; preparation cannot invent a live sample ID.
prepared.preset.sample;
