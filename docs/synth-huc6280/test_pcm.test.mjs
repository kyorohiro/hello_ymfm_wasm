import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestCycle,generateTestPcmWav,createTestWaveFiles,TEST_PCM_RATE} from './test_pcm.js';
import {createHuc6280CodeProject,HUC6280_PROJECT_FILE_BYTES} from './code_project.js';

const tag=(bytes,offset,length)=>new TextDecoder().decode(bytes.subarray(offset,offset+length));
function decode(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),frames=view.getUint32(40,true)/4;
  return {view,frames,sample:(frame,side=0)=>view.getInt16(44+frame*4+side*2,true)};
}
function levelOf(wav){
  let peak=0,sum=0,squares=0,crossings=0,previous=0;
  for(let frame=0;frame<wav.frames;frame++){
    const value=wav.sample(frame);peak=Math.max(peak,Math.abs(value));sum+=value;squares+=value*value;
    if(frame&&previous<=0&&value>0)crossings++;previous=value;
  }
  return {peak,mean:sum/wav.frames,rms:Math.sqrt(squares/wav.frames),crossings};
}
const makeWave=options=>generateTestPcmWav({cycle:createTestCycle(),duration:.1,...options});
const projectState=project=>({settings:project.settings,selectedPath:project.selectedPath,codeState:project.getCodeState(),name:project.cassetteName});

test('software cycles have the expected shape landmarks and independent bounded storage',()=>{
  const sine=createTestCycle(),triangle=createTestCycle('triangle'),saw=createTestCycle('saw'),square=createTestCycle('square');
  assert.equal(sine.length,128);assert.equal(sine[0],0);assert.equal(sine[32],1);assert.equal(sine[96],-1);
  assert.equal(triangle[0],-1);assert.equal(triangle[32],0);assert.equal(triangle[64],1);assert.equal(triangle[96],0);
  assert.equal(saw[0],-1);assert.equal(saw[64],0);assert(saw[127]>.98&&saw[127]<1);
  assert(square.subarray(0,64).every(value=>value===1));assert(square.subarray(64).every(value=>value===-1));
  for(const shape of ['sine','triangle','saw','square'])for(const length of [16,1024]){
    const cycle=createTestCycle(shape,length);assert(cycle instanceof Float32Array);assert.equal(cycle.length,length);
    assert(cycle.every(value=>Number.isFinite(value)&&value>=-1&&value<=1));
  }
  const another=createTestCycle();sine.fill(.25);assert.notDeepEqual(another,sine);assert.equal(another[32],1);
  for(const shape of ['noise','Sine','',null])assert.throws(()=>createTestCycle(shape),/Sine.*Triangle.*Saw.*Square/);
  for(const length of [15,1025,16.5,NaN,Infinity,'128'])assert.throws(()=>createTestCycle('sine',length),/16.*1024/);
});

test('test WAVs are exact little-endian stereo PCM16 at 44100 Hz with a complete bounded header',()=>{
  const duration=.12345,bytes=makeWave({duration}),wav=decode(bytes),frames=Math.round(duration*44100),view=wav.view;
  assert(bytes instanceof Uint8Array);assert.equal(TEST_PCM_RATE,44100);
  assert.equal(tag(bytes,0,4),'RIFF');assert.equal(tag(bytes,8,4),'WAVE');assert.equal(tag(bytes,12,4),'fmt ');assert.equal(tag(bytes,36,4),'data');
  assert.equal(view.getUint32(4,true),bytes.byteLength-8);assert.equal(view.getUint32(16,true),16);
  assert.equal(view.getUint16(20,true),1);assert.equal(view.getUint16(22,true),2);assert.equal(view.getUint32(24,true),44100);
  assert.equal(view.getUint32(28,true),176400);assert.equal(view.getUint16(32,true),4);assert.equal(view.getUint16(34,true),16);
  assert.equal(view.getUint32(40,true),frames*4);assert.equal(bytes.byteLength,44+frames*4);assert.equal(wav.frames,frames);
  for(let frame=0;frame<frames;frame++)assert.equal(wav.sample(frame,0),wav.sample(frame,1),'mono test material is copied to both stereo channels');
  const minimum=makeWave({duration:.1,frequency:20,level:0}),maximum=makeWave({duration:4,frequency:16000,level:1,cycle:createTestCycle('square',1024)});
  assert.equal(minimum.byteLength,44+4410*4);assert.equal(maximum.byteLength,44+176400*4);
  assert(maximum.byteLength<706000,'the largest allowed waveform stays below 706 kB');
});

