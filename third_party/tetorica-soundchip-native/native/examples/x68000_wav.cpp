// Offline X68000-style sound sketch: YM2151 FM plus one OKIM6258 ADPCM voice.
// Original synthetic sample data only; no device, ROM or application runtime.
#include <tetorica/okim6258.hpp>
#include <tetorica/ym2151.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <limits>
#include <memory>
#include <stdexcept>
#include <vector>

namespace {
constexpr uint32_t RATE = 48000, FRAMES = RATE * 3;
constexpr uint32_t FM_CLOCK = 4000000, OKI_CLOCK = 8000000, OKI_DIVIDER = 512;
constexpr double PI = 3.14159265358979323846;
using Core = std::unique_ptr<void, void (*)(void *)>;

void fm_note(void *chip, unsigned channel, int midi) {
    // Match the OPM KC/KF convention: quantize to 1/64 semitone and compensate
    // for this X68000-style 4 MHz clock rather than the core's reference clock.
    const long pitch = std::lround((midi - 13 + 12 * std::log2(3579545.0 / FM_CLOCK)) * 64);
    if (channel > 7 || pitch < 0 || pitch > 95 * 64 + 63)
        throw std::runtime_error("FM note is outside the OPM hardware pitch range");
    static const unsigned codes[12] = {0,1,2,4,5,6,8,9,10,12,13,14};
    const unsigned index = unsigned(pitch / 64), fraction = unsigned(pitch % 64);
    native_ym2151_write(chip, uint8_t(0x28 + channel), uint8_t(((index / 12) << 4) | codes[index % 12]));
    native_ym2151_write(chip, uint8_t(0x30 + channel), uint8_t(fraction << 2));
    native_ym2151_write(chip, 0x08, uint8_t(0x78 | channel));
}

void configure_fm(void *chip) {
    const std::array<unsigned, 3> levels{{20,42,46}};
    for (unsigned channel = 0; channel < levels.size(); ++channel) {
        for (unsigned op = 0; op < 4; ++op) {
            const unsigned offset = op * 8 + channel;
            native_ym2151_write(chip, uint8_t(0x40 + offset), 1);
            native_ym2151_write(chip, uint8_t(0x60 + offset), uint8_t(op == 0 ? levels[channel] : 127));
            native_ym2151_write(chip, uint8_t(0x80 + offset), 31);
            native_ym2151_write(chip, uint8_t(0xa0 + offset), 0);
            native_ym2151_write(chip, uint8_t(0xc0 + offset), 0);
            native_ym2151_write(chip, uint8_t(0xe0 + offset), 15);
        }
        native_ym2151_write(chip, uint8_t(0x20 + channel), uint8_t(channel == 1 ? 0x87 : channel == 2 ? 0x47 : 0xc7));
    }
}

std::vector<uint8_t> percussion_sample() {
    // Greedy encoder for the retained 12-bit OKI decoder: initial predictor -2,
    // low nibble first, separate integer terms, and OKI's step-index changes.
    const std::array<int, 8> shifts{{-1,-1,-1,-1,2,4,6,8}};
    std::array<int, 49> steps{};
    for (unsigned i = 0; i < steps.size(); ++i) steps[i] = int(std::floor(16.0 * std::pow(1.1, i)));
    constexpr unsigned sample_frames = 4096;
    std::vector<uint8_t> bytes(sample_frames / 2, 0);
    int predictor = -2, step_index = 0;
    uint32_t random = 0x2468ace1;
    for (unsigned i = 0; i < sample_frames; ++i) {
        const double time = double(i) * OKI_DIVIDER / OKI_CLOCK;
        random = random * 1664525u + 1013904223u;
        const double noise = double(random >> 8) / 8388607.5 - 1;
        const double tone = std::sin(2 * PI * (70 * time + 2.5 * (1 - std::exp(-35 * time))));
        const double gate = std::min(1.0, std::min(i / 16.0, (sample_frames - 1 - i) / 128.0));
        const double pcm = gate * (0.55 * std::exp(-22 * time) * tone + 0.12 * std::exp(-100 * time) * noise);
        const int target = int(std::lround(pcm * (pcm < 0 ? 2048 : 2047)));
        const int step = steps[unsigned(step_index)];
        int best = 0, best_value = 0, error = std::numeric_limits<int>::max();
        for (int code = 0; code < 16; ++code) {
            const int difference = step / 8 + ((code & 1) ? step / 4 : 0) +
                ((code & 2) ? step / 2 : 0) + ((code & 4) ? step : 0);
            const int value = std::max(-2048, std::min(2047, predictor + ((code & 8) ? -difference : difference)));
            if (std::abs(value - target) < error) { best = code; best_value = value; error = std::abs(value - target); }
        }
        bytes[i / 2] |= uint8_t(best << ((i & 1) * 4));
        predictor = best_value;
        step_index = std::max(0, std::min(48, step_index + shifts[unsigned(best & 7)]));
    }
    return bytes;
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
    // load_sample BORROWS this vector. Declare it before both core handles so
    // reverse destruction destroys the decoder before its immutable bytes.
    const auto encoded = percussion_sample();
    Core fm(native_ym2151_create(RATE), native_ym2151_destroy);
    Core oki(native_extra_okim6258_create(RATE), native_extra_okim6258_destroy);
    if (!fm || !oki) throw std::runtime_error("Could not allocate the YM2151 and OKIM6258 cores");
    if (!native_ym2151_set_clock(fm.get(), FM_CLOCK) || !native_extra_okim6258_set_clock(oki.get(), OKI_CLOCK) ||
        !native_extra_okim6258_write(oki.get(), 12, 2) || !native_extra_okim6258_write(oki.get(), 2, 0))
        throw std::runtime_error("Could not configure the chip clocks/divider/pan");
    if (!native_extra_okim6258_load_sample(oki.get(), encoded.data(), uint32_t(encoded.size())))
        throw std::runtime_error("Could not bind the borrowed synthetic ADPCM sample");
    configure_fm(fm.get());
    std::vector<uint8_t> wav;
    const uint32_t data_bytes = FRAMES * 4;
    wav.reserve(44 + data_bytes);
    tag(wav, "RIFF"); u32(wav, 36 + data_bytes); tag(wav, "WAVE");
    tag(wav, "fmt "); u32(wav, 16); u16(wav, 1); u16(wav, 2);
    u32(wav, RATE); u32(wav, RATE * 4); u16(wav, 4); u16(wav, 16);
    tag(wav, "data"); u32(wav, data_bytes);
    const std::array<int, 8> melody{{69,72,76,79,76,72,71,69}};
    const std::array<int, 8> bass{{45,45,48,50,48,45,52,45}};
    constexpr uint32_t step = RATE / 3;
    for (uint32_t frame = 0; frame < FRAMES; ++frame) {
        const uint32_t index = frame / step, within = frame % step;
        if (index < melody.size()) {
            if (within == 0) {
                fm_note(fm.get(), 0, melody[index]);
                fm_note(fm.get(), 1, melody[index] - 12);
                fm_note(fm.get(), 2, bass[index]);
                if (!native_extra_okim6258_play(oki.get(), 0)) throw std::runtime_error("Could not start ADPCM percussion");
            }
            if (within == step * 4 / 5)
                for (unsigned channel = 0; channel < 3; ++channel) native_ym2151_write(fm.get(), 0x08, uint8_t(channel));
        }
        float fl, fr, ol, oright;
        native_ym2151_sample(fm.get(), &fl, &fr);
        native_extra_okim6258_sample(oki.get(), &ol, &oright);
        const double fade = std::min(1.0, std::min(frame / 240.0, (FRAMES - 1 - frame) / 12000.0));
        // Fixed example mix, with no library/default normalization changes.
        sample(wav, fade * (0.5 * fl + 0.3 * ol));
        sample(wav, fade * (0.5 * fr + 0.3 * oright));
    }
    return wav;
}
}

int main(int argc, char **argv) {
    if (argc != 2) { std::cerr << "Usage: tetorica_x68000_wav <output.wav>\n"; return 2; }
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
        std::cerr << "WAV export failed: " << error.what() << '\n';
        return 1;
    }
}
