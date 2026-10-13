/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />
type TetoricaSelectedChip = 'ym2612';
play('C4', {seconds:1});
play('C4', {beats:1});
pg.play('C4', {beats:1});
tween({seconds:1}, progress => { const value:number=progress; });
tween({beats:1}, progress => { const value:number=progress; });
pg.tween({beats:1}, () => {});
const output=midi.output('tetorica-ym2612');
output.play('C4', {seconds:1});
output.play('C4', {beats:1});
// @ts-expect-error seconds and beats are exclusive
play('C4', {seconds:1, beats:1});
// @ts-expect-error seconds and beats are exclusive
output.play('C4', {seconds:1, beats:1});
// @ts-expect-error tween requires exactly one unit
tween({seconds:1, beats:1}, () => {});
// @ts-expect-error missing duration unit
tween({}, () => {});
// @ts-expect-error legacy duration cannot be mixed with explicit beats
pg.play('C4', {beats:1, duration:1});
