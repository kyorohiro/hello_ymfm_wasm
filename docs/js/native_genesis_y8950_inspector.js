import {prepareY8950AdpcmSample,validateY8950AdpcmPreview,snapshotY8950AdpcmSource} from './y8950_adpcm_preview.js?v=y8950-adpcm-ui-1';

/** Control-side metadata only. The audio callback publishes two counters, never
 * sample RAM. A CPU data write invalidates the uploaded waveform immediately. */
export function createNativeY8950AdpcmInspection() {
  let preview=null;
  return {
    applied(state,candidate) {
      const revision=state.adpcmMemoryRevision,uploaded=state.adpcmMemoryUploadRevision;
      preview=candidate&&Number.isSafeInteger(revision)&&revision>=0&&revision===uploaded
        ?{...candidate,revision:uploaded}:null;
    },
    adopt(inspector,state) {
      inspector.setAdpcmMemoryInfo({memoryBytes:state.adpcmMemorySize??0,revision:state.adpcmMemoryRevision??0,preview});
    },
    reset(){preview=null;},
  };
}

/** UI uploads bypass script/loop authoring hooks. Decoding and encoding stay on
 * the control side; every stage retains the selected Native connection. */
export function createNativeY8950SampleLoader({context,read,invoke,transport,decodeAudio}) {
  return async (source,options={}) => {
    if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('Y8950 ADPCM sample options must be an object');
    options={...options};source=snapshotY8950AdpcmSource(source);
    const token=context.capture(),signal=options?.signal;
    const check=()=>{context.current(token);signal?.throwIfAborted();};
    check();
    const initial=await read();check();
    if(initial.held?.includes('adpcm'))throw new Error('Release the ADPCM Keyboard key before loading a sample');
    const {bytes,metadata}=await prepareY8950AdpcmSample(source,options,initial.clock,decodeAudio);check();
    validateY8950AdpcmPreview(metadata.preview,metadata.start,bytes.length);
    await transport.request('loadAdpcmMemory',[bytes,metadata.start,metadata.preview],{checkCurrent:check});check();
    const checkState=state=>{if(state.clock!==initial.clock)throw new Error('Y8950 clock changed while loading an ADPCM sample; load it again at the new clock');};
    const state=await read();check();checkState(state);
    await invoke('adpcm.setSample',[{start:metadata.start,end:metadata.end}],{checkCurrent:check,checkState});check();
    await invoke('adpcm.setDeltaN',[metadata.deltaN],{checkCurrent:check,checkState});check();
    return metadata;
  };
}
