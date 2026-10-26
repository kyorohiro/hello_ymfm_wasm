// license:BSD-3-Clause
// copyright-holders:Wilbert Pol, kyorohiro
// Sound generation and register behavior adapted from MAME wswansound.cpp.
// See README.md and upstream/ for the exact source revision and differences.
#include "wonderswan.h"

namespace {
constexpr uint32_t ClockDivider = 128;
}

bool WonderSwan::validConfiguration(uint32_t clock, uint32_t sampleRate) {
    return clock >= ClockDivider && clock <= 100000000 &&
           sampleRate >= 8000 && sampleRate <= 384000;
}

WonderSwan::WonderSwan(uint32_t clock, uint32_t sampleRate)
    : clock_(validConfiguration(clock, sampleRate) ? clock : 3072000),
      rate_(validConfiguration(clock, sampleRate) ? sampleRate : 44100) {
    reset();
}

void WonderSwan::reset() {
    memory_.fill(0);
    channels_.fill(Channel{});
    muted_.fill(false);
    voiceLeft_.fill(0);
    voiceRight_.fill(0);
    phase_ = 0;
    sweepStep_ = 0;
    sweepTime_ = 8192;
    sweepCount_ = 0;
    noiseType_ = noiseOutput_ = 0;
    noiseEnable_ = false;
    sampleAddress_ = 0;
    voice_ = sweep_ = noise_ = false;
    outputControl_ = sampleVolume_ = systemVolume_ = 0;
    noiseShift_ = outputLeft_ = outputRight_ = 0;
    heldLeft_ = heldRight_ = 0;
}

void WonderSwan::writeMemory(uint32_t address, uint8_t value) {
    if (address < memory_.size()) memory_[address] = value;
}

uint8_t WonderSwan::readMemory(uint32_t address) const {
    return address < memory_.size() ? memory_[address] : 0;
}

uint8_t WonderSwan::fetchSample(unsigned channel, unsigned offset) const {
    // MAME's read_word selects four packed nibbles at once. Byte addressing
    // here is equivalent and wraps within the same 14-bit sample address bus.
    const uint32_t address = (sampleAddress_ + ((channel & 3) << 4) +
                              ((offset >> 1) & 15)) & 0x3fff;
    return (memory_[address] >> ((offset & 1) * 4)) & 15;
}

void WonderSwan::writeRegister(uint32_t address, uint8_t value) {
    if (address >= 0x80 && address <= 0x87) {
        auto& channel = channels_[(address - 0x80) >> 1];
        channel.frequency = uint16_t((address & 1)
            ? ((channel.frequency & 0xff) | ((value & 7) << 8))
            : ((channel.frequency & 0x700) | value));
        channel.period = 2048 - channel.frequency;
        return;
    }
    if (address >= 0x88 && address <= 0x8b) {
        auto& channel = channels_[address - 0x88];
        channel.volumeLeft = value >> 4;
        channel.volumeRight = value & 15;
        return;
    }
    switch (address) {
    case 0x8c:
        // Conversion by subtraction is defined for all unsigned byte values.
        sweepStep_ = int8_t(value < 128 ? int(value) : int(value) - 256);
        break;
    case 0x8d:
        sweepTime_ = 8192 * ((value & 31) + 1);
        // Upstream does not reset sweepCount_ on this write.
        break;
    case 0x8e:
        noiseType_ = value & 7;
        noiseEnable_ = (value & 16) != 0;
        if (value & 8) noiseShift_ = noiseOutput_ = 0;
        break;
    case 0x8f:
        sampleAddress_ = uint16_t(uint32_t(value) << 6);
        break;
    case 0x90:
        for (unsigned i = 0; i < 4; ++i) channels_[i].on = ((value >> i) & 1) != 0;
        voice_ = (value & 0x20) != 0;
        sweep_ = (value & 0x40) != 0;
        noise_ = (value & 0x80) != 0;
        break;
    case 0x91:
        outputControl_ = value & 15;
        break;
    case 0x92:
        noiseShift_ = (noiseShift_ & 0x7f00) | value;
        break;
    case 0x93:
        noiseShift_ = uint16_t((noiseShift_ & 0xff) | ((value & 0x7f) << 8));
        break;
    case 0x94:
        sampleVolume_ = value & 15;
        break;
    case 0x9e:
        systemVolume_ = value & 3;
        break;
    default:
        break;
    }
}

