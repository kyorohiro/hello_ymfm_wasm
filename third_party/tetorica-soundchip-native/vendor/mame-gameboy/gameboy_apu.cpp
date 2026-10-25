// license:BSD-3-Clause
// copyright-holders:Wilbert Pol, Anthony Kruize
// thanks-to:Shay Green
#include "gameboy_apu.h"
#include <algorithm>

namespace {
constexpr uint8_t NR10 = 0x00, NR11 = 0x01, NR12 = 0x02, NR13 = 0x03, NR14 = 0x04;
constexpr uint8_t NR21 = 0x06, NR22 = 0x07, NR23 = 0x08, NR24 = 0x09;
constexpr uint8_t NR30 = 0x0a, NR31 = 0x0b, NR32 = 0x0c, NR33 = 0x0d, NR34 = 0x0e;
constexpr uint8_t NR41 = 0x10, NR42 = 0x11, NR43 = 0x12, NR44 = 0x13;
constexpr uint8_t NR50 = 0x14, NR51 = 0x15, NR52 = 0x16;
constexpr int WAVE_DUTY_TABLE[4] = {0b10000000, 0b10000001, 0b11100001, 0b01111110};
constexpr int NOISE_DIVISOR[8] = {8, 16, 32, 48, 64, 80, 96, 112};

bool bit(uint8_t value, int n) { return (value >> n) & 1; }
}

GameboyApu::GameboyApu(uint32_t sample_rate, uint32_t input_clock)
 : rate(sample_rate), clock(input_clock) {
    reset();
}

void GameboyApu::reset() {
    for (auto &channel : channels) channel = Channel{};
    channels[0].channelNumber = 1; channels[0].lengthMask = 0x3f;
    channels[1].channelNumber = 2; channels[1].lengthMask = 0x3f;
    channels[2].channelNumber = 3; channels[2].lengthMask = 0xff;
    channels[3].channelNumber = 4; channels[3].lengthMask = 0x3f;
    powerOn = false;
    volLeft = volRight = 0;
    for (int i = 0; i < 4; i++) chanLeft[i] = chanRight[i] = false;
    frameCycle = 0;
    frameStep = 0;
    tick_remaining = 0;
    lastLeft = {};
    lastRight = {};
    writeInternal(NR52, 0x00);
    // DMG power-on wave RAM garbage pattern (matches this MAME revision).
    static constexpr uint8_t initialWave[16] = {
        0xac, 0xdd, 0xda, 0x48, 0x36, 0x02, 0xcf, 0x16,
        0x2c, 0x04, 0xe5, 0x2c, 0xac, 0xdd, 0xda, 0x48,
    };
    for (int i = 0; i < 16; i++) waveRam[i] = initialWave[i];
}

bool GameboyApu::dacEnabled(const Channel &channel) const {
    return channel.channelNumber != 3 ? bool(channel.reg[2] & 0xf8) : bool(channel.reg[0] & 0x80);
}

uint32_t GameboyApu::noisePeriodCycles() const {
    const Channel &noise = channels[3];
    return NOISE_DIVISOR[noise.reg[3] & 7] << (noise.reg[3] >> 4);
}

void GameboyApu::tickLength(Channel &channel) {
    if (channel.lengthEnabled) {
        channel.length = (channel.length + 1) & channel.lengthMask;
        if (channel.length == 0) { channel.on = false; channel.lengthCounting = false; }
    }
}

int32_t GameboyApu::calculateNextSweep(Channel &channel) {
    channel.sweepNegModeUsed = channel.sweepDirection < 0;
    const int32_t newFrequency = channel.frequencyShadow + channel.sweepDirection * (channel.frequencyShadow >> channel.sweepShift);
    if (newFrequency > 0x7ff) channel.on = false;
    return newFrequency;
}

void GameboyApu::applyNextSweep(Channel &channel) {
    const int32_t newFrequency = calculateNextSweep(channel);
    if (channel.on && channel.sweepShift > 0) {
        channel.frequency = uint16_t(newFrequency);
        channel.frequencyShadow = channel.frequency;
        channel.reg[3] = channel.frequency & 0xff;
        channel.reg[4] = (channel.reg[4] & ~0x7) | ((channel.frequency >> 8) & 0x7);
    }
}

