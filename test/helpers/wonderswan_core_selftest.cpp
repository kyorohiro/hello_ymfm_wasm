// license:BSD-3-Clause
// copyright-holders:kyorohiro
// Independent C ABI bounds/lifetime and render-allocation checks. Allocation
// accounting covers C++ new/new[] calls, not unrelated direct malloc calls.
#include "wonderswan.h"
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <new>

namespace {
bool trackAllocations = false;
std::size_t trackedAllocations = 0;
unsigned checks = 0;

void* allocate(std::size_t bytes) {
    if (trackAllocations) ++trackedAllocations;
    if (void* pointer = std::malloc(bytes ? bytes : 1)) return pointer;
    throw std::bad_alloc();
}

void check(bool condition, const char* description) {
    ++checks;
    if (!condition) {
        std::fprintf(stderr, "WonderSwan selftest failed: %s\n", description);
        std::exit(1);
    }
}
}

void* operator new(std::size_t bytes) { return allocate(bytes); }
void* operator new[](std::size_t bytes) { return allocate(bytes); }
void* operator new(std::size_t bytes, const std::nothrow_t&) noexcept {
    try { return allocate(bytes); } catch (...) { return nullptr; }
}
void* operator new[](std::size_t bytes, const std::nothrow_t&) noexcept {
    try { return allocate(bytes); } catch (...) { return nullptr; }
}
void operator delete(void* pointer) noexcept { std::free(pointer); }
void operator delete[](void* pointer) noexcept { std::free(pointer); }
void operator delete(void* pointer, std::size_t) noexcept { std::free(pointer); }
void operator delete[](void* pointer, std::size_t) noexcept { std::free(pointer); }
void operator delete(void* pointer, const std::nothrow_t&) noexcept { std::free(pointer); }
void operator delete[](void* pointer, const std::nothrow_t&) noexcept { std::free(pointer); }

extern "C" {
void* wonderswan_create(uint32_t clock, uint32_t rate);
void wonderswan_destroy(WonderSwan* chip);
void wonderswan_reset(WonderSwan* chip);
void wonderswan_write(WonderSwan* chip, uint32_t address, uint32_t value);
uint32_t wonderswan_read(const WonderSwan* chip, uint32_t address);
void wonderswan_write_memory(WonderSwan* chip, uint32_t address, uint32_t value);
uint32_t wonderswan_read_memory(const WonderSwan* chip, uint32_t address);
void wonderswan_mute(WonderSwan* chip, uint32_t channel, uint32_t muted);
void wonderswan_generate(WonderSwan* chip, float* left, float* right, uint32_t frames);
}

namespace {
WonderSwan* create(uint32_t clock = 3072000, uint32_t rate = 24000) {
    auto* chip = static_cast<WonderSwan*>(wonderswan_create(clock, rate));
    check(chip != nullptr, "valid C ABI creation");
    return chip;
}

void wave(WonderSwan* chip, uint8_t packed, uint8_t volume) {
    for (uint32_t i = 0; i < 16; ++i) wonderswan_write_memory(chip, i, packed);
    wonderswan_write(chip, 0x80, 1920 & 255);
    wonderswan_write(chip, 0x81, 1920 >> 8);
    wonderswan_write(chip, 0x88, volume);
    wonderswan_write(chip, 0x90, 1);
    wonderswan_write(chip, 0x91, 8);
}

void expectSilence(const std::array<float, 128>& left,
                   const std::array<float, 128>& right) {
    for (std::size_t i = 0; i < left.size(); ++i)
        check(left[i] == 0 && right[i] == 0, "cold or disabled output is silent");
}
}

