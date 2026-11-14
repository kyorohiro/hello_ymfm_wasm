// Inert File references and shared native CD-DA bytes only; no audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {File} from 'node:buffer';
import {parseCddaWav,createCddaTrackSource} from '../js/cdda_source.js';
import {createCDDAPCM} from '../js/cdda_pcm.js';
import {createHuc6280CodeProject,HUC6280_PROJECT_FILE_BYTES} from './code_project.js';
import {createCddaSessionFiles,CDDA_SESSION_MAX_FILES,CDDA_SESSION_MAX_FILE_BYTES,
  CDDA_SESSION_MAX_TOTAL_BYTES,isCddaSessionPath} from './cdda_session_files.js';
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};
class MetadataBlob extends Blob {
  constructor(name,size){super([Uint8Array.of(0)]);this.name=name;this.metadataSize=size;this.reads=0;}
  get size(){return this.metadataSize;}
  async arrayBuffer(){this.reads++;throw Error('Metadata-only reference must not be read');}
}
class SlowFile extends File {
  constructor(parts,name,gate){super(parts,name);this.gate=gate;this.reads=0;}
  async arrayBuffer(){this.reads++;await this.gate.promise;return super.arrayBuffer();}
}
class SparseWavBlob extends Blob {
  constructor(pcmBytes,{onSlice}={}) {
    const prefix=wavBytes(4).slice(0,44),view=new DataView(prefix.buffer);
    view.setUint32(4,pcmBytes+36,true);view.setUint32(40,pcmBytes,true);
    super([prefix]);this.prefix=prefix;this.name='sparse.wav';this.metadataSize=pcmBytes+44;this.slices=[];this.fullReads=0;this.onSlice=onSlice;
  }
  get size(){return this.metadataSize;}
  slice(start,end){this.slices.push([start,end]);assert(end<=44,'capacity preflight must skip PCM payload');this.onSlice?.(start,end);return new Blob([this.prefix.subarray(start,end)]);}
  async arrayBuffer(){this.fullReads++;throw Error('Full sparse WAV allocation must not occur in this test');}
}
function wavBytes(pcmBytes) {
  const bytes=new Uint8Array(44+pcmBytes),view=new DataView(bytes.buffer);
  for(const[offset,text]of[[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])bytes.set(new TextEncoder().encode(text),offset);
  view.setUint32(4,bytes.length-8,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);
  view.setUint32(24,44100,true);view.setUint32(28,176400,true);view.setUint16(32,4,true);view.setUint16(34,16,true);view.setUint32(40,pcmBytes,true);
  for(let i=44;i<Math.min(bytes.length,44+128);i+=4){view.setInt16(i,8192,true);view.setInt16(i+2,-4096,true);}
  return bytes;
}

test('session registration is atomic metadata only, with safe unique names and immutable public records',()=>{
  const session=createCddaSessionFiles(),first=new MetadataBlob('A song.wav',1024),second=new MetadataBlob('A song.WAV',2048),changes=[];
  const off=session.subscribe(value=>changes.push(value));
  const paths=session.addFiles([first,second]);assert.deepEqual(paths,['/session-cdda/A-song.wav','/session-cdda/A-song-2.wav']);
  const entries=session.list();assert.deepEqual(entries.map(entry=>entry.size),[1024,2048]);assert(entries.every(entry=>entry.session));
  assert.equal(session.totalBytes,3072);assert.equal(changes.length,1);assert.equal(first.reads+second.reads,0);
  assert(Object.isFrozen(paths));assert(Object.isFrozen(entries));assert(entries.every(Object.isFrozen));
  assert(entries.every(entry=>Object.keys(entry).join(',')==='path,name,size,session'),'no File/Blob enters public or serialized metadata');
  assert.throws(()=>session.addFiles([new MetadataBlob('valid.wav',10),new MetadataBlob('bad.mp3',10)]),/WAV/);
  assert.deepEqual(session.list(),entries);assert.equal(changes.length,1);
  assert.deepEqual(session.addFiles([]),[]);assert.equal(changes.length,1);
  const[valid]=session.addFiles([new MetadataBlob('../valid.wav',10)]);assert.equal(valid,'/session-cdda/valid.wav','an invalid earlier batch did not reserve this name');
  assert(!valid.split('/').includes('..'));assert(session.has(paths[0]));assert(isCddaSessionPath(paths[0]));assert(!isCddaSessionPath('/session-cdda-other/a.wav'));
  off();session.clear();assert.equal(changes.length,2);assert.equal(session.totalBytes,0);assert.deepEqual(session.list(),[]);
  const[again]=session.addFiles([new MetadataBlob('A song.wav',10)]);assert.equal(again,'/session-cdda/A-song-3.wav','old session IDs are never reused after clear');
  session.dispose();assert.deepEqual(session.list(),[]);assert(!session.has(again));assert.throws(()=>session.addFiles([]),{name:'AbortError'});
});

test('per-file, aggregate and 99-file bounds are enforced before any content read or partial registration',()=>{
  const session=createCddaSessionFiles(),edge=new MetadataBlob('edge.wav',CDDA_SESSION_MAX_FILE_BYTES);
  assert.equal(CDDA_SESSION_MAX_FILE_BYTES,256*1024*1024+1024*1024);session.addFiles([edge]);
  assert.equal(edge.reads,0);const before=session.list();
  for(const size of [0,-1,NaN,1.5,CDDA_SESSION_MAX_FILE_BYTES+1])assert.throws(()=>session.addFiles([new MetadataBlob('bad.wav',size)]),/bytes/);
  assert.deepEqual(session.list(),before);
  const remainder=CDDA_SESSION_MAX_TOTAL_BYTES-CDDA_SESSION_MAX_FILE_BYTES;
  session.addFiles([new MetadataBlob('remaining.wav',remainder)]);assert.equal(session.totalBytes,512*1024*1024);
  assert.throws(()=>session.addFiles([new MetadataBlob('overflow.wav',1)]),/512 MiB/);assert.equal(session.list().length,2);
  session.clear();session.addFiles(Array.from({length:CDDA_SESSION_MAX_FILES},(_,i)=>new MetadataBlob(`${i}.wav`,1)));
  assert.equal(session.list().length,99);assert.throws(()=>session.addFiles([new MetadataBlob('hundred.wav',1)]),/99 WAV/);
  assert.throws(()=>session.addFiles([{}]),/99 WAV/);session.clear();assert.throws(()=>session.addFiles([{}]),/File or Blob/);
  assert.equal(session.list().length,0);session.dispose();
});

test('selected reads return fresh owned bytes while File content, other references and portable Files remain untouched',async()=>{
  const session=createCddaSessionFiles(),file=new File([Uint8Array.of(1,2,3,4)],'tone.wav'),other=new MetadataBlob('unused.wav',1024);
  const[path]=session.addFiles([file,other]),a=await session.readFile(path),b=await session.readFile(path);
  assert.notEqual(a.buffer,b.buffer);a.fill(0);assert.deepEqual(b,Uint8Array.of(1,2,3,4));
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()),b);assert.equal(other.reads,0);
  assert.equal(session.list().length,2);assert(!JSON.stringify(session.list()).includes('arrayBuffer'));session.dispose();
});