void GameboyApu::tickSweep(Channel &channel) {
    channel.sweepCount = (channel.sweepCount - 1) & 0x07;
    if (channel.sweepCount == 0) {
        channel.sweepCount = channel.sweepTime;
        if (channel.sweepEnabled && channel.sweepTime > 0) {
            applyNextSweep(channel);
            calculateNextSweep(channel);
        }
    }
}

void GameboyApu::tickEnvelope(Channel &channel) {
    if (channel.envelopeEnabled) {
        channel.envelopeCount = (channel.envelopeCount - 1) & 0x07;
        if (channel.envelopeCount == 0) {
            channel.envelopeCount = channel.envelopeTime;
            if (channel.envelopeCount) {
                const int8_t newValue = channel.envelopeValue + channel.envelopeDirection;
                if (newValue >= 0 && newValue <= 15) channel.envelopeValue = newValue;
                else channel.envelopeEnabled = false;
            }
        }
    }
}

void GameboyApu::tickSquare(Channel &channel) {
    if (!channel.on) return;
    if (++channel.subCycle >= 4) {
        channel.subCycle = 0;
        if (++channel.frequencyCounter > 0x7ff) {
            channel.frequencyCounter = channel.frequency;
            channel.dutyCount = (channel.dutyCount + 1) & 7;
            channel.signal = bit(WAVE_DUTY_TABLE[channel.duty], channel.dutyCount);
        }
    }
}

void GameboyApu::tickWave(Channel &channel) {
    if (!channel.on) return;
    if (++channel.subCycle >= 2) {
        channel.subCycle = 0;
        channel.frequencyCounter = (channel.frequencyCounter + 1) & 0x7ff;
        channel.sampleReading = false;
        if (channel.frequencyCounter == 0x7ff) channel.waveOffset = (channel.waveOffset + 1) & 0x1f;
        if (channel.frequencyCounter == 0) {
            channel.sampleReading = true;
            channel.currentSample = waveRam[channel.waveOffset / 2];
            if (!(channel.waveOffset & 1)) channel.currentSample >>= 4;
            channel.currentSample &= 0x0f;
            channel.frequencyCounter = channel.frequency;
        }
    }
    const uint8_t level = channel.level & 3;
    channel.signal = level ? (channel.currentSample >> (level - 1)) : 0;
}

void GameboyApu::tickNoise(Channel &channel) {
    // Not gated by channel.on: the LFSR free-runs on real hardware even when
    // the channel is silenced, matching MAME's update_noise_channel.
    if (++channel.subCycle >= noisePeriodCycles()) {
        channel.subCycle = 0;
        const uint16_t feedback = ((channel.noiseLfsr >> 1) ^ channel.noiseLfsr) & 1;
        channel.noiseLfsr = (channel.noiseLfsr >> 1) | (feedback << 14);
        if (channel.noiseShort) channel.noiseLfsr = (channel.noiseLfsr & ~(1 << 6)) | (feedback << 6);
        channel.signal = (~channel.noiseLfsr) & 1;
    }
}

void GameboyApu::tick() {
    if (powerOn) {
        if (++frameCycle >= FRAME_CYCLES) {
            frameCycle = 0;
            frameStep = (frameStep + 1) & 7;
            switch (frameStep) {
                case 0: case 4:
                    tickLength(channels[0]); tickLength(channels[1]); tickLength(channels[2]); tickLength(channels[3]);
                    break;
                case 2: case 6:
                    tickSweep(channels[0]);
                    tickLength(channels[0]); tickLength(channels[1]); tickLength(channels[2]); tickLength(channels[3]);
                    break;
                case 7:
                    tickEnvelope(channels[0]); tickEnvelope(channels[1]); tickEnvelope(channels[3]);
                    break;
                default: break;
            }
        }
        tickSquare(channels[0]);
        tickSquare(channels[1]);
        tickWave(channels[2]);
        tickNoise(channels[3]);
    }

    for (int i = 0; i < 4; i++) {
        Channel &channel = channels[i];
        float sample = 0.0f;
        if (channel.on) {
            const int raw = (i == 2) ? int(channel.signal) : int(channel.signal) * int(channel.envelopeValue);
            sample = float(0xf - raw * 2);
        }
        lastLeft[i] = (channel.on && chanLeft[i]) ? sample : 0.0f;
        lastRight[i] = (channel.on && chanRight[i]) ? sample : 0.0f;
    }
}

