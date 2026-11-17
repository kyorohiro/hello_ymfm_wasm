import {YM2612Synth} from 'tetorica-fm2612/ym2612synth';
import {attachYm2612TimedClient, type YM2612StateSnapshot} from 'tetorica-fm2612/ym2612_timed_client';

const fm = attachYm2612TimedClient(new YM2612Synth({transport:{write() {}, reset() {}}}), {native:true});
const operations = fm.build(b => {
  b.atSample(0).setOperator(0, 0, {multi:2, tl:32});
  b.atSeconds(0.1).noteOn(0, 'C4');
  b.atSeconds(0.2).noteOn(3, 4, 644);
  b.setOperators(3, [[0, {ar:31}], [3, {rr:8}]]).keyOn(3, [0,3]);
  b.atSeconds(0.3).noteOff(0).write(1, 0x40, 24);
});
const snapshot: YM2612StateSnapshot = await fm.captureState();
for (const initialState of ['current', 'client', 'reset', snapshot] as const) {
  const rows = await fm.compile(operations, {initialState});
  const port: number = rows[0].port;
  const seconds: number = rows[0].offsetSeconds;
  void [port, seconds];
}
await fm.schedule(operations, {name:'motion', repeatSeconds:1});
await fm.clearSchedule('motion');
// @ts-expect-error Unknown compilation baseline must not silently become current.
await fm.compile(operations, {initialState:'cached'});
// @ts-expect-error Misspelled operator parameter.
fm.build(b => b.setOperator(0,0,{multiplier:3}));
// @ts-expect-error Build callbacks execute synchronously once.
fm.build(async b => {b.keyOn(0);});
// @ts-expect-error The recorder does not run arbitrary user callbacks in Worklet.
fm.build(b => b.setTimeout(() => {}, 10));
// @ts-expect-error Compile returns concrete numbers, not strings.
const invalid: string = (await fm.compile(operations))[0].register;
void invalid;
