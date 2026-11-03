/** A bus zero may be a temporary key-off or an explicitly authored silence.
 * Publish retained SSG level metadata after the outer public API call only. */
export function trackSsgRetainedLevels(client,changed){
  let nesting=0;
  function track(object,names){for(const name of names){
    if(typeof object[name]!=='function'||name.startsWith('_')||name==='constructor')continue;
    const original=object[name].bind(object);
    object[name]=(...args)=>{const before=nesting++===0?client.ssg._getState().levels:null;
      try{return original(...args);}finally{nesting--;if(before){const after=client.ssg._getState().levels;for(let ch=0;ch<3;ch++)if(before[ch]!==after[ch])changed(ch,after[ch]&31);}}
    };
  }}
  track(client,['reset','write','rawWrite','writeRegister','writeAddress','writeData','setPreset','setOperator','setOperators','setAlgo','setFrequency','setNote','setBlockFnum','keyOn','keyOff','noteOn','noteOnRaw','noteOff','setChannel3SpecialMode','setChannel3SpecialFrequency']);
  track(client.ssg,Object.getOwnPropertyNames(Object.getPrototypeOf(client.ssg)));
}