void GameboyApu::writeInternal(uint8_t offset, uint8_t value) {
    switch (offset) {
        case NR10: {
            Channel &ch = channels[0];
            const uint8_t oldReg = ch.reg[0];
            ch.reg[0] = value;
            ch.sweepShift = value & 0x7;
            ch.sweepDirection = bit(value, 3) ? -1 : 1;
            ch.sweepTime = (value & 0x70) >> 4;
            if (bit(oldReg, 3) && !bit(value, 3) && ch.sweepNegModeUsed) ch.on = false;
            break;
        }
        case NR11: {
            Channel &ch = channels[0];
            ch.reg[1] = value;
            if (powerOn) ch.duty = (value & 0xc0) >> 6;
            ch.length = value & 0x3f;
            ch.lengthCounting = true;
            break;
        }
        case NR12: {
            Channel &ch = channels[0];
            ch.reg[2] = value;
            ch.envelopeValue = value >> 4;
            ch.envelopeDirection = bit(value, 3) ? 1 : -1;
            ch.envelopeTime = value & 0x07;
            if (!dacEnabled(ch)) ch.on = false;
            break;
        }
        case NR13: {
            Channel &ch = channels[0];
            ch.reg[3] = value;
            if (!ch.sweepEnabled) ch.frequency = ((ch.reg[4] & 0x7) << 8) | ch.reg[3];
            break;
        }
        case NR14: {
            Channel &ch = channels[0];
            ch.reg[4] = value;
            const bool lengthWasEnabled = ch.lengthEnabled;
            ch.lengthEnabled = bit(value, 6);
            ch.frequency = ((ch.reg[4] & 0x7) << 8) | ch.reg[3];
            if (!lengthWasEnabled && lengthClockPending() && ch.lengthCounting && ch.lengthEnabled)
                tickLength(ch);
            if (bit(value, 7)) {
                ch.on = true;
                ch.envelopeEnabled = true;
                ch.envelopeValue = ch.reg[2] >> 4;
                ch.envelopeCount = ch.envelopeTime;
                ch.sweepCount = ch.sweepTime;
                ch.sweepNegModeUsed = false;
                ch.signal = 0;
                ch.lengthCounting = true;
                ch.frequency = ((ch.reg[4] & 0x7) << 8) | ch.reg[3];
                ch.frequencyCounter = ch.frequency;
                ch.frequencyShadow = ch.frequency;
                ch.subCycle = 0;
                ch.dutyCount = 0;
                ch.sweepEnabled = ch.sweepShift != 0 || ch.sweepTime != 0;
                if (!dacEnabled(ch)) ch.on = false;
                if (ch.sweepShift > 0) calculateNextSweep(ch);
                if (ch.length == 0 && ch.lengthEnabled && lengthClockPending()) tickLength(ch);
            } else if (!ch.sweepEnabled) {
                ch.frequency = ((ch.reg[4] & 0x7) << 8) | ch.reg[3];
            }
            break;
        }
        case NR21: {
            Channel &ch = channels[1];
            ch.reg[1] = value;
            if (powerOn) ch.duty = (value & 0xc0) >> 6;
            ch.length = value & 0x3f;
            ch.lengthCounting = true;
            break;
        }
        case NR22: {
            Channel &ch = channels[1];
            ch.reg[2] = value;
            ch.envelopeValue = value >> 4;
            ch.envelopeDirection = bit(value, 3) ? 1 : -1;
            ch.envelopeTime = value & 0x07;
            if (!dacEnabled(ch)) ch.on = false;
            break;
        }
        case NR23: {
            Channel &ch = channels[1];
            ch.reg[3] = value;
            ch.frequency = ((ch.reg[4] & 0x7) << 8) | ch.reg[3];
            break;
        }
        case NR24: {
            Channel &ch = channels[1];
            ch.reg[4] = value;
            const bool lengthWasEnabled = ch.lengthEnabled;
            ch.lengthEnabled = bit(value, 6);
            if (!lengthWasEnabled && lengthClockPending() && ch.lengthCounting && ch.lengthEnabled) tickLength(ch);
            if (bit(value, 7)) {
                ch.on = true;
                ch.envelopeEnabled = true;
                ch.envelopeValue = ch.reg[2] >> 4;
                ch.envelopeCount = ch.envelopeTime;
                ch.frequency = ((ch.reg[4] & 0x7) << 8) | ch.reg[3];
                ch.frequencyCounter = ch.frequency;
                ch.subCycle = 0;
                ch.dutyCount = 0;
                ch.signal = 0;
                ch.lengthCounting = true;
                if (!dacEnabled(ch)) ch.on = false;
                if (ch.length == 0 && ch.lengthEnabled && lengthClockPending()) tickLength(ch);
            } else {
                ch.frequency = ((ch.reg[4] & 0x7) << 8) | ch.reg[3];
            }
            break;
        }
        case NR30: {
            Channel &ch = channels[2];
            ch.reg[0] = value;
            if (!dacEnabled(ch)) ch.on = false;
            break;
        }
        case NR31: {
            Channel &ch = channels[2];
            ch.reg[1] = value;
            ch.length = value;
            ch.lengthCounting = true;
            break;
        }
        case NR32: {
            Channel &ch = channels[2];
            ch.reg[2] = value;
            ch.level = (value & 0x60) >> 5;
            break;
        }
        case NR33: {
            Channel &ch = channels[2];
            ch.reg[3] = value;
            ch.frequency = ((ch.reg[4] & 0x7) << 8) | ch.reg[3];
            break;
        }
        case NR34: {
            Channel &ch = channels[2];
            ch.reg[4] = value;
            const bool lengthWasEnabled = ch.lengthEnabled;
            ch.lengthEnabled = bit(value, 6);
            if (!lengthWasEnabled && lengthClockPending() && ch.lengthCounting && ch.lengthEnabled) tickLength(ch);
            if (bit(value, 7)) {
                ch.on = true;
                ch.waveOffset = 0;
                ch.duty = 1;
                ch.dutyCount = 0;
                ch.lengthCounting = true;
                ch.frequency = ((ch.reg[4] & 0x7) << 8) | ch.reg[3];
                ch.frequencyCounter = ch.frequency;
                ch.subCycle = 0;
                ch.currentSample = 0;
                ch.sampleReading = false;
                if (!dacEnabled(ch)) ch.on = false;
                if (ch.length == 0 && ch.lengthEnabled && lengthClockPending()) tickLength(ch);
            } else {
                ch.frequency = ((ch.reg[4] & 0x7) << 8) | ch.reg[3];
            }
            break;
        }
        case NR41: {
            Channel &ch = channels[3];
            ch.reg[1] = value;
            ch.length = value & 0x3f;
            ch.lengthCounting = true;
            break;
        }
        case NR42: {
            Channel &ch = channels[3];
            ch.reg[2] = value;
            ch.envelopeValue = value >> 4;
            ch.envelopeDirection = bit(value, 3) ? 1 : -1;
            ch.envelopeTime = value & 0x07;
            if (!dacEnabled(ch)) ch.on = false;
            break;
        }
        case NR43: {
            Channel &ch = channels[3];
            ch.reg[3] = value;
            ch.noiseShort = bit(value, 3);
            break;
        }
        case NR44: {
            Channel &ch = channels[3];
            ch.reg[4] = value;
            const bool lengthWasEnabled = ch.lengthEnabled;
            ch.lengthEnabled = bit(value, 6);
            if (!lengthWasEnabled && lengthClockPending() && ch.lengthCounting && ch.lengthEnabled) tickLength(ch);
            if (bit(value, 7)) {
                ch.on = true;
                ch.envelopeEnabled = true;
                ch.envelopeValue = ch.reg[2] >> 4;
                ch.envelopeCount = ch.envelopeTime;
                ch.subCycle = 0;
                ch.signal = 0;
                ch.noiseLfsr = 0x7fff;
                ch.lengthCounting = true;
                if (!dacEnabled(ch)) ch.on = false;
                if (ch.length == 0 && ch.lengthEnabled && lengthClockPending()) tickLength(ch);
            }
            break;
        }
        case NR50:
            volLeft = value & 0x7;
            volRight = (value & 0x70) >> 4;
            break;
        case NR51:
            chanRight[0] = bit(value, 0); chanLeft[0] = bit(value, 4);
            chanRight[1] = bit(value, 1); chanLeft[1] = bit(value, 5);
            chanRight[2] = bit(value, 2); chanLeft[2] = bit(value, 6);
            chanRight[3] = bit(value, 3); chanLeft[3] = bit(value, 7);
            break;
        case NR52:
            if (!bit(value, 7)) powerOff();
            powerOn = bit(value, 7);
            break;
        default:
            break; // 0x05, 0x0F, 0x17-0x1F: unused
    }
}

