// SPDX-License-Identifier: BSD-3-Clause
// A silent tap of the live instrument before Master. Never taps song/loop audio.
export class SnesLoopCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();this.capture=null;
    this.port.onmessage=({data})=>{
      if(data.method==='cancel'){this.capture=null;return;}
      if(data.method==='start') {
        if(!Number.isInteger(data.maxFrames)||data.maxFrames<1||data.maxFrames>Math.ceil(120*sampleRate))return;
        this.capture={id:data.id,startFrame:currentFrame,frames:0,bodyFrames:null,tailFrames:Math.ceil(.25*sampleRate),maxFrames:data.maxFrames,chunks:[]};
        this.port.postMessage({id:data.id,started:true,startFrame:currentFrame});
      } else if(data.method==='finish'&&this.capture?.id===data.id&&this.capture.bodyFrames===null) {
        this.capture.bodyFrames=this.capture.frames;
      }
    };
  }
  process(inputs,outputs) {
    for(const channel of outputs[0]??[])channel.fill(0);
    const c=this.capture;if(!c)return true;
    const input=inputs[0]??[],size=outputs[0]?.[0]?.length??128;
    if(c.bodyFrames===null&&c.frames>=c.maxFrames) {
      c.bodyFrames=c.frames;this.port.postMessage({id:c.id,ending:true});
    }
    const count=Math.min(size,c.bodyFrames===null?c.maxFrames-c.frames:c.bodyFrames+c.tailFrames-c.frames);
    if(count>0) {
      const left=new Float32Array(count),right=new Float32Array(count);
      if(input[0])left.set(input[0].subarray(0,count));
      if(input[1]??input[0])right.set((input[1]??input[0]).subarray(0,count));
      c.chunks.push([left,right]);c.frames+=count;
    }
    if(c.bodyFrames!==null&&c.frames>=c.bodyFrames+c.tailFrames) {
      const left=new Float32Array(c.frames),right=new Float32Array(c.frames);let offset=0;
      for(const [l,r]of c.chunks){left.set(l,offset);right.set(r,offset);offset+=l.length;}
      this.capture=null;this.port.postMessage({id:c.id,done:true,startFrame:c.startFrame,bodyFrames:c.bodyFrames,left,right},[left.buffer,right.buffer]);
    }
    return true;
  }
}
registerProcessor('tetorica-snes-loop-capture',SnesLoopCaptureProcessor);
