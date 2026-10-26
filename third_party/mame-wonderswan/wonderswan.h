// license:BSD-3-Clause
// copyright-holders:Wilbert Pol, kyorohiro
#ifndef TETORICA_WONDERSWAN_H
#define TETORICA_WONDERSWAN_H

#include <array>
#include <cstddef>
#include <cstdint>

// Standalone adaptation of MAME's WonderSwan headphone sound path.
// Byte-addressed I/O registers: 0x80..0x9f. Wave RAM: 0x0000..0x3fff.
// Output is the raw, unipolar headphone DAC, with MAME's /1024 scaling.
class WonderSwan {
public:
    WonderSwan(uint32_t clock = 3072000, uint32_t sampleRate = 44100);
    static bool validConfiguration(uint32_t clock, uint32_t sampleRate);
    void reset();
    void writeRegister(uint32_t address, uint8_t value);
    uint8_t readRegister(uint32_t address) const;
    void writeMemory(uint32_t address, uint8_t value);
    uint8_t readMemory(uint32_t address) const;
    void mute(uint32_t channel, bool muted);
    void generate(float* left, float* right, uint32_t frames);

private:
    struct Channel {
        uint16_t frequency = 0;
        uint16_t period = 2048;
        uint32_t position = 0;
        uint8_t volumeLeft = 0;
        uint8_t volumeRight = 0;
        bool on = false;
        uint8_t offset = 0;
        uint8_t signal = 0;
    };
    uint8_t fetchSample(unsigned channel, unsigned offset) const;
    void tick();
    void mixHeld();
    uint16_t readWord(uint32_t address) const;
    uint32_t clock_;
    uint32_t rate_;
    uint64_t phase_ = 0;
    std::array<uint8_t, 0x4000> memory_{};
    std::array<Channel, 4> channels_{};
    std::array<bool, 4> muted_{};
    int8_t sweepStep_ = 0;
    uint32_t sweepTime_ = 8192;
    uint32_t sweepCount_ = 0;
    uint8_t noiseType_ = 0;
    bool noiseEnable_ = false;
    uint8_t noiseOutput_ = 0;
    uint16_t sampleAddress_ = 0;
    bool voice_ = false;
    bool sweep_ = false;
    bool noise_ = false;
    uint8_t outputControl_ = 0;
    uint16_t noiseShift_ = 0;
    uint8_t sampleVolume_ = 0;
    uint8_t systemVolume_ = 0;
    uint16_t outputLeft_ = 0;
    uint16_t outputRight_ = 0;
    std::array<uint16_t, 4> voiceLeft_{};
    std::array<uint16_t, 4> voiceRight_{};
    float heldLeft_ = 0;
    float heldRight_ = 0;
};

#endif