uint16_t WonderSwan::readWord(uint32_t address) const {
    switch (address) {
    case 0x80: case 0x82: case 0x84: case 0x86:
        return channels_[(address - 0x80) >> 1].frequency;
    case 0x88: case 0x8a: {
        const unsigned channel = address - 0x88;
        return uint16_t((channels_[channel].volumeLeft << 4) | channels_[channel].volumeRight |
               (channels_[channel + 1].volumeLeft << 12) | (channels_[channel + 1].volumeRight << 8));
    }
    case 0x8c:
        // Match MAME's signed promotion when a negative sweep step is read.
        return uint16_t(int(sweepStep_) | int(((sweepTime_ / 8192) - 1) << 8));
    case 0x8e:
        return noiseType_ | (noiseEnable_ ? 16 : 0) | ((sampleAddress_ << 2) & 0xff00);
    case 0x90: {
        uint16_t value = uint16_t((uint16_t(outputControl_) << 8) | 0x8000);
        for (unsigned i = 0; i < 4; ++i) value |= channels_[i].on ? (1 << i) : 0;
        return value | (voice_ ? 0x20 : 0) | (sweep_ ? 0x40 : 0) | (noise_ ? 0x80 : 0);
    }
    case 0x92: return noiseShift_;
    case 0x94: return sampleVolume_;
    case 0x96: return outputLeft_ & 0x3ff;
    case 0x98: return outputRight_ & 0x3ff;
    case 0x9a: return (outputLeft_ & 0x3ff) + (outputRight_ & 0x3ff);
    case 0x9e: return systemVolume_;
    default: return 0;
    }
}

uint8_t WonderSwan::readRegister(uint32_t address) const {
    if (address < 0x80 || address > 0x9f) return 0;
    return (readWord(address & ~1u) >> ((address & 1) * 8)) & 0xff;
}

void WonderSwan::mute(uint32_t channel, bool muted) {
    if (channel < muted_.size()) {
        muted_[channel] = muted;
        mixHeld();
    }
}

void WonderSwan::mixHeld() {
    uint32_t left = 0, right = 0;
    for (unsigned channel = 0; channel < 4; ++channel) {
        if (!muted_[channel]) {
            left += voiceLeft_[channel];
            right += voiceRight_[channel];
        }
    }
    // MAME's headphones path: (sum << 5) / 32768. Four full-scale
    // wavetable channels sum to 900/1024, so no clipping is necessary.
    heldLeft_ = float(left) / 1024.0f;
    heldRight_ = float(right) / 1024.0f;
}

void WonderSwan::tick() {
    outputLeft_ = outputRight_ = 0;
    voiceLeft_.fill(0);
    voiceRight_.fill(0);
    if (!(outputControl_ & 8)) {
        mixHeld();
        return;
    }

    for (unsigned index = 0; index < 4; ++index) {
        auto& channel = channels_[index];
        if (!channel.on) continue;
        if (index == 1 && voice_) {
            const uint8_t data = uint8_t((channel.volumeLeft << 4) | channel.volumeRight);
            if (sampleVolume_ & 12) voiceLeft_[index] = data >> ((sampleVolume_ & 8) ? 0 : 1);
            if (sampleVolume_ & 3) voiceRight_[index] = data >> ((sampleVolume_ & 2) ? 0 : 1);
        } else {
            const uint8_t sample = channel.signal;
            channel.position += ClockDivider;
            while (channel.position >= channel.period) {
                if (index == 3 && noise_)
                    channel.signal = noiseOutput_ ? 15 : 0;
                else
                    channel.signal = fetchSample(index, channel.offset++);
                channel.position -= channel.period;
                if (index == 3 && noiseEnable_) {
                    static const unsigned shiftBit[8] = {14, 10, 13, 4, 8, 6, 9, 11};
                    noiseOutput_ = (1 ^ (noiseShift_ >> 7) ^ (noiseShift_ >> shiftBit[noiseType_])) & 1;
                    noiseShift_ = uint16_t((noiseShift_ << 1) | noiseOutput_);
                }
            }
            if (index == 2 && sweep_ && sweepTime_) {
                sweepCount_ += ClockDivider;
                while (sweepCount_ >= sweepTime_) {
                    sweepCount_ -= sweepTime_;
                    channel.frequency = (int(channel.frequency) + sweepStep_) & 0x7ff;
                    channel.period = 2048 - channel.frequency;
                }
            }
            voiceLeft_[index] = channel.volumeLeft * sample;
            voiceRight_[index] = channel.volumeRight * sample;
        }
        outputLeft_ += voiceLeft_[index];
        outputRight_ += voiceRight_[index];
    }
    mixHeld();
}

void WonderSwan::generate(float* left, float* right, uint32_t frames) {
    if (!left || !right) return;
    // MAME configures the stream with integer clock() / 128. Preserve that
    // truncation for caller-supplied clocks that are not multiples of 128.
    const uint32_t engineRate = clock_ / ClockDivider;
    for (uint32_t frame = 0; frame < frames; ++frame) {
        phase_ += engineRate;
        while (phase_ >= rate_) {
            phase_ -= rate_;
            tick();
        }
        left[frame] = heldLeft_;
        right[frame] = heldRight_;
    }
}
