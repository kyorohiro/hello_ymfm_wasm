// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro
// Generated original audio, no ROM/BIOS/disc/assets or output device required.
#include <tetorica/cdda.h>
#include <tetorica/msm5205.h>
#include <tetorica/huc6280.hpp>
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
constexpr double PI = 3.14159265358979323846, MASTER_GAIN = 0.5;
void require(int ok, const char *message) { if (!ok) throw std::runtime_error(message); }
void u16(std::vector<uint8_t> &data, uint16_t n) { data.push_back(uint8_t(n)); data.push_back(uint8_t(n >> 8)); }
void u32(std::vector<uint8_t> &data, uint32_t n) { u16(data, uint16_t(n)); u16(data, uint16_t(n >> 16)); }
void tag(std::vector<uint8_t> &data, const char *text) { data.insert(data.end(), text, text + 4); }
void sample(std::vector<uint8_t> &data, double value) {
    if (!std::isfinite(value) || std::abs(value) >= 1) throw std::runtime_error("Output is nonfinite or clipped");
    u16(data, uint16_t(int16_t(std::lround(value * 32767))));
}
std::vector<uint8_t> disc_audio() {
    std::vector<uint8_t> bytes; bytes.reserve(44100 * 3 * 4);
    for (uint32_t i = 0; i < 44100 * 3; ++i) {
        const double t = i / 44100.0;
        sample(bytes, std::sin(2 * PI * 220 * t) * 0.16);
        sample(bytes, std::sin(2 * PI * 330 * t) * 0.16);
    }
    return bytes;
}
// Small offline encoder using only the public raw decoder API. Candidate
// states are independent values; 16 nibble choices minimize each PCM error.
// The raw clock advances exactly once per render here; playback later selects
// 8 kHz from the PCE rate register. Predictor arithmetic is shared by both.
std::vector<uint8_t> adpcm_audio() {
    msm5205_pcm_state predictor{};
    require(msm5205_pcm_init(&predictor, 16000, 1536000), "ADPCM encoder init failed");
    require(msm5205_pcm_write_register(&predictor, 0, 1), "ADPCM encoder reset failed");
    require(msm5205_pcm_write_register(&predictor, 0, 0), "ADPCM encoder reset release failed");
    std::vector<uint8_t> bytes(8000 / 2);
    for (uint32_t i = 0; i < 8000; ++i) {
        const double target = std::sin(2 * PI * 110 * i / 8000.0) * 0.20;
        double error = std::numeric_limits<double>::infinity();
        uint32_t chosen = 0; msm5205_pcm_state chosen_state{};
        for (uint32_t nibble = 0; nibble < 16; ++nibble) {
            msm5205_pcm_state candidate = predictor; float l, r;
            require(msm5205_pcm_write_register(&candidate, 1, nibble), "ADPCM encoder input failed");
            require(msm5205_pcm_render(&candidate, &l, &r, 1), "ADPCM encoder render failed");
            const double distance = std::abs(l - target);
            if (distance < error) { error = distance; chosen = nibble; chosen_state = candidate; }
        }
        predictor = chosen_state;
        if (i & 1) bytes[i / 2] |= uint8_t(chosen); else bytes[i / 2] = uint8_t(chosen << 4);
    }
    return bytes;
}
void psg_note(void *psg, int midi) {
    const double hz = 440 * std::pow(2.0, (midi - 69) / 12.0);
    const uint32_t period = uint32_t(std::lround(3579545 / (32 * hz)));
    native_huc6280_write(psg, 2, uint8_t(period), 0);
    native_huc6280_write(psg, 3, uint8_t(period >> 8), 0);
    native_huc6280_write(psg, 4, 0x80 | 31, 0);
}
std::vector<uint8_t> render() {
    using Chip = std::unique_ptr<void, void (*)(void *)>;
    Chip psg(native_huc6280_create(RATE), native_huc6280_destroy);
    if (!psg) throw std::runtime_error("HuC6280 allocation failed");
    std::array<uint8_t, 32> wave{};
    for (unsigned i = 0; i < 32; ++i) wave[i] = uint8_t(std::lround(15.5 + 15.5 * std::sin(2 * PI * i / 32)));
    native_huc6280_waveform(psg.get(), 0, wave.data());
    native_huc6280_write(psg.get(), 1, 255, -1); native_huc6280_write(psg.get(), 5, 255, 0);
    // These immutable vectors remain alive until every render is complete.
    const auto disc = disc_audio(), ram = adpcm_audio();
    cdda_pcm_state cd{}; msm5205_pcm_state ad{};
    require(cdda_pcm_init(&cd, RATE), "CD-DA init failed");
    require(cdda_pcm_prepare(&cd, disc.data(), uint32_t(disc.size())), "CD-DA prepare failed");
    require(msm5205_pcm_init(&ad, RATE, 1536000), "ADPCM init failed");
    require(msm5205_pcm_stop(&ad), "ADPCM initial silence failed");
    require(msm5205_pcm_prepare(&ad, ram.data(), uint32_t(ram.size())), "ADPCM prepare failed");
    std::vector<uint8_t> wav; wav.reserve(44 + FRAMES * 4);
    tag(wav, "RIFF"); u32(wav, 36 + FRAMES * 4); tag(wav, "WAVE");
    tag(wav, "fmt "); u32(wav, 16); u16(wav, 1); u16(wav, 2);
    u32(wav, RATE); u32(wav, RATE * 4); u16(wav, 4); u16(wav, 16);
    tag(wav, "data"); u32(wav, FRAMES * 4);
    const std::array<int, 4> notes{{60,64,67,71}};
    for (uint32_t frame = 0; frame < FRAMES; ++frame) {
        // 0-.5s PSG; .5-1s ADPCM; 1-1.5s CD-DA; 1.5-2.75s all three.
        // Each command is applied before rendering that exact common frame.
        if (frame == RATE / 2) {
            native_huc6280_stop(psg.get());
            require(msm5205_pcm_play(&ad, 0, uint32_t(ram.size() * 2), 1, 12), "ADPCM play failed");
        }
        if (frame == RATE) { require(msm5205_pcm_stop(&ad), "ADPCM stop failed"); require(cdda_pcm_play(&cd), "CD-DA play failed"); }
        if (frame == RATE * 3 / 2) require(msm5205_pcm_play(&ad, 0, uint32_t(ram.size() * 2), 1, 12), "ADPCM replay failed");
        if (frame % (RATE / 4) == 0 && (frame < RATE / 2 || (frame >= RATE * 3 / 2 && frame < RATE * 11 / 4))) psg_note(psg.get(), notes[(frame / (RATE / 4)) % 4]);
        if (frame == RATE * 11 / 4) { native_huc6280_stop(psg.get()); require(msm5205_pcm_stop(&ad), "ADPCM final stop failed"); require(cdda_pcm_stop(&cd), "CD-DA final stop failed"); }
        float pl, pr, al, ar, cl, cr;
        native_huc6280_sample(psg.get(), &pl, &pr);
        require(msm5205_pcm_render(&ad, &al, &ar, 1), "ADPCM render failed");
        require(cdda_pcm_render(&cd, &cl, &cr, 1), "CD-DA render failed");
        // Unity device gains; one explicit final master gain, no normalization.
        sample(wav, (pl + al + cl) * MASTER_GAIN); sample(wav, (pr + ar + cr) * MASTER_GAIN);
    }
    return wav;
}
}
int main(int argc, char **argv) {
    if (argc > 2) { std::cerr << "Usage: tetorica_pcengine_cd_wav [output.wav]\n"; return 2; }
    const char *path = argc == 2 ? argv[1] : "pcengine-cd.wav";
    try {
        const auto wav = render(); std::ofstream output(path, std::ios::binary | std::ios::trunc);
        if (!output) throw std::runtime_error("Could not open output file");
        output.write(reinterpret_cast<const char *>(wav.data()), std::streamsize(wav.size())); output.close();
        if (!output) throw std::runtime_error("Could not write output file");
        std::cout << "Wrote 3 seconds of 48 kHz stereo PCM16: " << path << "\nPSG / ADPCM / CD-DA alone, then all three; master gain " << MASTER_GAIN << '\n';
        return 0;
    } catch (const std::exception &error) { std::cerr << "WAV export failed: " << error.what() << '\n'; return 1; }
}