test('requested frequency and PCM level control actual samples without clipping or channel imbalance',()=>{
  const cycle=createTestCycle(),full=decode(makeWave({cycle,frequency:441,level:1,duration:1,smoothEdges:false}));
  const quarter=decode(makeWave({cycle,frequency:441,level:.25,duration:1,smoothEdges:false}));
  const measured=levelOf(full),quiet=levelOf(quarter);
  assert.equal(measured.crossings,441);assert.equal(measured.peak,32767);assert(Math.abs(measured.mean)<1);
  assert(Math.abs(measured.rms/32767-Math.SQRT1_2)<.001,'interpolated sine keeps the expected RMS');
  assert(Math.abs(quiet.rms/measured.rms-.25)<.0001);assert(Math.abs(quiet.peak-32767*.25)<=1);
  for(let frame=0;frame<full.frames;frame++)assert(Math.abs(quarter.sample(frame)*4-full.sample(frame))<=2,'only PCM quantization affects the level ratio');
  for(const frequency of [20,1000,16000]){
    const wav=decode(makeWave({frequency,smoothEdges:false})),actual=levelOf(wav).crossings/(wav.frames/44100);
    assert(Math.abs(actual-frequency)<=10,`${frequency} Hz remains within one cycle of the short capture`);
  }
  const silent=decode(makeWave({level:0}));assert.equal(levelOf(silent).peak,0);
});

test('optional edge smoothing fades both ends over about five milliseconds and leaves the middle level intact',()=>{
  const cycle=new Float32Array(128).fill(1),plain=decode(makeWave({cycle,level:.5,smoothEdges:false}));
  const smooth=decode(makeWave({cycle,level:.5,smoothEdges:true}));
  assert.equal(plain.sample(0),plain.sample(plain.frames-1));assert(plain.sample(0)>16000);
  assert.equal(smooth.sample(0),0);assert.equal(smooth.sample(smooth.frames-1),0);
  for(const frame of [110,smooth.frames-111])assert(smooth.sample(frame)>plain.sample(frame)*.45&&smooth.sample(frame)<plain.sample(frame)*.55);
  assert.equal(smooth.sample(265),plain.sample(265));assert.equal(smooth.sample(Math.floor(smooth.frames/2)),plain.sample(0));
  let previous=0;
  for(let frame=0;frame<265;frame++){assert(smooth.sample(frame)>=previous);assert(smooth.sample(frame)-previous<100);previous=smooth.sample(frame);}
});

test('drawn cycle values and returned WAV bytes have independent ownership',()=>{
  const storage=new Float32Array(20).fill(.125),cycle=storage.subarray(2,18);cycle.fill(.75,0,8);cycle.fill(-.25,8);
  const before=storage.slice(),options={cycle,frequency:441,level:1,duration:.1,smoothEdges:false};
  const first=generateTestPcmWav(options),original=first.slice(),wav=decode(first);
  assert(Math.abs(wav.sample(0)-.75*32767)<=1);assert(Math.abs(wav.sample(50)+.25*32767)<=1,'the drawn negative half-cycle is used');
  assert.deepEqual(storage,before);assert.equal(options.cycle,cycle);
  first.fill(0);assert.deepEqual(generateTestPcmWav(options),original,'mutating a returned WAV cannot change subsequent rendering');
  assert.deepEqual(storage,before);
});

test('invalid generation parameters reject without mutating the source cycle or changing later valid output',()=>{
  const cycle=createTestCycle(),before=cycle.slice(),valid=makeWave({cycle});
  const invalidCycles=[null,Array.from(cycle),new Float64Array(128),new Float32Array(15),new Float32Array(1025),
    Float32Array.from(cycle,(_,index)=>index===3?NaN:0),Float32Array.from(cycle,(_,index)=>index===3?Infinity:0),new Float32Array(16).fill(1.01)];
  for(const value of invalidCycles)assert.throws(()=>makeWave({cycle:value}),/test cycle/);
  for(const [key,values]of Object.entries({frequency:[19.99,16000.01,NaN,Infinity,'440'],level:[-.01,1.01,NaN,Infinity,'0.5'],duration:[.099,4.001,NaN,Infinity,'1'],smoothEdges:[0,1,'true',null]}))
    for(const value of values){assert.throws(()=>makeWave({cycle,[key]:value}));assert.deepEqual(cycle,before);}
  assert.deepEqual(makeWave({cycle}),valid);
});