test('clear, dispose and caller cancellation reject late File reads without reviving old names or bytes',async()=>{
  for(const action of ['clear','dispose','abort']) {
    const session=createCddaSessionFiles(),gate=deferred(),file=new SlowFile([Uint8Array.of(1,2,3,4)],'late.wav',gate),signal=new AbortController();
    const[path]=session.addFiles([file]),pending=session.readFile(path,{signal:signal.signal}),rejected=assert.rejects(pending,{name:'AbortError'});
    assert.equal(file.reads,1);
    if(action==='abort')signal.abort();else session[action]();
    gate.resolve();await rejected;
    if(action!=='abort')assert.deepEqual(session.list(),[]);else assert.equal(session.list().length,1);
    if(action==='clear') {
      const[next]=session.addFiles([new File([Uint8Array.of(5)],'late.wav')]);assert.notEqual(next,path);
      await assert.rejects(session.readFile(path),/no longer available/);assert.deepEqual(await session.readFile(next),Uint8Array.of(5));
    }
    session.dispose();
  }
});

test('a 20 MiB session WAV exceeds the unchanged portable project budget and lazily reaches the actual CD-DA core',async()=>{
  const session=createCddaSessionFiles(),bytes=wavBytes(20*1024*1024),file=new File([bytes],'long.wav'),untouched=new MetadataBlob('other.wav',32*1024*1024);
  const[path]=session.addFiles([file,untouched]);assert(file.size>16*1024*1024);assert.equal(untouched.reads,0);
  const project=createHuc6280CodeProject(),originalProject=project.snapshot();
  assert.equal(HUC6280_PROJECT_FILE_BYTES,16*1024*1024-65536);
  assert.throws(()=>project.importFiles([{path:'/long.wav',type:'binary',data:bytes}]),/16 MiB/);
  assert.deepEqual(project.snapshot(),originalProject,'the separate session route does not raise or consume the portable Files budget');
  const source=createCddaTrackSource({tracks:[{number:7,file:path,title:'Long track'}]},{readFile:session.readFile});
  const track=await source.getTrack(7);assert.equal(track.number,7);assert.equal(track.frames,20*1024*1024/4);
  assert.equal(parseCddaWav(await session.readFile(path)).frames,track.frames);assert.equal(untouched.reads,0);
  const wasmBinary=await readFile(new URL('../generated/cdda_wasm.wasm',import.meta.url)),core=await createCDDAPCM({sampleRate:44100,wasmBinary});
  try {
    core.prepare(track.pcm);core.play();const left=new Float32Array(16),right=new Float32Array(16);core.render(left,right);
    assert.equal(left[0],.25);assert.equal(right[0],-.125);assert(left.every(Number.isFinite));
  }finally{core.dispose();session.dispose();}
});

