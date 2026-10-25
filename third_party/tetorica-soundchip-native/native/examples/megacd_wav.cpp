// Offline Mega-CD sound sketch: YM2612 + Sega PSG + primary RF5C164.
// Original looping PCM wave, no device, external ROM or application runtime.
#include <tetorica/rf5c164.hpp>
#include <tetorica/segapsg.hpp>
#include <tetorica/ym2612.hpp>
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
constexpr uint32_t FM_CLOCK = 7670454, PSG_CLOCK = 3579545, PCM_CLOCK = 12500000;
constexpr unsigned WAVE_LENGTH = 128;
using Core = std::unique_ptr<void, void (*)(void *)>;

double note_hz(int midi) { return 440.0 * std::pow(2.0, (midi - 69) / 12.0); }

void fm_note(void *chip, int midi) {
    const double hz = note_hz(midi);
    double error = std::numeric_limits<double>::infinity();
    unsigned block = 0, fnum = 0;
    for (unsigned candidate = 0; candidate < 8; ++candidate) {
        // OPN hardware pitch: Hz = FNUM * clock * 2^(BLOCK-1) / (144*2^20).
        const double unit = FM_CLOCK * std::ldexp(1.0, int(candidate) - 1) / (144.0 * 1048576.0);
        const long rounded = std::lround(hz / unit);
        if (rounded < 1 || rounded > 2047) continue;
        const double difference = std::abs(unit * rounded - hz);
        if (difference < error) { error = difference; block = candidate; fnum = unsigned(rounded); }
    }
    if (!fnum) throw std::runtime_error("FM note is outside the hardware pitch range");
    native_ym2612_write(chip, 0, 0xa4, uint8_t((block << 3) | (fnum >> 8)));
    native_ym2612_write(chip, 0, 0xa0, uint8_t(fnum));
    native_ym2612_write(chip, 0, 0x28, 0xf0); // All four operators, channel 0.
}

void psg_tone(void *chip, unsigned channel, int midi, uint8_t attenuation) {
    // A square-wave cycle takes two periods at the clock/16 generator rate.
    const long period = std::lround(PSG_CLOCK / (32.0 * note_hz(midi)));
    if (channel > 2 || period < 2 || period > 1023)
        throw std::runtime_error("PSG note is outside the hardware pitch range");
    native_game_gear_write(chip, uint8_t(0x80 | (channel << 5) | (period & 15)));
    native_game_gear_write(chip, uint8_t(period >> 4));
    native_game_gear_write(chip, uint8_t(0x90 | (channel << 5) | attenuation));
}

void configure_fm(void *chip) {
    for (unsigned op = 0; op < 4; ++op) {
        const unsigned offset = op * 4;
        native_ym2612_write(chip, 0, uint8_t(0x30 + offset), 1);
        native_ym2612_write(chip, 0, uint8_t(0x40 + offset), op == 0 ? 0 : 127);
        native_ym2612_write(chip, 0, uint8_t(0x50 + offset), 31);
        native_ym2612_write(chip, 0, uint8_t(0x60 + offset), 4);
        native_ym2612_write(chip, 0, uint8_t(0x70 + offset), 0);
        native_ym2612_write(chip, 0, uint8_t(0x80 + offset), 15);
    }
    native_ym2612_write(chip, 0, 0xb0, 7);    // One audible independent carrier.
    native_ym2612_write(chip, 0, 0xb4, 0xc0); // Centered FM output.
}

void configure_pcm(void *chip) {
    // Sign-magnitude PCM: bit 7 is positive, 0x80 is zero. Positive magnitude
    // 127 would encode 0xff, which is reserved as the loop marker, so cap at126.
    // A marker-filled tail also catches steps that skip the very first marker.
    std::vector<uint8_t> wave(256, 0xff);
    constexpr double pi = 3.14159265358979323846;
    for (unsigned i = 0; i < WAVE_LENGTH; ++i) {
        const double phase = 2 * pi * i / WAVE_LENGTH;
        const double value = std::sin(phase) + 0.15 * std::sin(2 * phase);
        const unsigned magnitude = unsigned(std::min(126l, std::lround(std::abs(value) * 100)));
        wave[i] = uint8_t(magnitude | (value >= 0 ? 0x80 : 0));
    }
    // Absolute RAM upload copies bytes and is independent of the CPU bank.
    if (!native_rf5c164_load(chip, wave.data(), 0, uint32_t(wave.size())))
        throw std::runtime_error("Could not upload the synthetic PCM waveform");
    native_rf5c164_write(chip, 8, 0xff); // All eight channel gates off.
    const std::array<uint8_t, 3> volumes{{72,48,36}}, pans{{0x9f,0xf9,0xcc}};
    for (unsigned channel = 0; channel < volumes.size(); ++channel) {
        native_rf5c164_write(chip, 7, uint8_t(0xc0 | channel)); // Global enable + channel select.
        native_rf5c164_write(chip, 0, volumes[channel]);
        native_rf5c164_write(chip, 1, pans[channel]); // Low nibble=left, high nibble=right.
        native_rf5c164_write(chip, 4, 0); native_rf5c164_write(chip, 5, 0); // Byte loop address 0.
        native_rf5c164_write(chip, 6, 0); // Start address in 256-byte units.
    }
}

