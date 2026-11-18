// SPDX-License-Identifier: BSD-3-Clause
import {encodeAdpcmB} from '../js/adpcm_b_sample.js';

const SCALES = [57,57,57,57,77,102,128,153];
const BLOCK = 16, HORIZON = 32, MAX_BEAM = 16, SHORT_SAMPLE = 4096;
const STEP_BUCKET = Uint8Array.from({length:24577},(_,step) => step < 127 ? 0 : Math.floor(Math.log2(step/127)*2));
const clampPredictor = value => Math.max(-32768,Math.min(32767,value));
const nextStep = (step,code) => Math.max(127,Math.min(24576,Math.floor(step*SCALES[code&7]/64)));
const delta = (step,code) => Math.floor((2*(code&7)+1)*step/8)*(code&8?-1:1);
const codeAt = (bytes,index) => bytes[index>>1]>>(index&1?0:4)&15;

function targetsFor({channels,sampleRate},encoded) {
  const mono = new Float32Array(channels[0].length);
  for(let index=0;index<mono.length;index++) {
    let value=0;
    for(const channel of channels)value+=Math.max(-1,Math.min(1,channel[index]))/channels.length;
    mono[index]=value;
  }
  const targets=new Int32Array(encoded.paddedFrames);
  for(let index=0;index<encoded.frames;index++) {
    const position=Math.min(index*sampleRate/encoded.sampleRate,mono.length-1),first=Math.floor(position),fraction=position-first;
    const value=mono[first]*(1-fraction)+mono[Math.min(first+1,mono.length-1)]*fraction;
    targets[index]=Math.round(value*(value<0?32768:32767));
  }
  return targets;
}

function metrics(bytes,targets) {
  const tail=bytes.at(-1)&15;
  let predictor=0,step=127,repeatPredictor=delta(127,tail),repeatStep=nextStep(127,tail);
  let fresh=0,repeat=0,max=0,repeatMax=0,minValue=32767,maxValue=-32768,repeatMinValue=32767,repeatMaxValue=-32768,maxJump=0,repeatMaxJump=0;
  let previous=0,repeatPrevious=repeatPredictor;
  for(let index=0;index<targets.length;index++) {
    const code=codeAt(bytes,index);
    predictor=clampPredictor(predictor+delta(step,code));step=nextStep(step,code);
    const error=predictor-targets[index];fresh+=error*error;max=Math.max(max,Math.abs(error));
    minValue=Math.min(minValue,predictor);maxValue=Math.max(maxValue,predictor);
    maxJump=Math.max(maxJump,Math.abs(predictor-previous));previous=predictor;
    // ymfm Repeat resets before decoding the final nibble. Its resulting
    // predictor/step also seeds the following cycle, unlike a fresh preview.
    if(index===targets.length-1){repeatPredictor=0;repeatStep=127;}
    repeatPredictor=clampPredictor(repeatPredictor+delta(repeatStep,code));repeatStep=nextStep(repeatStep,code);
    repeat+=(repeatPredictor-targets[index])**2;
    repeatMax=Math.max(repeatMax,Math.abs(repeatPredictor-targets[index]));
    repeatMinValue=Math.min(repeatMinValue,repeatPredictor);repeatMaxValue=Math.max(repeatMaxValue,repeatPredictor);
    repeatMaxJump=Math.max(repeatMaxJump,Math.abs(repeatPredictor-repeatPrevious));repeatPrevious=repeatPredictor;
  }
  return {fresh,repeat,max,repeatMax,minValue,maxValue,repeatMinValue,repeatMaxValue,maxJump,repeatMaxJump};
}

// Keep long WAV work bounded: inspect the whole ordinary encoding, then search
// its first128 frames and sixteen worst16-frame regions. All other frames use
// greedy encoding from the candidate's actual state, never splice incompatible
// predictor histories. Short instrument cycles can afford full lookahead.
function searchRegions(bytes,targets) {
  if(targets.length<=SHORT_SAMPLE)return null;
  const selected=new Set(Array.from({length:8},(_,index) => index));
  const worst=[],scores=[];
  let predictor=0,step=127,score=0,lowest=0;
  for(let index=0;index<targets.length;index++) {
    const code=codeAt(bytes,index);
    predictor=clampPredictor(predictor+delta(step,code));step=nextStep(step,code);
    score+=(predictor-targets[index])**2;
    if(index%BLOCK!==BLOCK-1)continue;
    if(worst.length<16){worst.push(Math.floor(index/BLOCK));scores.push(score);}
    else if(score>scores[lowest]){worst[lowest]=Math.floor(index/BLOCK);scores[lowest]=score;}
    lowest=0;for(let at=1;at<scores.length;at++)if(scores[at]<scores[lowest])lowest=at;
    score=0;
  }
  for(const block of worst){selected.add(block);if(block)selected.add(block-1);}
  return selected;
}

function workspace() {
  return {p:new Int32Array(MAX_BEAM),s:new Int32Array(MAX_BEAM),cost:new Float64Array(MAX_BEAM),
    np:new Int32Array(MAX_BEAM),ns:new Int32Array(MAX_BEAM),nc:new Float64Array(MAX_BEAM),
    cp:new Int32Array(MAX_BEAM*16),cs:new Int32Array(MAX_BEAM*16),cc:new Float64Array(MAX_BEAM*16),
    parent:new Uint8Array(HORIZON*MAX_BEAM),code:new Uint8Array(HORIZON*MAX_BEAM),
    chosen:new Int16Array(MAX_BEAM),bucket:new Int16Array(MAX_BEAM),path:new Uint8Array(HORIZON)};
}

