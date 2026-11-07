// SPDX-License-Identifier: BSD-3-Clause
// Analytical signals only: no SID implementation, reference engine or music.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pcm16,toneMeasurement,bandPassEstimate} from '../scripts/sid8580_quality_metrics.mjs';

const CLOCK=985248;
const close=(actual,expected,tolerance,label)=>assert(Math.abs(actual-expected)<=tolerance,
  `${label}: expected ${expected} ± ${tolerance}, got ${actual}`);
const phaseDistance=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));

// Independently step a 24-bit oscillator and rational sampler one chip tick at
// a time. This deliberately does not reconstruct tick numbers with ceil().
function analyticalCapture({rate,frames,startFrame=0,frequencyRegister,dc,harmonics}) {
  const bytes=Buffer.alloc(frames*2);
  let phase=0,oscillator=0,frame=0,stored=0;
  while(frame<startFrame+frames) {
    oscillator=(oscillator+frequencyRegister)&0xffffff;
    phase+=rate;
    if(phase<CLOCK)continue;
    phase-=CLOCK;
    if(frame++<startFrame)continue;
    const angle=2*Math.PI*oscillator/0x1000000;
    const value=dc+harmonics.reduce((sum,{amplitude,phase},index)=>
      sum+amplitude*Math.cos((index+1)*angle+phase),0);
    const integer=Math.round(value*32768);
    assert(integer>-32768&&integer<32767,'Analytical fixture must not clip');
    bytes.writeInt16LE(integer,stored++*2);
  }
  assert.equal(stored,frames);
  return {bytes,baseHz:CLOCK*frequencyRegister/0x1000000};
}

test('lock-in recovers a known sine, phase and DC from exact chip-tick samples at three rates',()=>{
  for(const [rate,phase,dc] of [[44100,.731,-.12],[48000,-2.78,.1125],[96000,2.95,.0625]]) {
    const amplitude=.375,startFrame=12345;
    const {bytes,baseHz}=analyticalCapture({rate,frames:4093,startFrame,frequencyRegister:0x7bcd,
      dc,harmonics:[{amplitude,phase}]});
    const before=Buffer.from(bytes);
    const measured=toneMeasurement(bytes,{rate,clock:CLOCK,baseHz,startFrame});
    close(measured.amplitude,amplitude,4e-5,`${rate} amplitude`);
    close(measured.dcFit,dc,3e-5,`${rate} DC`);
    assert(phaseDistance(measured.phase,phase)<2e-4,`${rate} phase sign/tick offset`);
    assert.equal(measured.frames,4093);
    assert.equal(measured.clipped,0);
    assert.deepEqual(bytes,before,'Measurement must preserve all input PCM bytes');
  }
});

test('simultaneous harmonics separate the requested component from DC and other tones',()=>{
  const tones=[{amplitude:.25,phase:.39},{amplitude:.0625,phase:-1.2},
    {amplitude:.035,phase:2.1},{amplitude:.0175,phase:-.7}];
  // A short, noninteger number of fundamental periods prevents a simple FFT
  // bin or independent single-harmonic fit from assuming orthogonal columns.
  for(let harmonic=1;harmonic<=tones.length;harmonic++) {
    const startFrame=137,dc=.0625;
    const {bytes,baseHz}=analyticalCapture({rate:48000,frames:2503,startFrame,frequencyRegister:0x0317,
      dc,harmonics:tones.slice(0,harmonic)});
    const measured=toneMeasurement(bytes,{rate:48000,clock:CLOCK,baseHz,startFrame,harmonic});
    const expected=tones[harmonic-1];
    close(measured.amplitude,expected.amplitude,4e-5,`H${harmonic} amplitude`);
    close(measured.dcFit,dc,3e-5,`H${harmonic} DC`);
    assert(phaseDistance(measured.phase,expected.phase)<.002,`H${harmonic} phase`);
    assert.equal(measured.harmonic,harmonic);
  }
});

