/** @file Browser / Worker / Node.js: decoded PCM to RF5C164 RAM encoding. No audio device or file decoder. */
const integer=(v,max,name)=>{if(!Number.isInteger(v)||v<0||v>max)throw new RangeError(`Invalid ${name}`);return v;};
export function sampleBytes(value){if(value instanceof ArrayBuffer)return new Uint8Array(value);if(value instanceof Uint8Array)return value;throw new TypeError('Expected Uint8Array or ArrayBuffer');}
/** Convert decoded mono/stereo PCM to sign-magnitude RAM bytes, with a loop marker. */
export function encodeRf5c164({channels,sampleRate}){
 if(!channels?.length||!channels[0].length||!Number.isFinite(sampleRate)||sampleRate<=0)throw new Error('Invalid PCM');
 const n=channels[0].length;if(n+3>65536)throw new RangeError('Sample exceeds 64 KiB; shorten or resample it first');
 if(channels.some(c=>c.length!==n))throw new Error('PCM channel lengths differ');
 const bytes=new Uint8Array(n+3);
 for(let i=0;i<n;i++){let v=0;for(const c of channels){if(!Number.isFinite(c[i]))throw new Error('Nonfinite PCM');v+=c[i]/channels.length;}const m=Math.min(126,Math.round(Math.abs(v)*126));bytes[i]=m|(v>=0?128:0);}
 bytes[n]=255;bytes[n+1]=128;bytes[n+2]=255;
 const step=Math.round(sampleRate*384/12500000*2048);integer(step,65535,'sample step');if(!step)throw new RangeError('Sample rate too low');
 return {bytes,step,frames:n};
}
