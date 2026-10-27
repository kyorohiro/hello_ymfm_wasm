// SPDX-License-Identifier: BSD-3-Clause
// Original dual-POKEY sketch; no game music, ROM, device or external asset.
// Two mono chips are mixed to both channels at 0.5 each, as a host policy.
#include <tetorica/pokey.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
constexpr unsigned RATE = 48000, FRAMES = RATE * 3;
// Atari Tetris uses 14,318,181 / 8 Hz. This integer-clock API rounds the
// fractional result to 1,789,773 Hz; it does not claim exact crystal division.
constexpr unsigned CLOCK = 1789773;
constexpr double PI = 3.14159265358979323846;
void note(tetorica::Pokey& chip, unsigned channel, int midi, unsigned volume, unsigned distortion = 0xa0) {
    const double frequency = 440 * std::pow(2.0, (midi - 69) / 12.0);
    // AUDCTL=0: divide-by-28 clock, an eight-bit AUDF plus one, then /2.
    const long divisor = std::lround(CLOCK / (56.0 * frequency)) - 1;
    if (channel >= 4 || divisor < 0 || divisor > 255 || volume > 15)
        throw std::runtime_error("Note is outside the selected eight-bit clock range");
    chip.writeRegister(channel * 2, uint8_t(divisor));
    chip.writeRegister(channel * 2 + 1, uint8_t(distortion | volume));
}
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
void u32(std::vector<uint8_t>& bytes, uint32_t value) { u16(bytes, uint16_t(value)); u16(bytes, uint16_t(value >> 16)); }
void tag(std::vector<uint8_t>& bytes, const char* value) { bytes.insert(bytes.end(), value, value + 4); }
void sample(std::vector<uint8_t>& bytes, double value) {
    if (!std::isfinite(value) || std::abs(value) >= 1) throw std::runtime_error("Output exceeds example headroom");
    u16(bytes, uint16_t(int16_t(std::lround(value * 32767))));
}
std::vector<uint8_t> render(bool stereo) {
    tetorica::Pokey first(CLOCK, RATE), second(CLOCK, RATE);
    for (auto* chip : {&first, &second}) { chip->writeRegister(15, 3); chip->writeRegister(8, 0); }
    constexpr std::array<int, 12> lead{{72, 76, 79, 74, 77, 81, 79, 76, 74, 71, 67, 72}};
    constexpr std::array<int, 12> harmony{{64, 67, 71, 65, 69, 72, 71, 67, 65, 62, 60, 64}};
    constexpr unsigned STEP = RATE / 4;
    std::vector<uint8_t> wav; wav.reserve(44 + FRAMES * 4);
    tag(wav, "RIFF"); u32(wav, 36 + FRAMES * 4); tag(wav, "WAVE");
    tag(wav, "fmt "); u32(wav, 16); u16(wav, 1); u16(wav, 2);
    u32(wav, RATE); u32(wav, RATE * 4); u16(wav, 4); u16(wav, 16);
    tag(wav, "data"); u32(wav, FRAMES * 4);
    Speaker leftSpeaker, rightSpeaker;
    for (unsigned frame = 0; frame < FRAMES; ++frame) {
        const unsigned index = frame / STEP, within = frame % STEP;
        if (within == 0) {
            note(first, 0, lead[index], 7);
            note(first, 1, harmony[index], 3);
            note(first, 2, lead[index] - 12, 2);
            note(second, 0, harmony[index] - 12, 5);
            note(second, 1, lead[index] - 12, 2);
            note(second, 2, harmony[index], 2);
            second.writeRegister(6, 19); second.writeRegister(7, 0x86); // Short polynomial-noise attack.
            first.writeRegister(9, 0); second.writeRegister(9, 0);
        }
        if (within == RATE / 16) second.writeRegister(7, 0x80);
        float a, ignoredA, b, ignoredB;
        first.generate(&a, &ignoredA, 1); second.generate(&b, &ignoredB, 1);
        // Default is the dual centered-mono route, not an invented stereo
        // register. --stereo explicitly places one physical POKEY per side.
        const double left = stereo ? 0.5 * a : 0.5 * (a + b);
        const double right = stereo ? 0.5 * b : left;
        const double fade = std::min(1.0, std::min(frame / 480.0, (FRAMES - frame - 1) / 960.0));
        sample(wav, fade * leftSpeaker.process(left));
        sample(wav, fade * rightSpeaker.process(right));
    }
    return wav;
}
}

int main(int argc, char** argv) {
    if (argc < 2 || argc > 3 || (argc == 3 && std::string(argv[2]) != "--stereo")) {
        std::cerr << "Usage: tetorica_pokey_wav <output.wav> [--stereo]\n"; return 2;
    }
    try {
        const auto wav = render(argc == 3);
        std::ofstream output(argv[1], std::ios::binary | std::ios::trunc);
        if (!output) throw std::runtime_error("Could not open the selected output file");
        output.write(reinterpret_cast<const char*>(wav.data()), std::streamsize(wav.size())); output.close();
        if (!output) throw std::runtime_error("Could not finish writing the WAV file");
        std::cout << "Wrote 3 seconds of 48 kHz dual-POKEY " << (argc == 3 ? "host stereo" : "centered mono") << " PCM16 to " << argv[1] << '\n'; return 0;
    } catch (const std::exception& error) { std::cerr << "WAV export failed: " << error.what() << '\n'; return 1; }
}
