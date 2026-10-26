// SPDX-License-Identifier: BSD-3-Clause
// Offline WonderSwan sketch: 4-bit waves, stereo, sweep, noise and host-fed PCM.
// No device or external sample/ROM is needed. The SDK core remains raw unipolar.
#include <tetorica/wonderswan.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {
constexpr uint32_t RATE = 48000, FRAMES = RATE * 3, CLOCK = 3072000;
constexpr double PI = 3.14159265358979323846;
double frequency(int midi) { return 440.0 * std::pow(2.0, (midi - 69) / 12.0); }
void note(tetorica::WonderSwan& chip, unsigned channel, int midi) {
    // Default clock is divisible by 128. Other clocks use 128*floor(clock/128).
    const long period = std::lround(CLOCK / (32.0 * frequency(midi)));
    if (channel >= 4 || period < 1 || period > 2048)
        throw std::runtime_error("Note is outside the WonderSwan waveform pitch range");
    const unsigned value = unsigned(2048 - period);
    chip.writeRegister(0x80 + channel * 2, uint8_t(value));
    chip.writeRegister(0x81 + channel * 2, uint8_t(value >> 8));
}
void configure(tetorica::WonderSwan& chip) {
    // Wave RAM stores the even sample in the low nibble. Each channel uses 16 bytes.
    for (unsigned channel = 0; channel < 4; ++channel) {
        std::array<unsigned, 32> wave{};
        for (unsigned i = 0; i < 32; ++i) {
            if (channel == 0) wave[i] = unsigned(std::lround(7.5 + 7.5 * std::sin(2 * PI * i / 32)));
            if (channel == 1) wave[i] = i < 16 ? i : 31 - i;
            if (channel == 2) wave[i] = i < 16 ? 12 : 3;
            if (channel == 3) wave[i] = i / 2;
        }
        for (unsigned i = 0; i < 16; ++i)
            chip.writeMemory(channel * 16 + i, uint8_t(wave[i * 2] | (wave[i * 2 + 1] << 4)));
    }
    chip.writeRegister(0x91, 8); // Connected stereo headphones enabled.
    chip.writeRegister(0x8f, 0); // Four consecutive waves in the first 64-byte bank.
    chip.writeRegister(0x94, 15); // Host voice-byte full output to both sides.
}

// Listening-example policy only: a 20 Hz first-order DC blocker, fixed 0.7 gain
// and note-boundary fades. It removes the raw DAC's DC without changing SDK PCM,
// its /1024 gain, the register model, or any Native/WASM comparison.
struct Speaker {
    double previousInput = 0, previousOutput = 0;
    const double coefficient = std::exp(-2 * PI * 20 / RATE);
    double process(double input) {
        const double output = input - previousInput + coefficient * previousOutput;
        previousInput = input; previousOutput = output; return output;
    }
};
void u16(std::vector<uint8_t>& bytes, uint16_t value) {
    bytes.push_back(uint8_t(value)); bytes.push_back(uint8_t(value >> 8));
}
void u32(std::vector<uint8_t>& bytes, uint32_t value) {
    u16(bytes, uint16_t(value)); u16(bytes, uint16_t(value >> 16));
}
void tag(std::vector<uint8_t>& bytes, const char* text) { bytes.insert(bytes.end(), text, text + 4); }
void sample(std::vector<uint8_t>& bytes, double value) {
    if (!std::isfinite(value) || std::abs(value) >= 1)
        throw std::runtime_error("PCM is non-finite or exceeds the reserved output headroom");
    u16(bytes, uint16_t(int16_t(std::lround(value * 32767))));
}
std::vector<uint8_t> render() {
    tetorica::WonderSwan chip(CLOCK, RATE);
    configure(chip);
    std::vector<uint8_t> wav;
    const uint32_t dataBytes = FRAMES * 4;
    wav.reserve(44 + dataBytes);
    tag(wav, "RIFF"); u32(wav, 36 + dataBytes); tag(wav, "WAVE");
    tag(wav, "fmt "); u32(wav, 16); u16(wav, 1); u16(wav, 2);
    u32(wav, RATE); u32(wav, RATE * 4); u16(wav, 4); u16(wav, 16);
    tag(wav, "data"); u32(wav, dataBytes);
    const std::array<int, 4> lead{{72, 76, 79, 74}}, chord{{60, 64, 67, 59}}, bass{{48, 52, 55, 55}};
    constexpr unsigned step = RATE / 4;
    Speaker leftSpeaker, rightSpeaker;
    double voicePhase = 0, voiceStep = 0;
    for (unsigned frame = 0; frame < FRAMES; ++frame) {
        const unsigned index = frame / step, within = frame % step, phrase = index / 4;
        if (within == 0) {
            chip.writeRegister(0x90, 0);
            note(chip, 0, lead[index % 4]); note(chip, 1, chord[index % 4]);
            note(chip, 2, bass[index % 4]); note(chip, 3, lead[index % 4] - 12);
            chip.writeRegister(0x88, phrase == 2 ? 0x39 : 0x93);
            chip.writeRegister(0x89, 0x38);
            chip.writeRegister(0x8a, 0x55);
            chip.writeRegister(0x8b, 0x43);
            chip.writeRegister(0x8c, 1); chip.writeRegister(0x8d, 3); // CH3 upward sweep.
            chip.writeRegister(0x8e, 0x18 | (index & 7)); // Reset and enable CH4 noise generator.
            chip.writeRegister(0x90, phrase == 0 ? 0x0f : phrase == 1 ? 0xcf : 0xa7);
            voicePhase = 0; voiceStep = frequency(lead[index % 4] - 12) / RATE;
        }
        if (phrase == 2) {
            // CH2 voice mode is a directly written unsigned 8-bit DAC. The host
            // supplies a byte at each output frame; this does not emulate DMA.
            chip.writeRegister(0x89, uint8_t(std::lround(127.5 + 100 * std::sin(2 * PI * voicePhase))));
            voicePhase += voiceStep; voicePhase -= std::floor(voicePhase);
        }
        if (phrase == 1) {
            const unsigned level = within < RATE / 12 ? 6 - within * 6 / (RATE / 12) : 0;
            chip.writeRegister(0x8b, uint8_t((level << 4) | (level / 2)));
        }
        float left, right;
        chip.generate(&left, &right, 1);
        const double fade = std::min(1.0, std::min(within / 240.0, (step - 1 - within) / 960.0));
        sample(wav, 0.7 * fade * leftSpeaker.process(left));
        sample(wav, 0.7 * fade * rightSpeaker.process(right));
    }
    return wav;
}
}

int main(int argc, char** argv) {
    if (argc != 2) { std::cerr << "Usage: tetorica_wonderswan_wav <output.wav>\n"; return 2; }
    try {
        const auto wav = render();
        std::ofstream output(argv[1], std::ios::binary | std::ios::trunc);
        if (!output) throw std::runtime_error("Could not open the selected output file");
        output.write(reinterpret_cast<const char*>(wav.data()), std::streamsize(wav.size()));
        output.close();
        if (!output) throw std::runtime_error("Could not finish writing the WAV file");
        std::cout << "Wrote 3 seconds of 48 kHz stereo PCM16 to " << argv[1] << '\n'; return 0;
    } catch (const std::exception& error) {
        std::cerr << "WAV export failed: " << error.what() << '\n'; return 1;
    }
}
