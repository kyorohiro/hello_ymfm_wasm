// SPDX-License-Identifier: GPL-2.0-or-later
// Included after the pinned ssfplay translation unit in a temporary build copy.
// These reads never call the emulated bus, clock a sample or update monitors.
namespace MDFN_IEN_SSFPLAY {
void SS_SCSP::TetoricaReadSnapshot(uint32* words, uint8* ram) const {
  words[3] = MVOL;
  words[4] = Mem4Mb;
  words[5] = DAC18bit;
  words[6] = RBP;
  words[7] = RBL;
  words[8] = GlobalCounter;
  words[9] = SlotMonitorWhich;
  words[10] = SlotMonitorData;
  words[11] = KeyExecute;
  for (unsigned index = 0; index < 32; ++index) {
    const auto& slot = Slots[index];
    uint32* output = words + 16 + index * 32;
    for (unsigned reg = 0; reg < 16; ++reg) output[reg] = SlotRegs[index][reg];
    output[16] = slot.KeyBit;
    output[17] = slot.EnvLevel;
    output[18] = slot.EnvPhase;
    output[19] = slot.CurrentAddr;
    output[20] = slot.PhaseWhacker;
    output[21] = slot.WFAllowAccess;
    output[22] = slot.InLoop;
    output[23] = slot.LoopSub;
    output[24] = slot.SourceControl;
    output[25] = slot.SoundDirect;
    output[26] = slot.LFOCounter;
    output[27] = slot.LFOTimeCounter;
    output[28] = ((slot.EnvPhase == ENV_PHASE_ATTACK && slot.AttackHold)
                  || slot.EGBypass || slot.SoundDirect) ? 0 : slot.EnvLevel;
    output[29] = slot.EGBypass;
  }
  for (unsigned address = 0; address < 512 * 1024; ++address)
    ram[address] = ne16_rbo_be<uint8>(RAM, address);
}

void SS_SCSP::TetoricaReadDspSnapshot(uint32* words) const {
  // Logical register order, four high-to-low words per 64-bit instruction.
  // Direct member access preserves opaque instruction bits without a bus read.
  for (unsigned step = 0; step < 128; ++step)
    for (unsigned part = 0; part < 4; ++part)
      words[8 + step * 4 + part] = (DSP.MPROG[step] >> (48 - part * 16)) & 0xFFFF;
  for (unsigned index = 0; index < 64; ++index)
    words[520 + index] = DSP.COEF[index] & 0x1FFF;
  for (unsigned index = 0; index < 32; ++index)
    words[584 + index] = DSP.MADRS[index];
  for (unsigned index = 0; index < 16; ++index)
    words[616 + index] = DSP.EFREG[index];
}

bool SS_SCSP::TetoricaEditVoice(uint32 slot, const uint32* edits, uint32 count) {
  if (slot >= 32 || count > 3 || (!edits && count)) return false;
  uint32 seen = 0;
  for (uint32 index = 0; index < count; ++index) {
    const uint32 offset = edits[index * 3], mask = edits[index * 3 + 1];
    const uint32 value = edits[index * 3 + 2];
    uint32 allowed = 0;
    switch (offset) {
      case 8: allowed = 0xFFDF; break;  // Preserve EGHOLD.
      case 10: allowed = 0x7FFF; break; // Preserve EGBYPASS.
      case 12: allowed = 0x00FF; break; // Preserve SDIR / STWINH.
      case 18: allowed = 0xFFFF; break;
      case 22: allowed = 0xFF00; break; // Preserve DSP return level/pan.
      default: return false;
    }
    const uint32 bit = 1u << (offset / 2);
    if (!mask || (mask & ~allowed) || (value & ~mask) || (seen & bit)) return false;
    seen |= bit;
  }
  // All updates have been validated before the first bus write. No CPU step,
  // PCM generation, gate write, RAM mutation or envelope restart occurs here.
  for (uint32 index = 0; index < count; ++index) {
    const uint32 offset = edits[index * 3], mask = edits[index * 3 + 1];
    uint16 value = (SlotRegs[slot][offset / 2] & ~mask) | edits[index * 3 + 2];
    RW<uint16, true>(0x100000 | slot * 32 | offset, value);
  }
  return true;
}
}

extern "C" {
double ssfplay_tetorica_native_frame(const ssfplay_decoder* decoder) {
  if (!decoder || !active_decoder) return -1;
  return static_cast<double>(MDFN_IEN_SSFPLAY::ssfplay_native_samples);
}
int ssfplay_tetorica_snapshot(const ssfplay_decoder* decoder, uint32_t* words,
                            uint32_t word_count, uint8_t* ram, uint32_t ram_size) {
  if (!decoder || !active_decoder || !words || !ram
      || word_count != 1040 || ram_size != 512 * 1024) return 0;
  std::fill(words, words + word_count, 0);
  const uint64_t frame = MDFN_IEN_SSFPLAY::ssfplay_native_samples;
  words[0] = 0x53534632;
  words[1] = static_cast<uint32_t>(frame);
  words[2] = static_cast<uint32_t>(frame >> 32);
  MDFN_IEN_SSFPLAY::SCSP.TetoricaReadSnapshot(words, ram);
  return 1;
}
int ssfplay_tetorica_edit_voice(const ssfplay_decoder* decoder, uint32_t slot,
                              const uint32_t* edits, uint32_t count) {
  if (!decoder || !active_decoder) return 0;
  return MDFN_IEN_SSFPLAY::SCSP.TetoricaEditVoice(slot, edits, count);
}
int ssfplay_tetorica_dsp_snapshot(const ssfplay_decoder* decoder, uint32_t* words,
                                uint32_t word_count) {
  if (!decoder || !active_decoder || !words || word_count != 632) return 0;
  std::fill(words, words + word_count, 0);
  const uint64_t frame = MDFN_IEN_SSFPLAY::ssfplay_native_samples;
  words[0] = 0x53445031; // SDP1.
  words[1] = 1;
  words[2] = static_cast<uint32_t>(frame);
  words[3] = static_cast<uint32_t>(frame >> 32);
  words[4] = 512; words[5] = 64; words[6] = 32; words[7] = 16;
  MDFN_IEN_SSFPLAY::SCSP.TetoricaReadDspSnapshot(words);
  return 1;
}
}
