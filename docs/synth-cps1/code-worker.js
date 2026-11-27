// Keep user code off the UI and audio threads so Stop can interrupt a loop.
const facade = (chip,methods) => Object.fromEntries(methods.map(method => [method,
  (...args) => postMessage({chip,method,args})]));
const opm = facade('opm',['loadVoice','writeRegister','setOperator','setAlgo','setPan','setNote','setPitch','setFrequency','noteOn','keyOn','keyOff','setNoise']);
const oki = facade('oki',['write','play','stop','setVoiceMuted']);
const sleep = seconds => new Promise(resolve => setTimeout(resolve,seconds*1000));
onmessage = async ({data}) => {
  try {
    const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
    await new AsyncFunction('opm','oki','sleep',data)(opm,oki,sleep);
    postMessage({done:true});
  } catch (error) {postMessage({error:error.message});}
};
