// Offline MSX-AUDIO-style sound sketch: Y8950 FM/ADPCM-B plus AY and OPLL.
// Uses actual SDK cores and synthetic notes, without devices or sample assets.
#include <tetorica/ay8910.hpp>
#include <tetorica/ym2413.hpp>
#include <tetorica/y8950.hpp>
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
constexpr uint32_t AY_CLOCK = 1789773, OPLL_CLOCK = 3579545;
using Core = std::unique_ptr<void, void (*)(void *)>;
double note_hz(int midi) { return 440.0 * std::pow(2.0, (midi - 69) / 12.0); }

uint8_t opll_note(void *chip, int midi) {
    const double hz = note_hz(midi);
    double error = std::numeric_limits<double>::infinity();
    unsigned block = 0, fnum = 0;
    for (unsigned candidate = 0; candidate < 8; ++candidate) {
        const double unit = OPLL_CLOCK * std::ldexp(1.0, int(candidate)) / (72.0 * 524288.0);
        const long rounded = std::lround(hz / unit);
        if (rounded < 1 || rounded > 511) continue;
        const double difference = std::abs(unit * rounded - hz);
        if (difference < error) { error = difference; block = candidate; fnum = unsigned(rounded); }
    }
    if (!fnum) throw std::runtime_error("OPLL note is outside the hardware pitch range");
    const uint8_t control = uint8_t((block << 1) | (fnum >> 8));
    native_ym2413_write(chip, 0x10, uint8_t(fnum));
    native_ym2413_write(chip, 0x20, control | 0x10);
    return control;
}

void ay_pitch(void *chip, unsigned channel, int midi) {
    // AY tones use 12-bit periods and clock/16, unlike the Sega PSG clock/32.
    const long period = std::lround(AY_CLOCK / (16.0 * note_hz(midi)));
    if (channel > 2 || period < 1 || period > 4095)
        throw std::runtime_error("AY note is outside the hardware pitch range");
    native_ay8910_write(chip, uint8_t(channel * 2), uint8_t(period));
    native_ay8910_write(chip, uint8_t(channel * 2 + 1), uint8_t(period >> 8));
}

void configure_ay(void *chip) {
    native_ay8910_write(chip, 6, 12); // One shared noise generator.
    native_ay8910_write(chip, 7, 0xf8); // All tones enabled; all noise disabled.
    // On the AY model, a 16-level envelope sweep lasts 256*period/clock:
    // period 1400 gives about 200 ms, long enough to hear each plucked note.
    native_ay8910_write(chip, 11, 1400 & 255);
    native_ay8910_write(chip, 12, 1400 >> 8);
}

std::vector<uint8_t> make_adpcm_page() {
    // One caller-owned WRITABLE 4 KiB page, with 2048 encoded sample bytes.
    // Yamaha ADPCM-B is high nibble first, initial step127, clamped16-bit.
    std::vector<uint8_t> page(4096, 0);
    static const int scales[8] = {57,57,57,57,77,102,128,153};
    int predictor = 0, step = 127;
    constexpr double pi = 3.14159265358979323846;
    for (unsigned i = 0; i < 4096; ++i) {
        const double time = i / 16000.0;
        const double gate = std::min(1.0, std::min(i / 16.0, (4095 - i) / 128.0));
        const int target = int(std::lround(0.55 * 32767 * gate * std::exp(-14 * time) * std::sin(2 * pi * 220 * time)));
        int best = 0, best_value = 0, error = std::numeric_limits<int>::max();
        for (int code = 0; code < 16; ++code) {
            const int delta = ((2 * (code & 7) + 1) * step / 8) * ((code & 8) ? -1 : 1);
            const int value = std::max(-32768, std::min(32767, predictor + delta));
            if (std::abs(value - target) < error) { best=code; best_value=value; error=std::abs(value-target); }
        }
        page[i / 2] |= uint8_t(best << ((i & 1) ? 0 : 4));
        predictor = best_value;
        step = std::max(127, std::min(24576, step * scales[best & 7] / 64));
    }
    return page;
}

void configure_y8950(void *chip) {
    for (unsigned slot : {0u,3u}) {
        native_opl_write(chip, uint16_t(0x20+slot), 0x21);
        native_opl_write(chip, uint16_t(0x40+slot), slot == 3 ? 24 : 63);
        native_opl_write(chip, uint16_t(0x60+slot), 0xf0);
        native_opl_write(chip, uint16_t(0x80+slot), 0x0f);
    }
    native_opl_write(chip, 0xc0, 1); // Additive pair with one audible carrier.
    native_opl_write(chip, 7, 1); // ADPCM stop before configuring the range.
    native_opl_write(chip, 8, 2); // 8-bit DRAM, 32-byte units; no fictitious pan.
    native_opl_write(chip, 9, 0); native_opl_write(chip, 10, 0);
    native_opl_write(chip, 11, 63); native_opl_write(chip, 12, 0); // [0,2048) bytes.
    native_opl_write(chip, 18, 200);
}

