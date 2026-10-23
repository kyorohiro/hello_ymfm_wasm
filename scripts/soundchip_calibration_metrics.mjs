// Output-unit calibration, not perceived loudness or musical normalization.
export function channelAmplitude({minimum,maximum,dc,rms,acRms,nonfinite=0}) {
  if(nonfinite||![minimum,maximum,dc,rms,acRms].every(Number.isFinite)||maximum<minimum)throw new Error('Invalid calibration PCM');
  const amplitude=(maximum-minimum)/2;
  if(amplitude<=1e-6||acRms<=1e-6)throw new Error('Silent or DC-only calibration reference');
  return amplitude;
}
export function probeAmplitude(pcm) {
  if(pcm.nonfinite||!Number.isInteger(pcm.frames)||pcm.frames<1024)throw new Error('Invalid calibration capture');
  if(![pcm.minimum,pcm.maximum,pcm.dc,pcm.rms,pcm.acRms].every(v=>Array.isArray(v)&&v.length===2))throw new Error('Expected stereo calibration statistics');
  return Math.max(...[0,1].map(ch=>channelAmplitude({minimum:pcm.minimum[ch],maximum:pcm.maximum[ch],dc:pcm.dc[ch],rms:pcm.rms[ch],acRms:pcm.acRms[ch],nonfinite:pcm.nonfinite})));
}
export function deriveCalibrationGains(routes,{referenceAmplitude,maxGain=2,precision=6}={}) {
  if(!Array.isArray(routes)||!routes.length||!Number.isFinite(referenceAmplitude)||referenceAmplitude<=0||!Number.isFinite(maxGain)||maxGain<=0)throw new Error('Invalid calibration target');
  if(routes.some(r=>!Number.isFinite(r.amplitude)||r.amplitude<=1e-6))throw new Error('Invalid calibration amplitude');
  // Keep every route within the existing Mixer range. A common reduced target
  // preserves the same output level for all routes; clipping individual gains
  // would silently leave the quiet sources uncalibrated.
  const targetAmplitude=Math.min(referenceAmplitude,...routes.map(r=>r.amplitude*maxGain));
  return {referenceAmplitude,targetAmplitude,maxGain,targetReduced:targetAmplitude<referenceAmplitude,
    routes:routes.map(route=>({...route,volume:Number((targetAmplitude/route.amplitude).toFixed(precision))}))};
}
