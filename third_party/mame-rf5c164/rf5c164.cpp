// license:BSD-3-Clause
// copyright-holders:Olivier Galibert,Aaron Giles
// Adapted from the pinned MAME source; see README.md and upstream/rf5c68.cpp.
#include "rf5c164.h"
#include <algorithm>

void RF5C164::reset() {
    channels_.fill(Channel{});
    cbank_ = enable_ = 0;
    wbank_ = 0;
    phase_ = uint64_t(rate_) * 384; // first output evaluates sample zero
    left_ = right_ = 0;
}
bool RF5C164::load(const uint8_t *data, uint32_t offset, uint32_t size) {
    if (offset > ram_.size() || size > ram_.size() - offset) return false;
    std::copy(data, data + size, ram_.begin() + offset);
    return true;
}

void RF5C164::write(uint8_t offset, uint8_t data)
{
	Channel &chan = channels_[cbank_];

	// The host generates all preceding audio before applying a write.

	/* switch off the address */
	switch (offset)
	{
		case 0x00:  /* envelope */
			chan.env = data;
			break;

		case 0x01:  /* pan */
			chan.pan = data;
			break;

		case 0x02:  /* FDL */
			chan.step = (chan.step & 0xff00) | (data & 0x00ff);
			break;

		case 0x03:  /* FDH */
			chan.step = (chan.step & 0x00ff) | ((data << 8) & 0xff00);
			break;

		case 0x04:  /* LSL */
			chan.loopst = (chan.loopst & 0xff00) | (data & 0x00ff);
			break;

		case 0x05:  /* LSH */
			chan.loopst = (chan.loopst & 0x00ff) | ((data << 8) & 0xff00);
			break;

		case 0x06:  /* ST */
			chan.start = data;
			if (!chan.enable)
				chan.addr = chan.start << (8 + 11);
			break;

		case 0x07:  /* control reg */
			enable_ = (data >> 7) & 1;
			if (data & 0x40)
				cbank_ = data & 7;
			else
				wbank_ = (data & 0xf) << 12;
			break;

		case 0x08:  /* channel on/off reg */
			for (int i = 0; i < 8; i++)
			{
				channels_[i].enable = (~data >> i) & 1;
				if (!channels_[i].enable)
					channels_[i].addr = channels_[i].start << (8 + 11);
			}
			break;
	}
}

void RF5C164::tick() {
    int32_t left = 0, right = 0;
    if (enable_) {
        for (auto &chan : channels_) {
            if (!chan.enable) continue;
            const int lv = (chan.pan & 0x0f) * chan.env;
            const int rv = ((chan.pan >> 4) & 0x0f) * chan.env;
            int sample = ram_[(chan.addr >> 11) & 0xffff];
            if (sample == 0xff) {
                chan.addr = uint32_t(chan.loopst) << 11;
                sample = ram_[(chan.addr >> 11) & 0xffff];
                if (sample == 0xff) continue;
            }
            chan.addr += chan.step;
            if (sample & 0x80) {
                sample &= 0x7f;
                left += (sample * lv) >> 5;
                right += (sample * rv) >> 5;
            } else {
                left -= (sample * lv) >> 5;
                right -= (sample * rv) >> 5;
            }
        }
    }
    left_ = std::max(-32768, std::min(32767, left)) / 32768.0f;
    right_ = std::max(-32768, std::min(32767, right)) / 32768.0f;
}
void RF5C164::generate(float *left, float *right, uint32_t frames) {
    const uint64_t period = uint64_t(rate_) * 384;
    for (uint32_t i = 0; i < frames; ++i) {
        while (phase_ >= period) { phase_ -= period; tick(); }
        left[i] = left_; right[i] = right_;
        phase_ += clock_;
    }
}
