// Exercise visible child tabs instead of the hidden compatibility select.
async function showHucChannelControls(page) {
  const active=await page.locator('[data-huc-chip-tab][aria-selected="true"]').getAttribute('data-huc-chip-tab');
  if(!await page.locator('#hucChannelTabs').isVisible())await page.locator('[data-huc-chip-tab="huc6280"]').click();
  return active;
}
async function selectHucChannel(page,value) {
  value=String(value);
  if(!/^(?:synth|[0-5])$/.test(value))throw Error('Invalid HuC6280 channel '+value);
  const active=await showHucChannelControls(page);
  const tab=page.locator(`#hucChannelTabs [data-huc-channel=${JSON.stringify(value)}]`);
  await tab.click();
  await page.waitForFunction(value=>document.querySelector('#hucChannelSelect').value===value&&
    document.querySelector('#hucChannelTabs [aria-selected="true"]')?.dataset.hucChannel===value,value);
  if(active&&active!=='huc6280')await page.locator(`[data-huc-chip-tab=${JSON.stringify(active)}]`).click();
}
async function setHucLive(page,value) {
  const active=await showHucChannelControls(page);
  await page.locator('#hucLiveEnabled').setChecked(value);
  if(active&&active!=='huc6280')await page.locator(`[data-huc-chip-tab=${JSON.stringify(active)}]`).click();
}
async function copyHucChannel(page) {
  await showHucChannelControls(page);await page.locator('#hucSongCaptureButton').click();
}
module.exports={selectHucChannel,setHucLive,copyHucChannel,showHucChannelControls};