function search(targets,offset,predictor,step,width,diverse,w,bounds) {
  let count=1;w.p[0]=predictor;w.s[0]=step;w.cost[0]=0;
  const depth=Math.min(HORIZON,targets.length-offset);
  for(let time=0;time<depth;time++) {
    const candidates=count*16,target=targets[offset+time];
    for(let parent=0;parent<count;parent++)for(let code=0;code<16;code++) {
      const index=parent*16+code,p=clampPredictor(w.p[parent]+delta(w.s[parent],code));
      w.cp[index]=p;w.cs[index]=nextStep(w.s[parent],code);
      w.cc[index]=p<bounds.minValue||p>bounds.maxValue||Math.abs(p-w.p[parent])>bounds.maxJump?Infinity:w.cost[parent]+(p-target)**2;
    }
    let nextCount=0;
    if(diverse) {
      // Keep different adaptation speeds alive. A plain least-error beam drops
      // the larger-step paths before it can see a coming square-wave edge.
      w.bucket.fill(-1);
      for(let index=0;index<candidates;index++) {
        if(!Number.isFinite(w.cc[index]))continue;
        const bucket=STEP_BUCKET[w.cs[index]],old=w.bucket[bucket];
        if(old<0||w.cc[index]<w.cc[old])w.bucket[bucket]=index;
      }
      const indices=Array.from(w.bucket).filter(index => index>=0).sort((a,b) => w.cc[a]-w.cc[b]);
      nextCount=Math.min(width,indices.length);for(let index=0;index<nextCount;index++)w.chosen[index]=indices[index];
    } else {
      nextCount=Math.min(width,candidates);
      for(let selected=0;selected<nextCount;selected++) {
        let best=-1;
        for(let index=0;index<candidates;index++)if(best<0||w.cc[index]<w.cc[best])best=index;
        if(!Number.isFinite(w.cc[best])){nextCount=selected;break;}
        w.chosen[selected]=best;w.nc[selected]=w.cc[best];w.cc[best]=Infinity;
      }
    }
    if(!nextCount)return null;
    for(let index=0;index<nextCount;index++) {
      const chosen=w.chosen[index];
      w.np[index]=w.cp[chosen];w.ns[index]=w.cs[chosen];
      if(diverse)w.nc[index]=w.cc[chosen];
      w.parent[time*MAX_BEAM+index]=Math.floor(chosen/16);w.code[time*MAX_BEAM+index]=chosen&15;
    }
    w.p.set(w.np);w.s.set(w.ns);w.cost.set(w.nc);count=nextCount;
  }
  let index=0;
  for(let time=depth-1;time>=0;time--){w.path[time]=w.code[time*MAX_BEAM+index];index=w.parent[time*MAX_BEAM+index];}
  return w.path;
}

function candidate(targets,regions,diverse,bounds) {
  const bytes=new Uint8Array(targets.length/2),w=workspace();
  let predictor=0,step=127;
  for(let offset=0;offset<targets.length;offset+=BLOCK) {
    const path=!regions||regions.has(offset/BLOCK)?search(targets,offset,predictor,step,diverse?16:8,diverse,w,bounds):null;
    for(let at=0;at<Math.min(BLOCK,targets.length-offset);at++) {
      const index=offset+at;
      let code=path?.[at];
      if(code===undefined) {
        let error=Infinity;
        for(let option=0;option<16;option++) {
          const distance=Math.abs(clampPredictor(predictor+delta(step,option))-targets[index]);
          if(distance<error){error=distance;code=option;}
        }
      }
      bytes[index>>1]|=code<<(index&1?0:4);
      predictor=clampPredictor(predictor+delta(step,code));step=nextStep(step,code);
    }
  }
  return bytes;
}

/** App-only bounded lookahead for software PCM/WAV -> OPNA ADPCM-B.
 * PCM targets, timing, Float32 downmix, interpolation and32-byte padding remain
 * unchanged. Fresh/Repeat error, decoded extrema and discontinuities may not
 * worsen; otherwise the shared greedy encoding is returned. No core/imported-ADPCM
 * state is changed, and this cannot remove the initial step127 hardware limit.
 */
export function encodeFm2608Adpcm(pcm,outputRate,maxBytes=0x200000) {
  const baseline=encodeAdpcmB(pcm,outputRate,maxBytes),targets=targetsFor(pcm,baseline);
  const reference=metrics(baseline.bytes,targets),regions=searchRegions(baseline.bytes,targets);
  let best=baseline.bytes,bestScore=2;
  for(const diverse of regions?[true]:[false,true]) {
    const bytes=candidate(targets,regions,diverse,reference),originalTail=bytes.at(-1)&15;
    for(const tail of regions?[originalTail]:Array.from({length:16},(_,index) => index)) {
      bytes[bytes.length-1]=(bytes.at(-1)&240)|tail;
      const measured=metrics(bytes,targets);
      if(measured.fresh>reference.fresh||measured.repeat>reference.repeat||measured.max>reference.max||
          measured.repeatMax>reference.repeatMax||measured.minValue<reference.minValue||measured.maxValue>reference.maxValue||
          measured.repeatMinValue<reference.repeatMinValue||measured.repeatMaxValue>reference.repeatMaxValue||
          measured.maxJump>reference.maxJump||measured.repeatMaxJump>reference.repeatMaxJump)continue;
      const score=measured.fresh/Math.max(1,reference.fresh)+measured.repeat/Math.max(1,reference.repeat);
      if(score<bestScore){bestScore=score;best=bytes.slice();}
    }
  }
  return {...baseline,bytes:best};
}