int main() {
    constexpr uint32_t maximum = UINT32_MAX;
    constexpr uint32_t invalidClocks[] = {0, 1, 127, 100000001, maximum};
    constexpr uint32_t invalidRates[] = {0, 1, 7999, 384001, maximum};
    for (uint32_t clock : invalidClocks)
        check(wonderswan_create(clock, 24000) == nullptr, "invalid clock rejected");
    for (uint32_t rate : invalidRates)
        check(wonderswan_create(3072000, rate) == nullptr, "invalid sample rate rejected");
    auto* minimumChip = create(128, 8000);
    auto* maximumChip = create(100000000, 384000);
    wonderswan_destroy(minimumChip);
    wonderswan_destroy(maximumChip);

    std::array<float, 128> left{}, right{};
    left.fill(0.25f);
    right.fill(0.5f);
    wonderswan_destroy(nullptr);
    wonderswan_reset(nullptr);
    wonderswan_write(nullptr, maximum, maximum);
    wonderswan_write_memory(nullptr, maximum, maximum);
    wonderswan_mute(nullptr, maximum, maximum);
    check(wonderswan_read(nullptr, maximum) == 0, "null register read");
    check(wonderswan_read_memory(nullptr, maximum) == 0, "null RAM read");
    wonderswan_generate(nullptr, left.data(), right.data(), maximum);
    wonderswan_generate(nullptr, nullptr, nullptr, maximum);
    check(left.front() == 0.25f && right.back() == 0.5f, "null render leaves buffers untouched");

    auto* first = create();
    auto* second = create();
    wonderswan_generate(first, nullptr, right.data(), maximum);
    wonderswan_generate(first, left.data(), nullptr, maximum);
    wonderswan_generate(first, nullptr, nullptr, maximum);
    wonderswan_generate(first, left.data(), right.data(), 0);
    for (std::size_t i = 0; i < left.size(); ++i)
        check(left[i] == 0.25f && right[i] == 0.5f, "null/empty render leaves all samples untouched");

    wonderswan_write_memory(first, 0, 0x1234);
    wonderswan_write_memory(first, 0x3fff, 0x5678);
    for (uint32_t address : {0x4000u, 0x10000u, maximum}) {
        wonderswan_write_memory(first, address, maximum);
        check(wonderswan_read_memory(first, address) == 0, "out-of-range RAM read returns zero");
    }
    check(wonderswan_read_memory(first, 0) == 0x34, "RAM byte truncation at lower boundary");
    check(wonderswan_read_memory(first, 0x3fff) == 0x78, "RAM byte truncation at upper boundary");
    check(wonderswan_read_memory(second, 0) == 0, "RAM does not leak between instances");
    for (uint32_t address : {0u, 0x7fu, 0xa0u, maximum}) {
        wonderswan_write(first, address, maximum);
        check(wonderswan_read(first, address) == 0, "out-of-range register read returns zero");
    }
    wonderswan_write(first, 0x80, maximum);
    wonderswan_write(first, 0x81, maximum);
    check(wonderswan_read(first, 0x80) == 255 && wonderswan_read(first, 0x81) == 7,
          "C ABI register bytes and frequency mask");
    wonderswan_write(first, 0x8f, maximum);
    check(wonderswan_read(first, 0x8f) == 255, "C ABI register byte truncation");
    wonderswan_write(first, 0x91, maximum);
    check(wonderswan_read(first, 0x91) == 0x8f, "headphone bit read-only and output control mask");
    wonderswan_mute(first, 4, 1);
    wonderswan_mute(first, maximum, 1);

    wonderswan_reset(first);
    wave(first, 0xff, 0xf0);
    constexpr float guard = -123.5f;
    std::array<float, 130> guardedLeft{}, guardedRight{};
    guardedLeft.fill(guard);
    guardedRight.fill(guard);
    wonderswan_generate(first, guardedLeft.data() + 1, guardedRight.data() + 1, 128);
    check(guardedLeft.front() == guard && guardedLeft.back() == guard &&
          guardedRight.front() == guard && guardedRight.back() == guard,
          "render writes exactly requested buffer range");
    for (std::size_t i = 1; i <= 128; ++i) {
        check(std::isfinite(guardedLeft[i]) && std::isfinite(guardedRight[i]), "render samples finite");
        check(guardedRight[i] == 0, "left-only channel does not reach right output");
        check(guardedLeft[i] == (i == 1 ? 0 : 225.0f / 1024.0f), "native 24kHz first-tick waveform values");
    }
    wonderswan_generate(second, left.data(), right.data(), 128);
    expectSilence(left, right);
    wave(second, 0x88, 0x0f);
    wonderswan_generate(second, left.data(), right.data(), 128);
    for (std::size_t i = 0; i < left.size(); ++i)
        check(left[i] == 0 && right[i] == (i == 0 ? 0 : 120.0f / 1024.0f),
              "independent instance phase, RAM and stereo state");

    wonderswan_mute(first, 0, 1);
    wonderswan_write_memory(first, 0x3fff, 0xff);
    wonderswan_reset(first);
    check(wonderswan_read_memory(first, 0) == 0 && wonderswan_read_memory(first, 0x3fff) == 0,
          "cold reset clears wave RAM");
    for (uint32_t address = 0x80; address <= 0x9f; ++address)
        check(wonderswan_read(first, address) == (address == 0x91 ? 0x80u : 0u),
              "cold reset clears registers except connected headphones");
    wonderswan_generate(first, left.data(), right.data(), 128);
    expectSilence(left, right);
    wave(first, 0xff, 0xf0);
    wonderswan_generate(first, left.data(), right.data(), 128);
    check(left[0] == 0 && left[1] == 225.0f / 1024.0f, "cold reset restores initial phase and clears monitor mute");

    constexpr unsigned blocks = 2048;
    trackedAllocations = 0;
    trackAllocations = true;
    void* allocationProbe = ::operator new(1);
    ::operator delete(allocationProbe);
    trackAllocations = false;
    check(trackedAllocations == 1, "C++ allocation counter positive control");
    trackedAllocations = 0;
    trackAllocations = true;
    for (unsigned block = 0; block < blocks; ++block) {
        wonderswan_write(first, 0x80, block & 255);
        wonderswan_write(first, 0x81, (block >> 8) & 7);
        wonderswan_write(first, 0x88, block & 255);
        wonderswan_write(first, 0x8c, block & 255);
        wonderswan_write(first, 0x8d, block & 31);
        wonderswan_write(first, 0x8e, block & 31);
        wonderswan_write(first, 0x90, (block & 1) ? 0xcf : 0xef);
        wonderswan_write(first, 0x94, block & 15);
        wonderswan_write_memory(first, block & 0x3fff, block & 255);
        wonderswan_mute(first, 0, block & 1);
        wonderswan_generate(first, left.data(), right.data(), 128);
        (void)wonderswan_read(first, 0x92);
        (void)wonderswan_read_memory(first, block & 0x3fff);
    }
    trackAllocations = false;
    check(trackedAllocations == 0, "render, register/RAM changes and monitor mute perform no C++ new allocations");
    wonderswan_destroy(first);
    wonderswan_generate(second, left.data(), right.data(), 128);
    for (std::size_t i = 0; i < left.size(); ++i)
        check(left[i] == 0 && right[i] == 120.0f / 1024.0f, "destroying one instance preserves another");
    wonderswan_destroy(second);

    std::printf("{\"status\":\"pass\",\"checks\":%u,\"renderBlocks\":%u,"
                "\"trackedCppNewAllocations\":%zu,\"directMallocTracked\":false}\n",
                checks, blocks, trackedAllocations);
    return 0;
}
