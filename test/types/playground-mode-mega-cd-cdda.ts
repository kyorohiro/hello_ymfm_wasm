/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-mega-cd.d.ts" />

async function checkMegaCDCddaEditorTypes() {
  const tracks: ReadonlyArray<PlaygroundCddaTrack> = await cdda.load({tracks: [
    {number: 2, file: '/audio/disc.wav', startFrame: 0, endFrame: 44100, title: 'Track 2'},
  ]});
  await cdda.play(tracks[0].number, {offset: 0.1, at: 1});
  await pg.cdda.pause(); await pg.cdda.resume(); await cdda.seek(0.2); await cdda.stop();
  const state: PlaygroundCddaState = await pg.cdda.getState();
  const track: number | null = state.track;
  const sourceRate: 44100 = state.sourceRate;
  await livePrepare('disc', async ({cdda: prepared, fm, psg}) => {
    await prepared.load('/audio/disc.wav');
    fm.setPreset(CH1, FM_PRESETS['one-op-basic']); psg.off(PSG1);
  });
  const pcm = await useSoundChip('rf5c164');
  await pcm.setPitch(0, 1000); await pcm.keyOn(0); await pcm.keyOff(0);
  // @ts-expect-error Mega CD does not expose PC Engine PSG convenience globals
  pce.keyOn(0);
  // @ts-expect-error Mega CD does not expose the PC Engine primary ADPCM global
  adpcm.loadMemory(new Uint8Array(1));
  // @ts-expect-error MSM5205 is not an implicit Mega CD global
  msm5205.play();
  // @ts-expect-error CD-DA is a common playback source, not an independently created sound chip
  createSoundChip('cdda');
  // @ts-expect-error CD-DA positions use seconds
  cdda.seek({beats: 1});
  // @ts-expect-error CD-DA track numbers are numeric
  pg.cdda.play('2');
  void track; void sourceRate;
}
