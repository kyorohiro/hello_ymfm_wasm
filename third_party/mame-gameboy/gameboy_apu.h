// license:BSD-3-Clause
// copyright-holders:Wilbert Pol, Anthony Kruize
// thanks-to:Shay Green
// Standalone adaptation; see README.md for pinned MAME source and output model.
#pragma once
#include <cstdint>
#include <array>
class GameboyApu {
public:
    GameboyApu(uint32_t rate, uint32_t clock);
    void reset();
    // offset is the register's position relative to GB I/O 0xFF10 (0x00-0x2F):
    // 0x00-0x16 NR10-NR52 (with gaps at 0x05/0x0F/0x17-0x1F), 0x20-0x2F wave RAM.
    void write(uint8_t offset, uint8_t value);
    void generate(float *left, float *right, uint32_t frames);
    uint32_t sample_rate() const { return rate; }
    // bit0-3 mute square1/square2/wave/noise.
    void set_mute_mask(uint32_t mask) { mute_mask = mask & 0xf; }
private:
    struct Channel {
        uint8_t reg[5]{};
        bool on = false;
        uint8_t channelNumber = 0; // 1,2,3,4 (matches MAME; 3 = wave, used by dacEnabled)
        uint8_t length = 0;
        uint8_t lengthMask = 0x3f;
        bool lengthCounting = false;
        bool lengthEnabled = false;
        uint16_t frequency = 0;
        uint16_t frequencyCounter = 0;
        uint32_t subCycle = 0;
        int8_t duty = 0;
        bool envelopeEnabled = false;
        int8_t envelopeValue = 0;
        int8_t envelopeDirection = -1;
        uint8_t envelopeTime = 0;
        uint8_t envelopeCount = 0;
        int8_t signal = 0;
        // Channel 1 (square 1) sweep.
        uint16_t frequencyShadow = 0;
        bool sweepEnabled = false;
        bool sweepNegModeUsed = false;
        uint8_t sweepShift = 0;
        int32_t sweepDirection = 1;
        uint8_t sweepTime = 0;
        uint8_t sweepCount = 0;
        // Channel 3 (wave).
        uint8_t level = 0;
        uint8_t waveOffset = 0;
        uint8_t dutyCount = 0;
        int8_t currentSample = 0;
        bool sampleReading = false;
        // Channel 4 (noise).
        bool noiseShort = false;
        uint16_t noiseLfsr = 0;
    };
    void writeInternal(uint8_t offset, uint8_t value);
    void powerOff();
    void tickLength(Channel &channel);
    int32_t calculateNextSweep(Channel &channel);
    void applyNextSweep(Channel &channel);
    void tickSweep(Channel &channel);
    void tickEnvelope(Channel &channel);
    bool dacEnabled(const Channel &channel) const;
    uint32_t noisePeriodCycles() const;
    void tickSquare(Channel &channel);
    void tickWave(Channel &channel);
    void tickNoise(Channel &channel);
    void tick();
    // Equivalent to MAME's `!(m_snd_control.cycles & FRAME_CYCLES)`: true on
    // even frame-sequencer steps (0,2,4,6). Enabling the length counter
    // while this holds triggers the well-documented extra immediate length
    // clock quirk (see sound_w_internal's NRx4 handlers in the upstream).
    bool lengthClockPending() const { return (frameStep & 1) == 0; }

    Channel channels[4];
    uint8_t waveRam[16]{};
    bool powerOn = false;
    uint8_t volLeft = 0, volRight = 0;
    bool chanLeft[4]{}, chanRight[4]{};
    uint32_t frameCycle = 0;
    uint8_t frameStep = 0;
    static constexpr uint32_t FRAME_CYCLES = 8192;

    uint32_t rate, clock;
    uint32_t mute_mask = 0;
    // Integer phase units: each output sample spans `clock` units, and each
    // native tick (one CPU cycle) spans `rate` units, matching this chip's
    // undivided-clock tick model (like this project's K051649 adaptation).
    uint64_t tick_remaining = 0;
    std::array<float, 4> lastLeft{};
    std::array<float, 4> lastRight{};
};