void pcm_note(void *chip, unsigned channel, int midi) {
    // One source tick per384 clocks; address has11 fractional bits.
    const long step = std::lround(note_hz(midi) * WAVE_LENGTH * 384.0 * 2048.0 / PCM_CLOCK);
    if (channel > 7 || step < 1 || step > 65535)
        throw std::runtime_error("PCM note is outside the hardware step range");
    native_rf5c164_write(chip, 7, uint8_t(0xc0 | channel));
    native_rf5c164_write(chip, 2, uint8_t(step));
    native_rf5c164_write(chip, 3, uint8_t(step >> 8));
}

void u16(std::vector<uint8_t> &bytes, uint16_t value) {
    bytes.push_back(uint8_t(value)); bytes.push_back(uint8_t(value >> 8));
}
void u32(std::vector<uint8_t> &bytes, uint32_t value) {
    u16(bytes, uint16_t(value)); u16(bytes, uint16_t(value >> 16));
}
void tag(std::vector<uint8_t> &bytes, const char *value) {
    bytes.insert(bytes.end(), value, value + 4);
}
void sample(std::vector<uint8_t> &bytes, double value) {
    if (!std::isfinite(value) || std::abs(value) >= 1.0)
        throw std::runtime_error("Generated PCM is non-finite or exceeds the output headroom");
    u16(bytes, uint16_t(int16_t(std::lround(value * 32767.0))));
}

std::vector<uint8_t> render() {
    Core fm(native_ym2612_create(RATE), native_ym2612_destroy);
    Core psg(native_game_gear_create(RATE), native_game_gear_destroy);
    Core pcm(native_rf5c164_create(RATE), native_rf5c164_destroy);
    if (!fm || !psg || !pcm) throw std::runtime_error("Could not allocate the FM, PSG and PCM cores");
    if (!native_ym2612_set_clock(fm.get(), FM_CLOCK) || !native_game_gear_set_clock(psg.get(), PSG_CLOCK))
        throw std::runtime_error("Could not configure the reference chip clocks");
    // Primary RF clock setter is void and unbounded; this fixed positive
    // reference is deliberate. It is not the guarded additional-profile API.
    native_rf5c164_set_clock(pcm.get(), PCM_CLOCK);
    // Mega-CD retains the Genesis PSG output on both channels.
    native_game_gear_set_stereo(psg.get(), 0xff);
    configure_fm(fm.get());
    configure_pcm(pcm.get());

    std::vector<uint8_t> wav;
    const uint32_t data_bytes = FRAMES * 4;
    wav.reserve(44 + data_bytes);
    tag(wav, "RIFF"); u32(wav, 36 + data_bytes); tag(wav, "WAVE");
    tag(wav, "fmt "); u32(wav, 16); u16(wav, 1); u16(wav, 2);
    u32(wav, RATE); u32(wav, RATE * 4); u16(wav, 4); u16(wav, 16);
    tag(wav, "data"); u32(wav, data_bytes);

    const std::array<int, 8> melody{{60, 64, 67, 69, 67, 64, 62, 60}};
    const std::array<int, 8> bass{{48, 48, 55, 53, 48, 48, 55, 48}};
    constexpr uint32_t step = RATE / 3;
    for (uint32_t frame = 0; frame < FRAMES; ++frame) {
        const uint32_t index = frame / step, within = frame % step;
        if (index < melody.size()) {
            if (within == 0) {
                fm_note(fm.get(), melody[index]);
                psg_tone(psg.get(), 0, melody[index] + 12, 10);
                psg_tone(psg.get(), 1, bass[index], 10);
                psg_tone(psg.get(), 2, bass[index] + 7, 13);
                pcm_note(pcm.get(), 0, bass[index]);
                pcm_note(pcm.get(), 1, bass[index] + 7);
                pcm_note(pcm.get(), 2, melody[index]);
                native_rf5c164_write(pcm.get(), 8, 0xf8); // First three PCM gates on.
                native_game_gear_write(psg.get(), 0xe4); // Short white-noise hat.
                native_game_gear_write(psg.get(), 0xfb);
            }
            if (within == RATE / 40) native_game_gear_write(psg.get(), 0xff);
            if (within == step * 4 / 5) {
                native_ym2612_write(fm.get(), 0, 0x28, 0);
                for (uint8_t channel = 0; channel < 3; ++channel)
                    native_game_gear_key_off(psg.get(), channel);
                native_rf5c164_write(pcm.get(), 8, 0xff); // Ordinary hardware gate-off.
            }
        }
        float fl, fr, pl, pr, cl, cr;
        native_ym2612_sample(fm.get(), &fl, &fr);
        native_game_gear_sample(psg.get(), &pl, &pr);
        native_rf5c164_sample(pcm.get(), &cl, &cr);
        const double fade = std::min(1.0, std::min(frame / 240.0, (FRAMES - 1 - frame) / 12000.0));
        // Fixed export gains preserve core output. Their full-scale sum is
        // below1; these are not SDK defaults or motherboard analog ratios.
        sample(wav, fade * (0.35 * fl + 0.15 * pl + 0.4 * cl));
        sample(wav, fade * (0.35 * fr + 0.15 * pr + 0.4 * cr));
    }
    return wav;
}
}

int main(int argc, char **argv) {
    if (argc != 2) { std::cerr << "Usage: tetorica_megacd_wav <output.wav>\n"; return 2; }
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
