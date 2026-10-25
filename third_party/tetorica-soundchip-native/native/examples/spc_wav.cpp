// Original SPC700 program and BRR samples: no game music, Nintendo IPL or ROM.
// The emulated CPU, not the host render loop, schedules every DSP note.
#include <tetorica/spc.hpp>
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

std::array<uint8_t, 36> waveform(unsigned kind) {
    std::array<uint8_t, 36> bytes{};
    for (unsigned i = 0; i < PERIOD; ++i) {
        const double phase = double(i) / PERIOD;
        const double value = kind == 0 ? std::sin(2 * PI * phase) :
            kind == 1 ? 1.0 - 4.0 * std::abs(phase - 0.5) : (phase < 0.5 ? 1.0 : -1.0);
        const int nibble = int(std::lround(5.0 * value));
        const unsigned block = i / 16, within = i % 16;
        // Filter 0, range 11, with END+LOOP only on the final block.
        bytes[block * 9] = uint8_t(0xb0 | (block == 3 ? 3 : 0));
        bytes[block * 9 + 1 + within / 2] |= uint8_t((nibble & 15) << (within % 2 ? 0 : 4));
    }
    return bytes;
}
unsigned pitch(unsigned midi) {
    const double hz = 440.0 * std::pow(2.0, (double(midi) - 69.0) / 12.0);
    const unsigned result = unsigned(std::lround(hz * PERIOD * 4096.0 / 32000.0));
    if (midi > 127 || result < 1 || result > 0x3fff)
        throw std::runtime_error("Example pitch is out of range");
    return result;
}

std::vector<uint8_t> spc_file() {
    std::vector<uint8_t> file(0x10200);
    const char signature[] = "SNES-SPC700 Sound File Data v0.30";
    std::copy(signature, signature + sizeof(signature) - 1, file.begin());
    file[0x21] = file[0x22] = 0x1a; file[0x23] = 0x1b; file[0x24] = 30;
    file[0x25] = 0; file[0x26] = 2; file[0x2b] = 0xef; // PC=$0200, SP=$ef.
    auto *ram = file.data() + 0x100, *dsp = file.data() + 0x10100;
    ram[0xf1] = 0; // IPL mapping and timers disabled on load.
    dsp[0x6c] = 0x60; dsp[0x5c] = 255; // Muted until the CPU configures DSP.
    for (unsigned kind = 0; kind < 3; ++kind) {
        const auto bytes = waveform(kind);
        const unsigned address = 0x2000 + kind * unsigned(bytes.size());
        std::copy(bytes.begin(), bytes.end(), ram + address);
        const unsigned entry = 0x1000 + kind * 4;
        ram[entry] = ram[entry + 2] = uint8_t(address);
        ram[entry + 1] = ram[entry + 3] = uint8_t(address >> 8);
    }

    std::vector<uint8_t> code;
    const auto mov = [&code](unsigned dp, unsigned value) {
        if (dp > 255 || value > 255) throw std::runtime_error("Invalid SPC700 operand");
        // MOV dp,#imm.
        code.insert(code.end(), {0x8f, uint8_t(value), uint8_t(dp)});
    };
    const auto write = [&mov](unsigned reg, unsigned value) {
        if (reg >= 128) throw std::runtime_error("Invalid DSP register");
        mov(0xf2, reg); mov(0xf3, value);
    };
    const auto wait = [&code, &mov](unsigned ticks) {
        if (!ticks || ticks > 255) throw std::runtime_error("Invalid timer duration");
        mov(0x30, ticks);
        // Timer 0 counts at 8000/80=100 Hz. Reading $FD clears its count.
        // MOV A,$FD; BEQ -4; DEC $30; BNE -8.
        code.insert(code.end(), {0xe4, 0xfd, 0xf0, 0xfc, 0x8b, 0x30, 0xd0, 0xf8});
    };
    const auto note = [&write](unsigned channel, unsigned midi) {
        const unsigned value = pitch(midi), base = channel * 16;
        write(base + 2, value & 255); write(base + 3, value >> 8);
    };
    mov(0xf1, 0); mov(0xfa, 80); mov(0xf1, 1);
    write(0x5d, 0x10); write(0x0c, 100); write(0x1c, 100);
    for (unsigned reg : {0x2c, 0x3c, 0x2d, 0x3d, 0x4d, 0x0d}) write(reg, 0);
    for (unsigned ch = 0; ch < 3; ++ch) {
        const unsigned base = ch * 16;
        write(base, ch == 0 ? 80 : ch == 1 ? 12 : 28);
        write(base + 1, ch == 0 ? 12 : ch == 1 ? 80 : 28);
        write(base + 4, ch); write(base + 5, 0x8f); // Fast ADSR attack.
        write(base + 6, 0xe0); write(base + 7, 127);
    }
    write(0x4c, 0); write(0x5c, 255); write(0x6c, 0x20); // Dry, no echo writes.
    constexpr std::array<unsigned, 10> melody{{60, 64, 67, 72, 67, 64, 62, 65, 69, 74}};
    for (unsigned i = 0; i < melody.size(); ++i) {
        const unsigned ch = i % 2, mask = 1u << ch;
        note(ch, melody[i]);
        write(0x5c, 0); write(0x4c, mask);
        wait(16); write(0x5c, mask); wait(4); // 160 ms gate + 40 ms release.
    }
    note(0, 60); note(1, 64); note(2, 67);
    write(0x5c, 0); write(0x4c, 7); wait(70); // Final C-major chord.
    write(0x5c, 255); wait(20);
    code.insert(code.end(), {0x2f, 0xfe}); // BRA to self after releasing all voices.
    if (0x200 + code.size() > 0x1000) throw std::runtime_error("SPC700 code overlaps directory");
    std::copy(code.begin(), code.end(), ram + 0x200);
    return file;
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
        throw std::runtime_error("Generated PCM is non-finite or exceeds output headroom");
    u16(bytes, uint16_t(int16_t(std::lround(value * 32767.0))));
}