test('generated files reuse only their own unchanged revisions and keep project/editor state intact',()=>{
  const project=createHuc6280CodeProject({starterCode:'// kept'});project.select('/index.js');project.setCodeState({mode:'code',path:'/index.js'});
  const files=createTestWaveFiles(project),before=projectState(project),first=makeWave({frequency:220}),firstCopy=first.slice();
  const path=files.save('msm5205',first),revision=project.fs.get(path).revision;
  assert.equal(path,'/samples/MSM5205 test wave.wav');assert.deepEqual(project.fs.get(path).data,firstCopy);assert.equal(project.fs.get(path).type,'binary');
  first.fill(0);assert.deepEqual(project.fs.get(path).data,firstCopy,'Files owns its own copied bytes');
  const second=makeWave({frequency:660});assert.equal(files.save('msm5205',second),path);assert(project.fs.get(path).revision>revision);
  const cdda=files.save('cdda',makeWave({frequency:880}));assert.equal(cdda,'/samples/CD-DA test wave.wav');assert.notEqual(cdda,path);
  assert.equal(files.save('cdda',makeWave({frequency:990})),cdda);assert.equal(project.fs.list().length,3);
  assert.deepEqual(projectState(project),before);assert.equal(project.fs.get('/index.js').data,'// kept');
});

test('preexisting files and directories are preserved while generated names find an unused suffix',()=>{
  const project=createHuc6280CodeProject(),user=Uint8Array.of(7,8,9),base='/samples/MSM5205 test wave.wav';
  project.importFiles([{path:base,type:'binary',data:user},{path:'/samples/MSM5205 test wave (2).wav',type:'text',data:'User notes'}]);
  project.fs.mkdir('/samples/CD-DA test wave.wav');
  const files=createTestWaveFiles(project),wav=makeWave();
  assert.equal(files.save('msm5205',wav),'/samples/MSM5205 test wave (3).wav');
  assert.equal(files.save('cdda',wav),'/samples/CD-DA test wave (2).wav');
  assert.deepEqual(project.fs.get(base).data,user);assert.equal(project.fs.get('/samples/MSM5205 test wave (2).wav').data,'User notes');
  assert.equal(project.fs.stat('/samples/CD-DA test wave.wav').type,'directory');
});

test('user edits and delete/recreate revisions revoke generated-file ownership; clear never deletes files',()=>{
  const project=createHuc6280CodeProject(),files=createTestWaveFiles(project),wav=makeWave();
  const path=files.save('msm5205',wav),edited=Uint8Array.of(99,42);project.fs.writeBinary(path,edited);
  const next=files.save('msm5205',makeWave({frequency:880}));assert.notEqual(next,path);assert.deepEqual(project.fs.get(path).data,edited);
  const cdda=files.save('cdda',wav),revision=project.fs.get(cdda).revision;
  project.fs.delete(cdda);project.fs.writeBinary(cdda,wav);assert(project.fs.get(cdda).revision>revision);
  assert.notEqual(files.save('cdda',makeWave({frequency:330})),cdda,'identical replacement bytes still belong to the user');
  const before=project.fs.snapshot();files.clear();assert.deepEqual(project.fs.snapshot(),before);
  const afterClear=files.save('msm5205',wav);assert.notEqual(afterClear,next);assert.deepEqual(project.fs.get(next).data,makeWave({frequency:880}));
});

test('invalid save requests and real project-budget failures are atomic and retain reusable ownership',()=>{
  const project=createHuc6280CodeProject({starterCode:'// keep'}),files=createTestWaveFiles(project),wav=makeWave();
  const empty=project.snapshot();
  for(const id of ['huc6280','../outside','',null])assert.throws(()=>files.save(id,wav),/media test WAV/);
  for(const bytes of [null,[],new ArrayBuffer(8),'RIFF'])assert.throws(()=>files.save('cdda',bytes),/media test WAV/);
  assert.deepEqual(project.snapshot(),empty);
  const path=files.save('msm5205',wav),used=project.listEntries().reduce((sum,file)=>sum+file.size,0);
  project.importFiles([{path:'/padding.bin',type:'binary',data:new Uint8Array(HUC6280_PROJECT_FILE_BYTES-used)}]);
  const before=project.listEntries(),state=projectState(project),revision=project.fs.get(path).revision;
  let changes=0;const unsubscribe=project.onDidChange(()=>changes++);
  assert.throws(()=>files.save('msm5205',makeWave({duration:.2})),/16 MiB/);
  assert.throws(()=>files.save('cdda',wav),/16 MiB/);
  assert.equal(changes,0);assert.deepEqual(project.listEntries(),before);assert.deepEqual(projectState(project),state);
  assert.equal(project.fs.get(path).revision,revision);assert.deepEqual(project.fs.get(path).data,wav);
  const replacement=makeWave({frequency:770});assert.equal(files.save('msm5205',replacement),path,'failed expansion retains ownership of the old file');
  assert.deepEqual(project.fs.get(path).data,replacement);
  project.fs.delete('/padding.bin');assert.equal(files.save('cdda',wav),'/samples/CD-DA test wave.wav','failed first save did not reserve or create a path');
  unsubscribe();
});