test('PCM16 decoding preserves signed endpoints and measurement reports clipping without changing samples',()=>{
  const values=[-32768,32767,0,8192],bytes=Buffer.alloc(128*2);
  for(let i=0;i<128;i++)bytes.writeInt16LE(values[i%values.length],i*2);
  const before=Buffer.from(bytes),decoded=pcm16(bytes);
  assert.deepEqual([...decoded.subarray(0,4)],[-1,32767/32768,0,.25]);
  assert.throws(()=>pcm16(Buffer.alloc(3)),/odd/i);
  const measured=toneMeasurement(bytes,{rate:48000,clock:CLOCK,baseHz:1234.5});
  const expectedMean=(-1+32767/32768+.25)/4;
  const expectedPower=(1+(32767/32768)**2+.25**2)/4;
  close(measured.mean,expectedMean,1e-14,'Raw mean');
  close(measured.rms,Math.sqrt(expectedPower),1e-14,'Raw RMS');
  close(measured.acRms,Math.sqrt(expectedPower-expectedMean**2),1e-14,'Raw AC RMS');
  assert.equal(measured.peak,1);
  assert.equal(measured.clipped,64);
  assert.deepEqual(bytes,before,'No clipping, normalization or fitted correction may rewrite PCM');
});

test('dense continuous band-pass responses recover analytic center, half-power edges and Q',()=>{
  // H(s)=(s/Q)/(s²+s/Q+1), x=f/f0. Its exact half-power roots
  // have xHi-xLo=1/Q, independently of the estimator interpolation method.
  const f0=1375;
  for(const [q,gain] of [[Math.SQRT1_2,.0625],[1,1],[2.6,3.5],[6,.125]]) {
    const rows=[];
    for(let step=-2048;step<=2048;step++) {
      const x=2**(step/512),imaginary=x/q;
      rows.push({hz:f0*x,magnitude:gain*imaginary/Math.hypot(1-x*x,imaginary)});
    }
    const before=structuredClone(rows);
    const measured=bandPassEstimate(rows);
    const spread=Math.sqrt(4+1/(q*q));
    const low=f0*(spread-1/q)/2,high=f0*(spread+1/q)/2;
    close(measured.peakHz,f0,1e-10,'Peak frequency');
    close(measured.peakMagnitude,gain,1e-12,'Own-curve peak');
    close(measured.low3dBHz,low,low*2e-4,'Lower half-power frequency');
    close(measured.high3dBHz,high,high*2e-4,'Upper half-power frequency');
    close(measured.estimatedQ,q,q*5e-4,'Estimated Q');
    assert.deepEqual(rows,before,'Frequency sorting/interpolation must not mutate the response');
  }
});

test('band-pass estimates stay null when either half-power crossing is missing',()=>{
  const lowMissing=bandPassEstimate([{hz:100,magnitude:1},{hz:200,magnitude:.8},{hz:300,magnitude:.4}]);
  assert.equal(lowMissing.low3dBHz,null);
  assert(Number.isFinite(lowMissing.high3dBHz));
  assert.equal(lowMissing.estimatedQ,null);
  const highMissing=bandPassEstimate([{hz:100,magnitude:.4},{hz:200,magnitude:.8},{hz:300,magnitude:1}]);
  assert(Number.isFinite(highMissing.low3dBHz));
  assert.equal(highMissing.high3dBHz,null);
  assert.equal(highMissing.estimatedQ,null);
  const flat=bandPassEstimate([{hz:100,magnitude:1},{hz:200,magnitude:1},{hz:300,magnitude:1}]);
  assert.equal(flat.estimatedQ,null);
  assert.equal(bandPassEstimate([{hz:0,magnitude:1},{hz:-1,magnitude:1},{hz:100,magnitude:0}]).estimatedQ,null);
});

test('duplicate-frequency and zero-bandwidth responses never produce a finite-looking or infinite Q',()=>{
  for(const rows of [
    [{hz:1000,magnitude:.1},{hz:1000,magnitude:1},{hz:1000,magnitude:.1}],
    [{hz:500,magnitude:.1},{hz:1000,magnitude:1},{hz:1000,magnitude:.3},{hz:2000,magnitude:.1}],
  ]) assert.equal(bandPassEstimate(rows).estimatedQ,null,'Ambiguous or zero-width frequency data cannot define Q');
});

test('lock-in rejects invalid timing/harmonic bounds instead of returning NaN measurements',()=>{
  const bytes=Buffer.alloc(128*2),valid={rate:48000,clock:CLOCK,baseHz:1000,harmonic:1,startFrame:0};
  const invalid={
    harmonic:[0,-1,1.5,NaN,Infinity],
    rate:[0,-1,48000.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1],
    clock:[0,-1,CLOCK+.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1],
    baseHz:[0,-1,NaN,Infinity],
    startFrame:[-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1],
  };
  for(const [field,values] of Object.entries(invalid))for(const value of values)
    assert.throws(()=>toneMeasurement(bytes,{...valid,[field]:value}),RangeError,`${field}=${value}`);
  assert.throws(()=>toneMeasurement(Buffer.alloc(31*2),valid),/short/i);
});