void GameboyApu::powerOff() {
    writeInternal(NR10, 0x00); channels[0].duty = 0; channels[0].reg[1] = 0;
    writeInternal(NR12, 0x00); writeInternal(NR13, 0x00); writeInternal(NR14, 0x00);
    channels[0].frequencyShadow = 0; channels[0].lengthCounting = false; channels[0].sweepNegModeUsed = false;

    channels[1].reg[1] = 0;
    writeInternal(NR22, 0x00); writeInternal(NR23, 0x00); writeInternal(NR24, 0x00);
    channels[1].lengthCounting = false;

    writeInternal(NR30, 0x00); writeInternal(NR32, 0x00); writeInternal(NR33, 0x00); writeInternal(NR34, 0x00);
    channels[2].lengthCounting = false; channels[2].currentSample = 0;

    channels[3].reg[1] = 0;
    writeInternal(NR42, 0x00); writeInternal(NR43, 0x00); writeInternal(NR44, 0x00);
    channels[3].lengthCounting = false;

    for (auto &channel : channels) channel.on = false;

    for (int offset = NR44 + 1; offset < NR52; offset++) writeInternal(offset, 0x00);
}

void GameboyApu::write(uint8_t offset, uint8_t value) {
    if (offset >= 0x20 && offset <= 0x2f) {
        // Wave RAM (GB I/O 0xFF30-0xFF3F): real hardware exposes this
        // independent of the sound controller's power state, matching
        // MAME's separate dmg_apu_device::wave_w entry point.
        Channel &wave = channels[2];
        if (wave.on) {
            if (wave.sampleReading) waveRam[wave.waveOffset / 2] = value;
        } else {
            waveRam[offset - 0x20] = value;
        }
        return;
    }
    if (!powerOn && offset != NR52 && offset != NR11 && offset != NR21 && offset != NR31 && offset != NR41) return;
    writeInternal(offset, value);
}

void GameboyApu::generate(float *left, float *right, uint32_t frames) {
    for (uint32_t i = 0; i < frames; i++) {
        uint64_t remaining = clock;
        double sumLeft = 0, sumRight = 0;
        while (remaining) {
            if (!tick_remaining) { tick(); tick_remaining = uint64_t(rate); }
            const uint64_t duration = std::min(remaining, tick_remaining);
            for (int channel = 0; channel < 4; channel++) {
                if (mute_mask & (1u << channel)) continue;
                sumLeft += lastLeft[channel] * double(duration);
                sumRight += lastRight[channel] * double(duration);
            }
            remaining -= duration;
            tick_remaining -= duration;
        }
        const double scaleLeft = (1 + volLeft) / 480.0;
        const double scaleRight = (1 + volRight) / 480.0;
        left[i] = float((sumLeft / double(clock)) * scaleLeft);
        right[i] = float((sumRight / double(clock)) * scaleRight);
    }
}
