// Offline S-DSP instrument host: original BRR loops, eight physical voices.
// No SPC700 program, Nintendo IPL, game ROM, external sample or audio device.
#include <tetorica/snes.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <vector>

namespace {
constexpr uint32_t RATE = 48000, FRAMES = RATE * 3, PERIOD = 64;
constexpr double PI = 3.14159265358979323846;
using Core = std::unique_ptr<void, void (*)(void *)>;

// Four 16-sample BRR blocks, filter 0 and range 11. Signed 4-bit values
// decode to value*2048; quantized amplitudes stay well within Int16 range.
// Only the last block has END+LOOP; the directory loops to the first block.
std::array<uint8_t, 36> waveform(unsigned kind) {
    std::array<uint8_t, 36> bytes{};
    for (unsigned i = 0; i < PERIOD; ++i) {
        const double phase = double(i) / PERIOD;
        const double value = kind == 0 ? std::sin(2 * PI * phase) :
            kind == 1 ? 1.0 - 4.0 * std::abs(phase - 0.5) : (phase < 0.5 ? 1.0 : -1.0);
        const int nibble = int(std::lround(5.0 * value));
        if (nibble < -8 || nibble > 7) throw std::runtime_error("Invalid BRR nibble");
        const unsigned block = i / 16, within = i % 16;
        bytes[block * 9] = uint8_t(0xb0 | (block == 3 ? 3 : 0));
        bytes[block * 9 + 1 + within / 2] |= uint8_t((nibble & 15) << (within % 2 ? 0 : 4));
    }
    return bytes;
}

void upload(void *chip, uint32_t address, const uint8_t *data, uint32_t size) {
    if (address > 65536 || size > 65536 - address || !data ||
        !native_snes_load(chip, data, address, size))
        throw std::runtime_error("Could not copy sample data into S-DSP RAM");
}
void write(void *chip, unsigned reg, unsigned value) {
    if (reg >= 128 || value > 255) throw std::runtime_error("Invalid DSP register write");
    native_snes_write(chip, uint8_t(reg), uint8_t(value));
}
unsigned pitch(unsigned midi) {
    const double hz = 440.0 * std::pow(2.0, (double(midi) - 69.0) / 12.0);
    // PITCH 4096 advances one BRR sample per 32 kHz native frame.
    const unsigned result = unsigned(std::lround(hz * PERIOD * 4096.0 / 32000.0));
    const double actual = result * 32000.0 / (PERIOD * 4096.0);
    if (midi > 127 || result < 1 || result > 0x3fff || std::abs(actual / hz - 1) > 0.01)
        throw std::runtime_error("Musical pitch is outside the supported example range");
    return result;
}
void voice(void *chip, unsigned channel, unsigned sample, unsigned midi,
           unsigned left, unsigned right, bool adsr) {
    if (channel >= 8 || sample >= 3 || left > 127 || right > 127)
        throw std::runtime_error("Invalid S-DSP voice configuration");
    const unsigned base = channel * 16, value = pitch(midi);
    write(chip, base, left); write(chip, base + 1, right);
    write(chip, base + 2, value & 255); write(chip, base + 3, value >> 8);
    write(chip, base + 4, sample);
    write(chip, base + 5, adsr ? 0x8f : 0); // Fast ADSR attack, or direct GAIN.
    write(chip, base + 6, 0xe0);           // Full sustain, no sustain decrease.
    write(chip, base + 7, 127);            // Direct GAIN when ADSR is disabled.
}
void u16(std::vector<uint8_t> &bytes, uint16_t value) {
    bytes.push_back(uint8_t(value)); bytes.push_back(uint8_t(value >> 8));
}
void u32(std::vector<uint8_t> &bytes, uint32_t value) {
    u16(bytes, uint16_t(value)); u16(bytes, uint16_t(value >> 16));
}
void tag(std::vector<uint8_t> &bytes, const char *value) { bytes.insert(bytes.end(), value, value + 4); }
void sample(std::vector<uint8_t> &bytes, double value) {
    if (!std::isfinite(value) || std::abs(value) >= 1.0)
        throw std::runtime_error("Generated PCM is non-finite or exceeds the output headroom");
    u16(bytes, uint16_t(int16_t(std::lround(value * 32767.0))));
}

std::vector<uint8_t> render() {
    Core chip(native_snes_create(RATE), native_snes_destroy);
    if (!chip) throw std::runtime_error("Could not allocate the S-DSP renderer");
    // FLG bit 5 disables echo RAM writes. Zero echo volume/sends/feedback and
    // disable noise/pitch modulation; keep sample/directory RAM unmodified.
    write(chip.get(), 0x6c, 0x20);
    write(chip.get(), 0x0c, 100); write(chip.get(), 0x1c, 100);
    for (unsigned reg : {0x2c, 0x3c, 0x2d, 0x3d, 0x4d, 0x0d, 0x5d}) write(chip.get(), reg, 0);
    write(chip.get(), 0x5c, 255); write(chip.get(), 0x4c, 0);
    for (unsigned kind = 0; kind < 3; ++kind) {
        const auto bytes = waveform(kind);
        const unsigned address = 0x400 + kind * unsigned(bytes.size());
        const std::array<uint8_t, 4> entry{{uint8_t(address), uint8_t(address >> 8),
                                          uint8_t(address), uint8_t(address >> 8)}};
        upload(chip.get(), address, bytes.data(), uint32_t(bytes.size()));
        upload(chip.get(), kind * 4, entry.data(), uint32_t(entry.size()));
        // Both uploads copy immediately; the local source arrays can expire.
    }
    std::vector<uint8_t> wav;
    const uint32_t data_bytes = FRAMES * 4;
    wav.reserve(44 + data_bytes);
    tag(wav, "RIFF"); u32(wav, 36 + data_bytes); tag(wav, "WAVE");
    tag(wav, "fmt "); u32(wav, 16); u16(wav, 1); u16(wav, 2);
    u32(wav, RATE); u32(wav, RATE * 4); u16(wav, 4); u16(wav, 16);
    tag(wav, "data"); u32(wav, data_bytes);

    for (uint32_t frame = 0; frame < FRAMES; ++frame) {
        if (frame == 0) {
            voice(chip.get(), 0, 0, 60, 100, 0, false); // Original sine, C4 left.
            native_snes_key_on(chip.get(), 0);
        }
        if (frame == RATE * 2 / 5) native_snes_key_off(chip.get(), 0);
        if (frame == RATE / 2) {
            voice(chip.get(), 1, 1, 64, 0, 100, true); // Triangle, E4 right.
            native_snes_key_on(chip.get(), 1);
        }
        if (frame == RATE * 9 / 10) native_snes_key_off(chip.get(), 1);
        if (frame == RATE) {
            constexpr std::array<unsigned, 8> chord{{48, 55, 60, 64, 67, 72, 76, 79}};
            for (unsigned ch = 0; ch < 8; ++ch) {
                voice(chip.get(), ch, ch % 3, chord[ch], ch % 2 ? 12 : 28,
                      ch % 2 ? 28 : 12, ch % 2 != 0);
                // Calls at the same native frame merge into one KON mask.
                native_snes_key_on(chip.get(), uint8_t(ch));
            }
        }
        if (frame == RATE * 53 / 20)
            for (unsigned ch = 0; ch < 8; ++ch) native_snes_key_off(chip.get(), uint8_t(ch));
        float left = 0, right = 0;
        native_snes_sample(chip.get(), &left, &right);
        // Fixed gain and 5 ms/40 ms edge fades; do not normalize the core.
        const double fade = std::min(1.0, std::min(frame / 240.0, (FRAMES - 1 - frame) / 1920.0));
        sample(wav, 0.8 * fade * left); sample(wav, 0.8 * fade * right);
    }
    return wav;
}
}

int main(int argc, char **argv) {
    if (argc != 2) { std::cerr << "Usage: tetorica_snes_wav <output.wav>\n"; return 2; }
    try {
        const auto wav = render();
        std::ofstream output(argv[1], std::ios::binary | std::ios::trunc);
        if (!output) throw std::runtime_error("Could not open the selected output file");
        output.write(reinterpret_cast<const char *>(wav.data()), std::streamsize(wav.size()));
        output.close();
        if (!output) throw std::runtime_error("Could not finish writing the WAV file");
        std::cout << "Wrote 3 seconds of 48 kHz stereo PCM16 to " << argv[1] << '\n';
        return 0;
    } catch (const std::exception &error) {
        std::cerr << "WAV export failed: " << error.what() << '\n'; return 1;
    }
}
