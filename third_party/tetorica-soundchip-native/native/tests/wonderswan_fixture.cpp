// SPDX-License-Identifier: BSD-3-Clause
// Offline raw-core checks. The allocation audit intercepts C++ new/new[], not
// arbitrary malloc calls. No device, ROM, WASM runtime or Tauri is used.
#include <tetorica/wonderswan.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <new>
#include <string>
#include <vector>

namespace {
bool audit = false;
std::size_t allocations = 0;
unsigned checks = 0;
void* allocate(std::size_t bytes) {
    if (audit) ++allocations;
    if (void* pointer = std::malloc(bytes ? bytes : 1)) return pointer;
    throw std::bad_alloc();
}
void check(bool condition, const char* description) {
    ++checks;
    if (!condition) {
        std::fprintf(stderr, "WonderSwan fixture failed: %s\n", description);
        std::exit(1);
    }
}
using Core = tetorica::WonderSwan;
void frequency(Core& chip, unsigned channel, unsigned value) {
    chip.writeRegister(0x80 + channel * 2, uint8_t(value));
    chip.writeRegister(0x81 + channel * 2, uint8_t(value >> 8));
}
unsigned frequency(const Core& chip, unsigned channel) {
    return chip.readRegister(0x80 + channel * 2) |
           (unsigned(chip.readRegister(0x81 + channel * 2)) << 8);
}
void constant(Core& chip, unsigned channel, unsigned nibble, unsigned volume) {
    for (unsigned i = 0; i < 16; ++i)
        chip.writeMemory(channel * 16 + i, uint8_t(nibble * 17));
    frequency(chip, channel, 1920); // One waveform fetch per 24 kHz engine tick.
    chip.writeRegister(0x88 + channel, uint8_t(volume));
}
void render(Core& chip, float* left, float* right, unsigned count) {
    chip.generate(left, right, count);
    for (unsigned i = 0; i < count; ++i)
        check(std::isfinite(left[i]) && std::isfinite(right[i]), "finite PCM");
}

void registersAndConfiguration() {
    for (unsigned clock : {0u, 127u, 100000001u, UINT32_MAX})
        check(!Core::validConfiguration(clock, 48000), "invalid clock");
    for (unsigned rate : {0u, 7999u, 384001u, UINT32_MAX})
        check(!Core::validConfiguration(3072000, rate), "invalid sample rate");
    check(Core::validConfiguration(128, 8000), "minimum configuration");
    check(Core::validConfiguration(100000000, 384000), "maximum configuration");
    Core invalid(0, 48000), reference; // Both clock and rate fall back together.
    constant(invalid, 0, 9, 0xf3); constant(reference, 0, 9, 0xf3);
    invalid.writeRegister(0x90, 1); reference.writeRegister(0x90, 1);
    invalid.writeRegister(0x91, 8); reference.writeRegister(0x91, 8);
    std::array<float, 97> al{}, ar{}, bl{}, br{};
    render(invalid, al.data(), ar.data(), 97); render(reference, bl.data(), br.data(), 97);
    check(al == bl && ar == br, "invalid constructor uses default clock and rate");

    Core chip;
    chip.writeMemory(0, 0x12); chip.writeMemory(0x3fff, 0xab);
    chip.writeMemory(0x4000, 0xff); chip.writeMemory(UINT32_MAX, 0xff);
    check(chip.readMemory(0) == 0x12 && chip.readMemory(0x3fff) == 0xab,
          "owned RAM endpoints");
    check(chip.readMemory(0x4000) == 0 && chip.readMemory(UINT32_MAX) == 0,
          "invalid RAM addresses ignored");
    for (unsigned address : {0u, 0x7fu, 0xa0u, UINT32_MAX}) {
        chip.writeRegister(address, 0xff);
        check(chip.readRegister(address) == 0, "invalid I/O addresses ignored");
    }
    frequency(chip, 0, 0xffff);
    check(frequency(chip, 0) == 0x7ff, "11-bit frequency mask");
    chip.writeRegister(0x91, 0xff);
    check(chip.readRegister(0x91) == 0x8f, "output-control mask and connected headphones");
    chip.writeRegister(0x94, 0xff); chip.writeRegister(0x9e, 0xff);
    check(chip.readRegister(0x94) == 15 && chip.readRegister(0x9e) == 3,
          "PCM-routing and system-volume masks");
    chip.reset();
    check(chip.readMemory(0) == 0 && chip.readMemory(0x3fff) == 0, "reset clears RAM");
    for (unsigned address = 0x80; address <= 0x9f; ++address)
        check(chip.readRegister(address) == (address == 0x91 ? 0x80 : 0), "cold registers");
    al.fill(-1); ar.fill(-2);
    render(chip, al.data(), ar.data(), 97);
    for (unsigned i = 0; i < 97; ++i) check(al[i] == 0 && ar[i] == 0, "cold silence");
    al.fill(-1); ar.fill(-2);
    chip.generate(nullptr, ar.data(), UINT32_MAX);
    chip.generate(al.data(), nullptr, UINT32_MAX);
    chip.generate(al.data(), ar.data(), 0);
    check(al.front() == -1 && ar.back() == -2, "null and empty render leave buffers untouched");
}

void wavesAndStereo() {
    Core chip(3072000, 24000);
    constexpr unsigned nibbles[] = {1, 3, 5, 7}, volumes[] = {0xf0, 0x0f, 0xa5, 0x39};
    for (unsigned c = 0; c < 4; ++c) constant(chip, c, nibbles[c], volumes[c]);
    chip.writeRegister(0x90, 15); chip.writeRegister(0x91, 8);
    std::array<float, 18> left{}, right{};
    left.fill(-1); right.fill(-1);
    chip.generate(left.data() + 1, right.data() + 1, 16);
    check(left.front() == -1 && left.back() == -1 && right.front() == -1 && right.back() == -1,
          "render respects both buffer guards");
    check(left[1] == 0 && right[1] == 0, "initial signal precedes first wave fetch");
    for (unsigned i = 2; i <= 16; ++i)
        check(left[i] == 86.0f / 1024 && right[i] == 133.0f / 1024,
              "four independent waves retain exact raw stereo gain");
    check(chip.readRegister(0x96) == 86 && chip.readRegister(0x98) == 133 &&
          chip.readRegister(0x9a) == 219, "raw output-monitor registers");
    for (unsigned channel = 0; channel < 4; ++channel) {
        chip.mute(channel, true);
        render(chip, left.data(), right.data(), 1);
        const unsigned l = nibbles[channel] * (volumes[channel] >> 4);
        const unsigned r = nibbles[channel] * (volumes[channel] & 15);
        check(left[0] == float(86 - l) / 1024 && right[0] == float(133 - r) / 1024,
              "host mute removes exactly the selected physical channel");
        chip.mute(channel, false);
        render(chip, left.data(), right.data(), 1);
        check(left[0] == 86.0f / 1024 && right[0] == 133.0f / 1024,
              "unmute restores just the selected channel");
    }
    chip.writeRegister(0x91, 0);
    render(chip, left.data(), right.data(), 16);
    for (unsigned i = 0; i < 16; ++i) check(left[i] == 0 && right[i] == 0, "headphones disabled");

    chip.reset();
    chip.writeRegister(0x8f, 255); // Final 64-byte bank, including CH4's final RAM byte.
    for (unsigned i = 0; i < 16; ++i) chip.writeMemory(0x3ff0 + i, 0x21);
    frequency(chip, 3, 1920); chip.writeRegister(0x8b, 0xf0);
    chip.writeRegister(0x90, 8); chip.writeRegister(0x91, 8);
    render(chip, left.data(), right.data(), 16);
    for (unsigned i = 1; i < 16; ++i)
        check(left[i] == float((i & 1) ? 15 : 30) / 1024 && right[i] == 0,
              "banked waveform reads even sample in low nibble");
}

void noiseAndSweep() {
    constexpr unsigned taps[] = {14, 10, 13, 4, 8, 6, 9, 11};
    for (unsigned type = 0; type < 8; ++type) {
        Core chip(3072000, 24000);
        constant(chip, 3, 7, 0xf5);
        chip.writeRegister(0x8e, uint8_t(0x18 | type));
        chip.writeRegister(0x90, 0x88); chip.writeRegister(0x91, 8);
        unsigned shift = 0, output = 0, signal = 0;
        for (unsigned i = 0; i < 257; ++i) {
            float left, right;
            chip.generate(&left, &right, 1);
            check(left == float(signal * 15) / 1024 && right == float(signal * 5) / 1024,
                  "independent noise sequence and stereo levels");
            signal = output ? 15 : 0;
            output = (1 ^ (shift >> 7) ^ (shift >> taps[type])) & 1;
            shift = ((shift << 1) | output) & 0xffff;
            check((chip.readRegister(0x92) | (unsigned(chip.readRegister(0x93)) << 8)) == shift,
                  "readable noise shift register follows chosen tap");
        }
        chip.writeRegister(0x8e, uint8_t(0x18 | type));
        check(chip.readRegister(0x92) == 0 && chip.readRegister(0x93) == 0, "noise reset strobe");
    }
    Core chip(3072000, 24000);
    constant(chip, 2, 9, 0xff);
    frequency(chip, 2, 2040);
    chip.writeRegister(0x8c, 16); chip.writeRegister(0x8d, 0);
    chip.writeRegister(0x90, 0x44); chip.writeRegister(0x91, 8);
    std::array<float, 64> left{}, right{};
    render(chip, left.data(), right.data(), 63);
    check(frequency(chip, 2) == 2040, "sweep waits full interval");
    render(chip, left.data(), right.data(), 1);
    check(frequency(chip, 2) == 8, "positive sweep wraps to 11 bits");
    chip.writeRegister(0x8c, 0xf0);
    render(chip, left.data(), right.data(), 64);
    check(frequency(chip, 2) == 2040, "negative sweep wraps to 11 bits");
    check(chip.readRegister(0x8c) == 0xf0 && chip.readRegister(0x8d) == 0xff,
          "negative sweep read preserves pinned upstream signed-promotion quirk");
}

void voicePcm() {
    for (unsigned route = 0; route < 16; ++route) {
        Core chip(3072000, 24000);
        chip.writeRegister(0x90, 0x22); chip.writeRegister(0x91, 8);
        chip.writeRegister(0x94, uint8_t(route));
        for (unsigned byte = 0; byte <= 255; byte += 17) {
            chip.writeRegister(0x89, uint8_t(byte));
            float left, right;
            chip.generate(&left, &right, 1);
            const unsigned expectedLeft = route & 12 ? byte >> ((route & 8) ? 0 : 1) : 0;
            const unsigned expectedRight = route & 3 ? byte >> ((route & 2) ? 0 : 1) : 0;
            check(left == float(expectedLeft) / 1024 && right == float(expectedRight) / 1024,
                  "voice-byte direct DAC routing and half/full levels");
        }
        chip.writeRegister(0x90, 0x20); // Mode alone does not enable channel 2.
        float left, right; chip.generate(&left, &right, 1);
        check(left == 0 && right == 0, "voice PCM retains upstream channel-2 gate requirement");
    }
}

void setupMixed(Core& chip) {
    for (unsigned c = 0; c < 4; ++c) {
        for (unsigned i = 0; i < 16; ++i)
            chip.writeMemory(c * 16 + i, uint8_t((i + c) | (((31 - i + c) & 15) << 4)));
        frequency(chip, c, 1700 + c * 73);
        chip.writeRegister(0x88 + c, uint8_t(0xf0 - c * 17 + c));
    }
    chip.writeRegister(0x8c, 0xfb); chip.writeRegister(0x8d, 0);
    chip.writeRegister(0x8e, 0x1b);
    chip.writeRegister(0x90, 0xcf); chip.writeRegister(0x91, 8);
}

void partitionMuteResetAndAllocations() {
    constexpr unsigned frames = 8193;
    for (unsigned clock : {3072000u, 3072127u, 128u, 100000000u}) {
        Core whole(clock, 48000), split(clock, 48000);
        setupMixed(whole); setupMixed(split);
        std::vector<float> wl(frames), wr(frames), sl(frames), sr(frames);
        render(whole, wl.data(), wr.data(), frames);
        for (unsigned offset = 0, block = 1; offset < frames; block = block % 257 + 1) {
            const unsigned count = std::min(block, frames - offset);
            render(split, sl.data() + offset, sr.data() + offset, count); offset += count;
        }
        check(wl == sl && wr == sr, "PCM and phase are independent of render partition");
        check(frequency(whole, 2) == frequency(split, 2) &&
              whole.readRegister(0x92) == split.readRegister(0x92) &&
              whole.readRegister(0x93) == split.readRegister(0x93), "partition retains sweep/noise state");
    }
    Core muted(3072000, 24000), reference(3072000, 24000);
    setupMixed(muted); setupMixed(reference);
    std::array<float, 128> left{}, right{}, expectedLeft{}, expectedRight{};
    for (unsigned c = 0; c < 4; ++c) muted.mute(c, true);
    render(muted, left.data(), right.data(), 128);
    render(reference, expectedLeft.data(), expectedRight.data(), 128);
    for (unsigned i = 0; i < 128; ++i) check(left[i] == 0 && right[i] == 0, "all host mutes suppress output");
    for (unsigned c = 0; c < 4; ++c) muted.mute(c, false);
    muted.mute(4, true); muted.mute(UINT32_MAX, true);
    render(muted, left.data(), right.data(), 128);
    render(reference, expectedLeft.data(), expectedRight.data(), 128);
    check(left == expectedLeft && right == expectedRight, "muted waveform/noise/sweep continue advancing");
    muted.mute(0, true); muted.reset(); reference.reset();
    setupMixed(muted); setupMixed(reference);
    render(muted, left.data(), right.data(), 128);
    render(reference, expectedLeft.data(), expectedRight.data(), 128);
    check(left == expectedLeft && right == expectedRight, "cold reset restores mute and deterministic phase");

    allocations = 0; audit = true;
    void* probe = ::operator new(1); ::operator delete(probe);
    audit = false;
    check(allocations == 1, "allocation counter positive control");
    allocations = 0; audit = true;
    for (unsigned i = 0; i < 2048; ++i) {
        frequency(muted, i & 3, i & 2047);
        muted.writeMemory(i & 0x3fff, uint8_t(i));
        muted.writeRegister(0x8e, uint8_t(i & 31));
        muted.writeRegister(0x90, uint8_t(i & 1 ? 0xcf : 0xef));
        muted.writeRegister(0x89, uint8_t(i));
        muted.mute(i & 3, (i & 4) != 0);
        muted.generate(left.data(), right.data(), 128);
        (void)muted.readRegister(0x92); (void)muted.readMemory(i & 0x3fff);
    }
    audit = false;
    check(allocations == 0, "2048 hot-path blocks and writes perform no C++ new/new[] allocations");
}
}

void* operator new(std::size_t n) { return allocate(n); }
void* operator new[](std::size_t n) { return allocate(n); }
void operator delete(void* p) noexcept { std::free(p); }
void operator delete[](void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }
void operator delete[](void* p, std::size_t) noexcept { std::free(p); }

int main(int argc, char** argv) {
    if (argc != 2 || std::string(argv[1]) != "--self-test") {
        std::fprintf(stderr, "Usage: tetorica_wonderswan_fixture --self-test\n"); return 2;
    }
    registersAndConfiguration(); wavesAndStereo(); noiseAndSweep(); voicePcm();
    partitionMuteResetAndAllocations();
    std::printf("{\"status\":\"pass\",\"checks\":%u,\"renderBlocks\":2048,"
                "\"trackedCppNewAllocations\":%zu,\"directMallocTracked\":false}\n", checks, allocations);
    return 0;
}