std::vector<uint8_t> render() {
    const auto bytes = spc_file(); // Retain the original for any future host reload/seek.
    Core chip(native_spc_create(RATE), native_spc_destroy);
    if (!chip) throw std::runtime_error("Could not allocate SPC renderer");
    if (!native_spc_load_control(chip.get(), bytes.data(), uint32_t(bytes.size())))
        throw std::runtime_error(native_spc_error(chip.get()));
    if (!native_spc_observe(chip.get(), 1, 8192) || !native_spc_set_playing(chip.get(), 1))
        throw std::runtime_error("Could not start SPC playback/observation");
    std::vector<uint8_t> wav;
    const uint32_t data_bytes = FRAMES * 4;
    wav.reserve(44 + data_bytes);
    tag(wav, "RIFF"); u32(wav, 36 + data_bytes); tag(wav, "WAVE");
    tag(wav, "fmt "); u32(wav, 16); u16(wav, 1); u16(wav, 2);
    u32(wav, RATE); u32(wav, RATE * 4); u16(wav, 4); u16(wav, 16);
    tag(wav, "data"); u32(wav, data_bytes);
    for (uint32_t frame = 0; frame < FRAMES; ++frame) {
        float left = 0, right = 0;
        native_spc_sample(chip.get(), &left, &right);
        // Fixed 0.8 gain and 5 ms/40 ms fades do not normalize the library.
        const double fade = std::min(1.0, std::min(frame / 240.0, (FRAMES - 1 - frame) / 1920.0));
        sample(wav, 0.8 * fade * left); sample(wav, 0.8 * fade * right);
    }
    if (const char *error = native_spc_error(chip.get())) throw std::runtime_error(error);
    if (native_spc_event_count(chip.get()) < 60 || native_spc_overflow_take(chip.get()))
        throw std::runtime_error("Expected bounded CPU-driven DSP note writes");
    NativeSpcState state{}; native_spc_get_state(chip.get(), &state);
    if (state.output_frames != FRAMES || !state.playing || state.failed)
        throw std::runtime_error("SPC playback did not finish the requested frames");
    return wav;
}
}

int main(int argc, char **argv) {
    if (argc != 2) { std::cerr << "Usage: tetorica_spc_wav <output.wav>\n"; return 2; }
    try {
        const auto wav = render();
        std::ofstream output(argv[1], std::ios::binary | std::ios::trunc);
        if (!output) throw std::runtime_error("Could not open selected output file");
        output.write(reinterpret_cast<const char *>(wav.data()), std::streamsize(wav.size()));
        output.close();
        if (!output) throw std::runtime_error("Could not finish writing WAV file");
        std::cout << "Wrote 3 seconds of 48 kHz stereo PCM16 to " << argv[1] << '\n';
        return 0;
    } catch (const std::exception &error) {
        std::cerr << "WAV export failed: " << error.what() << '\n'; return 1;
    }
}
