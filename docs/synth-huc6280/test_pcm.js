// SPDX-License-Identifier: BSD-3-Clause
// Software test material shared by ADPCM and CD audio, not chip oscillators.
export const TEST_PCM_RATE=44100;
export function createTestCycle(shape='sine',length=128){
  if(!['sine','triangle','saw','square'].includes(shape))throw new RangeError('Choose Sine, Triangle, Saw or Square');
  if(!Number.isInteger(length)||length<16||length>1024)throw new RangeError('Test cycle must contain 16..1024 points');
  return Float32Array.from({length},(_,i)=>shape==='sine'?Math.sin(i/length*Math.PI*2):shape==='triangle'?1-4*Math.abs(i/length-.5):shape==='saw'?2*i/length-1:i<length/2?1:-1);
}
export function generateTestPcmWav({cycle,frequency=440,level=.5,duration=1,smoothEdges=true}={}){
  if(!(cycle instanceof Float32Array)||cycle.length<16||cycle.length>1024||!cycle.every(n=>Number.isFinite(n)&&n>=-1&&n<=1))throw new TypeError('Expected a finite -1..1 test cycle');
  if(!Number.isFinite(frequency)||frequency<20||frequency>16000)throw new RangeError('Test frequency must be 20..16000 Hz');
  if(!Number.isFinite(level)||level<0||level>1)throw new RangeError('Test level must be 0..1');
  if(!Number.isFinite(duration)||duration<.1||duration>4)throw new RangeError('Test duration must be 0.1..4 seconds');
  if(typeof smoothEdges!=='boolean')throw new TypeError('Edge smoothing must be boolean');
  const frames=Math.round(duration*TEST_PCM_RATE),bytes=new Uint8Array(44+frames*4),view=new DataView(bytes.buffer);
  const tag=(at,text)=>{for(let i=0;i<text.length;i++)bytes[at+i]=text.charCodeAt(i);};
  tag(0,'RIFF');view.setUint32(4,bytes.length-8,true);tag(8,'WAVE');tag(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,TEST_PCM_RATE,true);view.setUint32(28,TEST_PCM_RATE*4,true);view.setUint16(32,4,true);view.setUint16(34,16,true);tag(36,'data');view.setUint32(40,frames*4,true);
  const fade=smoothEdges?Math.round(.005*TEST_PCM_RATE):0;
  for(let i=0;i<frames;i++){
    const position=i*frequency/TEST_PCM_RATE*cycle.length,index=Math.floor(position),fraction=position-index;
    const sample=cycle[index%cycle.length]*(1-fraction)+cycle[(index+1)%cycle.length]*fraction;
    const envelope=fade?Math.min(1,i/fade,(frames-1-i)/fade):1;
    const value=Math.max(-32768,Math.min(32767,Math.round(sample*level*envelope*32767)));
    view.setInt16(44+i*4,value,true);view.setInt16(46+i*4,value,true);
  }
  return bytes;
}

/** Only overwrite a previous generated file if it is still the same revision.
 * project.importFiles validates the complete budget before replacing any file.
 */
export function createTestWaveFiles(project){
  const owned=new Map();
  return{
    save(id,bytes){
      if(!['msm5205','cdda'].includes(id)||!(bytes instanceof Uint8Array))throw new TypeError('Expected a media test WAV');
      const previous=owned.get(id),entry=previous&&project.fs.get(previous.path);
      let path=previous&&entry?.revision===previous.revision?previous.path:null;
      if(!path){const stem=id==='msm5205'?'MSM5205 test wave':'CD-DA test wave',directories=new Set(project.fs.listDirectories());let suffix=1;do{path=`/samples/${stem}${suffix===1?'':` (${suffix})`}.wav`;suffix++;}while(project.fs.has(path)||directories.has(path));}
      project.importFiles([{path,type:'binary',data:bytes}]);
      owned.set(id,{path,revision:project.fs.get(path).revision});
      return path;
    },
    clear(){owned.clear();},
  };
}
