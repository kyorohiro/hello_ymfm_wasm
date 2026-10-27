/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />
type TetoricaSelectedChip = 'ym2612';
cdda.load(new Uint8Array(44));
cdda.load('/audio/track02.wav');
cdda.load({tracks:[{number:2,file:'/audio.wav',startFrame:0,endFrame:44100}]});
cdda.play(2,{at:1,offset:.5});
cdda.pause();
cdda.resume({at:2});
cdda.seek(.5);
cdda.stop();
cdda.getState().then(state=>{const frame:number=state.positionFrames;const track:number|null=state.track;});
pg.cdda.play();
livePrepare('cd',async api=>{await api.cdda.load('/audio.wav');});
// @ts-expect-error CD-DA is a PCM transport, not a sound-chip kind.
createSoundChip('cdda');
// @ts-expect-error Track numbers are numeric.
cdda.play('2');
// @ts-expect-error Seek uses source seconds.
cdda.seek({beats:2});
// @ts-expect-error Playback offsets are numeric seconds.
cdda.play(2,{offset:'1'});
