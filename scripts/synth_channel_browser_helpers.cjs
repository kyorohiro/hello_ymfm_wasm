// Shared browser action for the visible physical-channel child tabs.
// The hidden select remains an internal state hook, not a user input surface.
async function selectSynthChannel(page,value) {
  value=String(value);
  if(!/^(?:synth|[0-5]|psg:[0-3]|pcm:[0-7])$/.test(value))throw Error('Invalid Synth channel '+value);
  const active=await page.locator('[data-synth-chip][aria-selected="true"]').getAttribute('data-synth-chip');
  const chip=value.startsWith('pcm:')?'pcm':value.startsWith('psg:')?'psg':value==='synth'
    ?await page.locator('#synthChannelControls').getAttribute('data-chip'):'ym2612';
  const target=page.locator(`[data-synth-channel-target=${JSON.stringify(value)}]`);
  // Mixer is a view over the retained chip. Select the channel first and then
  // return to its volume controls, just as a user does with the nested tabs.
  if(!await target.isVisible())await page.locator(`[data-synth-chip=${JSON.stringify(chip??'ym2612')}]`).click();
  await target.click();
  if(active==='mixer')await page.locator('[data-synth-chip="mixer"]').click();
}
async function showSynthChannelControls(page){
  const active=await page.locator('[data-synth-chip][aria-selected="true"]').getAttribute('data-synth-chip');
  if(!await page.locator('#synthChannelControls').isVisible()){
    const chip=await page.locator('#synthChannelControls').getAttribute('data-chip');
    await page.locator(`[data-synth-chip=${JSON.stringify(chip??'ym2612')}]`).click();
  }
  return active;
}
async function copySynthChannel(page){
  await showSynthChannelControls(page);await page.locator('#synthSongCopyButton').click();
}
async function setSynthLive(page,value){
  const active=await showSynthChannelControls(page);
  await page.locator('#synthSongLiveToggle').setChecked(value);
  if(active==='mixer')await page.locator('[data-synth-chip="mixer"]').click();
}
module.exports={selectSynthChannel,copySynthChannel,setSynthLive};
