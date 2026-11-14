// SPDX-License-Identifier: BSD-3-Clause
// App-local, one-pass checkpoints. No changes to the shared VgmPlayer API.
import {estimateHuc6280SongStateBytes} from './song_state.js';

const states=new WeakMap(),MAX_BYTES=64*1024*1024;
const parserKeys=['position','ended','dataBanks','bankBlocks','decompressionTables','bankBlocksSeen','rf5c164BlocksSeen','pwmBlocks','pwmBlocksSeen','dataBlocks','dataBlockInfo','streams','dataBankCursor','pendingYm2612DataBankWrite','pcmRamWrites'];
const playerKeys=['queuedFrames','waitAccumulator','pendingWaitSamples','processedEvents','processedWaitSamples','playing','paused','prefetchFactor','maxFillStepsPerProcess'];
const integer=(value,max,label)=>{if(!Number.isSafeInteger(value)||value<0||value>max)throw RangeError(`Invalid HuC6280 checkpoint ${label}`);return value;};
function context({source,player,timeline,engine,mask}){
  if(!source||typeof source!=='object'||!(source.bytes instanceof Uint8Array)||!player?.parser||player.engine!==engine||timeline?.engine!==engine)throw Error('HuC6280 checkpoint needs its matching source/player/timeline/engine');
  const bytes=player.parser.bytes,original=source.bytes;
  if(!(bytes instanceof Uint8Array)||bytes.buffer!==original.buffer||bytes.byteOffset!==original.byteOffset||bytes.byteLength!==original.byteLength)throw Error('HuC6280 checkpoint source identity differs');
  if(player.loopEnabled!==false||player.checkpointIntervalSeconds!==0)throw Error('HuC6280 app checkpoints require one-pass playback with shared checkpoints disabled');
  for(const method of ['supportsState','saveState','validateState','loadState'])if(typeof engine[method]!=='function')throw Error('HuC6280 native state saving unavailable');
  for(const method of ['saveState','validateState','loadState','prepareState'])if(typeof timeline[method]!=='function')throw Error('HuC6280 timeline state saving unavailable');
  if(!engine.supportsState())throw Error('HuC6280 native state saving unavailable');
  const rate=engine.sampleRate();integer(rate,384000,'sample rate');if(rate<8000)throw RangeError('Invalid HuC6280 checkpoint sample rate');
  integer(mask,63,'channel mask');if(engine.channelMask!==undefined&&engine.channelMask!==mask)throw Error('HuC6280 checkpoint output mask differs');
  return rate;
}
function playerGraph(player){
  const parser=Object.fromEntries(parserKeys.map(key=>[key,player.parser[key]]));
  const data={parser,queue:player.chunkQueue};for(const key of playerKeys)data[key]=player[key];return data;
}
function validatePlayer(data,source,rate,frame,timelineFrames){
  integer(frame,Number.MAX_SAFE_INTEGER,'producer frame');integer(data.queuedFrames,Number.MAX_SAFE_INTEGER,'queued frames');
  integer(data.waitAccumulator,44099,'fractional wait');integer(data.pendingWaitSamples,65535,'pending wait');
  integer(data.processedEvents,4_000_000,'event count');integer(data.processedWaitSamples,44100*3600,'wait count');
  if(typeof data.playing!=='boolean'||typeof data.paused!=='boolean'||data.playing&&data.paused)throw Error('Invalid HuC6280 checkpoint playback flags');
  if(!Number.isFinite(data.prefetchFactor)||data.prefetchFactor<1||data.prefetchFactor>8)throw Error('Invalid HuC6280 checkpoint prefetch factor');
  integer(data.maxFillStepsPerProcess,1_000_000,'fill steps');if(!data.maxFillStepsPerProcess)throw Error('Invalid HuC6280 checkpoint fill steps');
  if(!Array.isArray(data.queue)||data.queue.length>262144)throw Error('Invalid HuC6280 checkpoint PCM queue');
  let frames=0;for(const chunk of data.queue){
    if(!(chunk.left instanceof Float32Array)||!(chunk.right instanceof Float32Array)||chunk.left.length!==chunk.right.length)throw Error('Invalid HuC6280 checkpoint PCM chunk');
    integer(chunk.offset,chunk.left.length,'PCM offset');frames+=chunk.left.length-chunk.offset;
    if(!chunk.left.every(Number.isFinite)||!chunk.right.every(Number.isFinite))throw Error('Non-finite HuC6280 checkpoint PCM');
  }
  if(frames!==data.queuedFrames||Math.floor(data.processedWaitSamples*rate/44100)-frames!==frame||timelineFrames!==frame+frames)throw Error('HuC6280 checkpoint producer cursor differs from its native/queued PCM');
  const parser=data.parser;
  integer(parser.position,source.bytes.length,'parser position');if(typeof parser.ended!=='boolean'||parser.position<0x40)throw Error('Invalid HuC6280 checkpoint parser cursor');
  for(const key of ['dataBanks','bankBlocks','decompressionTables','streams'])if(!(parser[key] instanceof Map))throw Error('Invalid HuC6280 checkpoint parser map');
  for(const key of ['bankBlocksSeen','rf5c164BlocksSeen','pwmBlocksSeen'])if(!(parser[key] instanceof Set))throw Error('Invalid HuC6280 checkpoint parser set');
  for(const key of ['pwmBlocks','dataBlocks','dataBlockInfo','pcmRamWrites'])if(!Array.isArray(parser[key]))throw Error('Invalid HuC6280 checkpoint parser list');
  integer(parser.dataBankCursor,source.bytes.length,'data bank cursor');
}