uint8_t y8950_note(void *chip, int fm_midi, int adpcm_midi) {
    const double hz = note_hz(fm_midi);
    double error = std::numeric_limits<double>::infinity();
    unsigned block = 0, fnum = 0;
    for (unsigned candidate = 0; candidate < 8; ++candidate) {
        const double unit = OPLL_CLOCK * std::ldexp(1.0,int(candidate)) / (72.0 * 1048576.0);
        const long rounded = std::lround(hz / unit);
        if (rounded < 1 || rounded > 1023) continue;
        const double difference = std::abs(unit * rounded - hz);
        if (difference < error) { error=difference; block=candidate; fnum=unsigned(rounded); }
    }
    if (!fnum) throw std::runtime_error("Y8950 FM note is outside the hardware range");
    const uint8_t control = uint8_t((block << 2) | (fnum >> 8));
    native_opl_write(chip, 0xa0, uint8_t(fnum)); native_opl_write(chip, 0xb0, control | 32);
    const double sample_rate = 16000 * note_hz(adpcm_midi) / 220;
    const long delta = std::lround(sample_rate * 72 * 65536 / OPLL_CLOCK);
    if (delta < 1 || delta > 65535) throw std::runtime_error("Y8950 ADPCM rate is outside the hardware range");
    native_opl_write(chip, 7, 1);
    native_opl_write(chip, 16, uint8_t(delta)); native_opl_write(chip, 17, uint8_t(delta >> 8));
    native_opl_write(chip, 7, 0xa0); // One-shot external-memory playback.
    return control;
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
    // Page storage must outlive the Y8950 handle, including exception unwinding.
    auto adpcm_ram = make_adpcm_page();
    Core ay(native_ay8910_create(RATE), native_ay8910_destroy);
    Core opll(native_ym2413_create(RATE), native_ym2413_destroy);
    Core y8950(native_opl_create(RATE, 3), native_opl_destroy); // Header does not select kind.
    if (!ay || !opll || !y8950) throw std::runtime_error("Could not allocate the AY, OPLL and Y8950 cores");
    if (!native_ay8910_set_clock(ay.get(), AY_CLOCK) || !native_ym2413_set_clock(opll.get(), OPLL_CLOCK) ||
        !native_opl_set_clock(y8950.get(), OPLL_CLOCK))
        throw std::runtime_error("Could not configure the reference chip clocks");
    native_opl_memory_page(y8950.get(), 0, adpcm_ram.data());
    native_opl_memory_length(y8950.get(), 2048); // Logical sample length, not the page allocation.
    configure_y8950(y8950.get());
    configure_ay(ay.get());
    native_ym2413_write(opll.get(), 0x30, 0x43); // Built-in flute, attenuation 3, channel 0.

    std::vector<uint8_t> wav;
    const uint32_t data_bytes = FRAMES * 4;
    wav.reserve(44 + data_bytes);
    tag(wav, "RIFF"); u32(wav, 36 + data_bytes); tag(wav, "WAVE");
    tag(wav, "fmt "); u32(wav, 16); u16(wav, 1); u16(wav, 2);
    u32(wav, RATE); u32(wav, RATE * 4); u16(wav, 4); u16(wav, 16);
    tag(wav, "data"); u32(wav, data_bytes);

    const std::array<int, 8> melody{{67, 69, 72, 71, 69, 67, 64, 60}};
    const std::array<int, 8> bass{{48, 53, 48, 55, 53, 48, 55, 48}};
    constexpr uint32_t step = RATE / 3;
    uint8_t control = 0, y_control = 0;
    for (uint32_t frame = 0; frame < FRAMES; ++frame) {
        const uint32_t index = frame / step, within = frame % step;
        if (index < melody.size()) {
            if (within == 0) {
                control = opll_note(opll.get(), melody[index]);
                y_control = y8950_note(y8950.get(), bass[index] + 7, bass[index] + 12);
                ay_pitch(ay.get(), 0, bass[index]);
                ay_pitch(ay.get(), 1, melody[index] - 12);
                ay_pitch(ay.get(), 2, bass[index] + 7);
                native_ay8910_write(ay.get(), 7, 0xd8); // CH3 tone mixed with noise for the attack.
                native_ay8910_write(ay.get(), 8, 11);
                native_ay8910_write(ay.get(), 9, 0x10); // CH2 uses the shared hardware envelope.
                native_ay8910_write(ay.get(), 10, 9);
                native_ay8910_write(ay.get(), 13, 9); // Descending envelope, then hold at zero.
            }
            if (within == RATE / 20) native_ay8910_write(ay.get(), 7, 0xf8);
            if (within == step * 4 / 5) {
                native_ym2413_write(opll.get(), 0x20, control);
                native_ay8910_all_notes_off(ay.get());
                native_opl_write(y8950.get(), 0xb0, y_control);
                native_opl_write(y8950.get(), 7, 1);
            }
        }
        float al, ar, ol, oright, yl, yr;
        native_ay8910_sample(ay.get(), &al, &ar);
        native_ym2413_sample(opll.get(), &ol, &oright);
        native_opl_sample(y8950.get(), &yl, &yr);
        const double fade = std::min(1.0, std::min(frame / 240.0, (FRAMES - 1 - frame) / 12000.0));
        // Fixed mix gains leave headroom without changing any core defaults.
        sample(wav, fade * (0.25 * al + 0.25 * ol + 0.35 * yl));
        sample(wav, fade * (0.25 * ar + 0.25 * oright + 0.35 * yr));
    }
    return wav;
}
}

int main(int argc, char **argv) {
    if (argc != 2) { std::cerr << "Usage: tetorica_msx_audio_wav <output.wav>\n"; return 2; }
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