test('session registration does not pretend to validate WAV contents; the selected shared source enforces the exact format',async()=>{
  const session=createCddaSessionFiles(),invalid=wavBytes(4);new DataView(invalid.buffer).setUint32(24,48000,true);
  const[path]=session.addFiles([new File([invalid],'wrong-rate.wav')]);
  const source=createCddaTrackSource({tracks:[{number:1,file:path}]},{readFile:session.readFile});
  await assert.rejects(source.getTrack(1),/44100 Hz/);
  assert.equal(session.list().length,1,'failed selected parsing leaves registered metadata unchanged');session.dispose();
});

test('large WAV capacity preflight rejects PCM above 256 MiB using only RIFF/chunk headers',async()=>{
  const session=createCddaSessionFiles(),file=new SparseWavBlob(256*1024*1024+4),[path]=session.addFiles([file]);
  assert.equal(file.slices.length,0);assert.equal(file.fullReads,0,'registration is still metadata only');
  await assert.rejects(session.readFile(path),/PCM exceeds the 256 MiB/);
  assert.deepEqual(file.slices,[[0,12],[12,20],[36,44]]);assert.equal(file.fullReads,0);
  assert.equal(session.list().length,1);session.dispose();
});

test('exact 256 MiB PCM plus WAV headers passes the complete preflight without allocating sparse PCM',async()=>{
  const session=createCddaSessionFiles(),file=new SparseWavBlob(256*1024*1024),[path]=session.addFiles([file]);
  await assert.rejects(session.readFile(path),/Full sparse WAV allocation must not occur in this test/);
  assert.deepEqual(file.slices,[[0,12],[12,20],[36,44]]);
  assert.equal(file.fullReads,1,'only after the valid headers pass does reading the selected body become eligible');session.dispose();
});

test('cancellation and registry changes during large valid-capacity header reads prevent full allocation',async()=>{
  for(const action of ['abort','clear','dispose']) {
    const session=createCddaSessionFiles(),controller=new AbortController();
    const file=new SparseWavBlob(256*1024*1024,{onSlice:start=>{if(start===36){if(action==='abort')controller.abort();else session[action]();}}});
    const[path]=session.addFiles([file]);
    await assert.rejects(session.readFile(path,{signal:controller.signal}),{name:'AbortError'});
    assert.deepEqual(file.slices,[[0,12],[12,20],[36,44]]);assert.equal(file.fullReads,0);
    if(action==='abort')assert.equal(session.list().length,1);else assert.equal(session.list().length,0);
    session.dispose();
  }
});

test('misnamed large files reject from their small header before any full-file read',async()=>{
  const session=createCddaSessionFiles(),file=new SparseWavBlob(256*1024*1024);
  file.prefix[0]=0;const[path]=session.addFiles([file]);
  await assert.rejects(session.readFile(path),/RIFF\/WAVE header/);assert.deepEqual(file.slices,[[0,12]]);assert.equal(file.fullReads,0);session.dispose();
});

test('large non-audio chunks are skipped by length and reject above the 1 MiB header budget',async()=>{
  const session=createCddaSessionFiles(),file=new SparseWavBlob(256*1024*1024);
  file.prefix.set(new TextEncoder().encode('JUNK'),12);new DataView(file.prefix.buffer).setUint32(16,1024*1024+4,true);
  const[path]=session.addFiles([file]);
  await assert.rejects(session.readFile(path),/non-audio headers exceed the 1 MiB/);
  assert.deepEqual(file.slices,[[0,12],[12,20]]);assert.equal(file.fullReads,0);session.dispose();
});

test('large files cannot cause an unbounded tiny-chunk header walk',async()=>{
  const session=createCddaSessionFiles(),file=new SparseWavBlob(256*1024*1024),prefix=new Uint8Array(12+300*8);
  prefix.set(file.prefix.subarray(0,12));
  for(let i=0;i<300;i++)prefix.set(new TextEncoder().encode('JUNK'),12+i*8);
  file.slice=(start,end)=>{file.slices.push([start,end]);assert(end<=prefix.length);return new Blob([prefix.subarray(start,end)]);};
  const[path]=session.addFiles([file]);
  await assert.rejects(session.readFile(path),/bounded 256-chunk/);
  assert.equal(file.slices.length,257);assert.equal(file.fullReads,0);session.dispose();
});