/** Capture at the producer cursor, including prefetch PCM and pending Live
 * deltas. source is an immutable prepared-source identity, not a file name.
 * Oversized graphs are rejected before the parser's expensive deep clone. */
export function captureHuc6280SongCheckpoint({source,player,timeline,engine,frame,mask,maxBytes=8*1024*1024}){
  const rate=context({source,player,timeline,engine,mask});integer(maxBytes,MAX_BYTES,'byte budget');if(!maxBytes)throw Error('HuC6280 checkpoint byte budget is empty');
  if(source.bytes.byteLength>maxBytes)throw RangeError('HuC6280 checkpoint exceeds its byte budget');
  const raw=playerGraph(player),estimated=estimateHuc6280SongStateBytes(raw);
  if(estimated+512+256>maxBytes)throw RangeError('HuC6280 checkpoint exceeds its byte budget');
  if(frame!==player.renderedPositionFrames())throw Error('HuC6280 checkpoint frame must be the player producer cursor');
  validatePlayer(raw,source,rate,frame,timeline.generatedFrames);
  const parser=player.parser.savePlaybackState();
  if(Object.keys(parser).sort().join('|')!==[...parserKeys].sort().join('|'))throw Error('HuC6280 parser state contract changed');
  const data=structuredClone({...raw,parser}),native=engine.saveState(),observation=timeline.saveState();
  const byteLength=estimateHuc6280SongStateBytes(data)+native.byteLength+observation.byteLength+256;
  if(byteLength>maxBytes)throw RangeError('HuC6280 checkpoint exceeds its byte budget');
  const state=Object.freeze({frame,rate,mask,byteLength});states.set(state,{source,bytes:source.bytes,data,native,observation});return state;
}

function prepareRestore(state,options){
  const saved=states.get(state),rate=context(options);
  if(!saved||saved.source!==options.source||saved.bytes!==options.source.bytes||state.rate!==rate||state.mask!==options.mask)throw Error('Invalid or incompatible HuC6280 song checkpoint');
  // Allocate and validate all JS copies before the first native mutation.
  const data=structuredClone(saved.data);validatePlayer(data,options.source,rate,state.frame,saved.observation.generatedFrames);
  options.engine.validateState(saved.native);const commitTimeline=options.timeline.prepareState(saved.observation);return{saved,data,commitTimeline};
}
export function validateHuc6280SongCheckpoint(state,options){prepareRestore(state,options);return true;}

/** Restore only into a fresh/reset one-pass candidate. Its private hasLooped
 * bit therefore stays false; output nodes and source ownership are not state. */
export function restoreHuc6280SongCheckpoint(state,options){
  const {saved,data,commitTimeline}=prepareRestore(state,options),{player,timeline,engine}=options;
  if(player.processedEvents!==0||player.processedWaitSamples!==0||player.pendingWaitSamples!==0||player.waitAccumulator!==0||player.queuedFrames!==0||player.chunkQueue.length||player.parser.position!==player.parser.header.dataOffset||player.parser.ended||timeline.generatedFrames!==0||timeline.readFrame!==0)
    throw Error('HuC6280 checkpoint restore requires a fresh/reset candidate');
  engine.loadState(saved.native);
  // Parser public playback fields are already a detached, alias-preserving
  // graph. Its shared loadPlaybackState would clone it a second time here.
  for(const key of parserKeys)player.parser[key]=data.parser[key];player.chunkQueue=data.queue;
  for(const key of playerKeys)player[key]=data[key];commitTimeline();return state.frame;
}
