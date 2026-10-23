import test from 'node:test';
import assert from 'node:assert/strict';
import {channelAmplitude,probeAmplitude,deriveCalibrationGains} from '../scripts/soundchip_calibration_metrics.mjs';

test('equal-amplitude sine and square retain their different RMS and arbitrary DC offsets',()=>{
  const sine={minimum:1.75,maximum:2.25,dc:2,rms:Math.sqrt(4+.25**2/2),acRms:.25/Math.SQRT2};
  const square={minimum:-3.25,maximum:-2.75,dc:-3,rms:Math.sqrt(9+.25**2),acRms:.25};
  assert.equal(channelAmplitude(sine),.25);assert.equal(channelAmplitude(square),.25);
  assert.notEqual(sine.acRms,square.acRms);
  const pcm={frames:4096,minimum:[1.75,1.875],maximum:[2.25,2.125],dc:[2,2],rms:[2.01,2.001],acRms:[.17,.08],nonfinite:0};
  assert.equal(probeAmplitude(pcm),.25,'The louder stereo side determines headroom');
});

test('invalid, silent, DC-only and incomplete captures cannot produce a gain profile',()=>{
  const valid={minimum:-.25,maximum:.25,dc:0,rms:.2,acRms:.2};
  assert.throws(()=>channelAmplitude({...valid,nonfinite:1}),/Invalid/);
  assert.throws(()=>channelAmplitude({...valid,maximum:NaN}),/Invalid/);
  assert.throws(()=>channelAmplitude({...valid,minimum:2,maximum:2,acRms:0}),/Silent/);
  assert.throws(()=>probeAmplitude({frames:4096}),/stereo/);
  assert.throws(()=>probeAmplitude({frames:1}),/Invalid/);
  assert.throws(()=>deriveCalibrationGains([{amplitude:0}],{referenceAmplitude:.1}),/Invalid/);
});

test('a shared target respects the Mixer limit without independently clamping quiet routes',()=>{
  const r=deriveCalibrationGains([{kind:'fm',amplitude:.2},{kind:'psg',amplitude:.04},{kind:'pcm',amplitude:.8}],{referenceAmplitude:.2});
  assert.equal(r.targetAmplitude,.08);assert.equal(r.targetReduced,true);
  assert.deepEqual(r.routes.map(r=>r.volume),[.4,2,.1]);
  for(const route of r.routes)assert(Math.abs(route.volume*route.amplitude-r.targetAmplitude)<1e-9);
  const unchanged=deriveCalibrationGains([{amplitude:.4},{amplitude:.2}],{referenceAmplitude:.2});
  assert.equal(unchanged.targetReduced,false);assert.deepEqual(unchanged.routes.map(r=>r.volume),[.5,1]);
});
