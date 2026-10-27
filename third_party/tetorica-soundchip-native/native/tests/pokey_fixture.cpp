// SPDX-License-Identifier: BSD-3-Clause
// Raw POKEY core and dual-instance isolation checks; no machine, ROM or device.
// The CLI emits little-endian interleaved float32 PCM and byte I/O reads.
#include <tetorica/pokey.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <limits>
#include <memory>
#include <new>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {
using Core = tetorica::Pokey;
bool auditing = false;
std::size_t allocations = 0;
unsigned checks = 0;
void* allocate(std::size_t count) {
    if (auditing) ++allocations;
    if (void* pointer = std::malloc(count ? count : 1)) return pointer;
    throw std::bad_alloc();
}
void check(bool condition, const char* description) {
    ++checks;
    if (!condition) throw std::runtime_error(description);
}
struct Pcm { std::vector<float> left, right; };
Pcm render(Core& chip, unsigned frames, const std::vector<unsigned>& blocks = {128}) {
    Pcm result{std::vector<float>(frames), std::vector<float>(frames)};
    unsigned at = 0, block = 0;
    while (at < frames) {
        const unsigned count = std::min(blocks[block++ % blocks.size()], frames - at);
        check(count > 0, "positive render partition");
        chip.generate(result.left.data() + at, result.right.data() + at, count);
        at += count;
    }
    for (unsigned i = 0; i < frames; ++i) {
        check(std::isfinite(result.left[i]) && result.left[i] >= 0 && result.left[i] <= 4,
              "finite bounded positive raw PCM");
        check(result.left[i] == result.right[i], "one physical POKEY is mono");
    }
    return result;
}
void exact(const Pcm& actual, const Pcm& expected, const char* label) {
    check(actual.left == expected.left && actual.right == expected.right, label);
}
bool audible(const Pcm& pcm) {
    const auto bounds = std::minmax_element(pcm.left.begin(), pcm.left.end());
    return bounds.first != pcm.left.end() && *bounds.second - *bounds.first > 0.001f;
}
void configure(Core& chip, unsigned seed = 0) {
    chip.writeRegister(15, 3); // SKCTL: release the sound/random reset.
    chip.writeRegister(8, 0);  // 64 kHz clock, independent eight-bit channels.
    for (unsigned channel = 0; channel < 4; ++channel) {
        chip.writeRegister(channel * 2, uint8_t(23 + channel * 31 + seed * 7));
        chip.writeRegister(channel * 2 + 1,
            uint8_t((channel & 1 ? 0x80 : 0xa0) | (5 + channel)));
    }
    chip.writeRegister(9, 0); // STIMER: restart dividers after authored settings.
}
void basic() {
    check(!Core::validConfiguration(0, 44100), "zero clock rejected");
    check(!Core::validConfiguration(1789790, 0), "zero output rate rejected");
    check(!Core::validConfiguration(100000001, 48000), "clock arithmetic bound rejected");
    check(!Core::validConfiguration(1789790, 7999) && !Core::validConfiguration(1789790, 384001), "output rate bounds rejected");
    check(Core::validConfiguration(1, 8000) && Core::validConfiguration(100000000, 384000), "configuration endpoints accepted");
    check(Core::validConfiguration(1789790, 44100), "default configuration valid");
    Core chip;
    const auto cold = render(chip, 257);
    check(std::all_of(cold.left.begin(), cold.left.end(), [](float value) { return value == 0; }), "cold silence");
    configure(chip);
    check(audible(render(chip, 4093)), "four-channel tones and noise audible");
    // Read addresses are hardware I/O, not an authored AUDF/AUDC mirror.
    chip.writeRegister(0, 0x12);
    check(chip.readRegister(0) != 0x12, "POT input read is not frequency register shadow");
    const uint8_t random = chip.readRegister(10);
    for (unsigned i = 0; i < 32; ++i)
        check(chip.readRegister(10) == random, "repeated synchronous read does not advance sound time");
    std::array<float, 19> left{}, right{};
    left.fill(-1); right.fill(-2);
    chip.generate(nullptr, right.data(), 17); chip.generate(left.data(), nullptr, 17);
    chip.generate(left.data(), right.data(), 0);
    check(left.front() == -1 && right.back() == -2, "null and empty render leave output untouched");
    chip.generate(left.data() + 1, right.data() + 1, 17);
    check(left.front() == -1 && left.back() == -1 && right.front() == -2 && right.back() == -2,
          "both output buffer guards retained");
    Core untouched;
    configure(untouched);
    Core invalid;
    configure(invalid);
    invalid.writeRegister(16, 0xff); invalid.writeRegister(UINT32_MAX, 0xff);
    invalid.mute(4, true); invalid.mute(UINT32_MAX, true);
    check(invalid.readRegister(16) == 0xff && invalid.readRegister(UINT32_MAX) == 0xff, "invalid I/O reads return open bus");
    exact(render(invalid, 4093), render(untouched, 4093), "out-of-range controls are no-ops");
    chip.reset();
    Core fresh;
    exact(render(chip, 1021), render(fresh, 1021), "cold reset clears active sound and cached output");
}

void gainAndMute() {
    for (unsigned level : {1u, 5u, 15u}) {
        Core chip;
        chip.writeRegister(1, uint8_t(0x10 | level));
        const auto pcm = render(chip, 19);
        const float expected = float(level * 744) / 32768;
        for (float value : pcm.left) check(value == expected, "volume-only raw gain is 744/32768 per step");
    }
    Core clipped;
    for (unsigned channel = 0; channel < 4; ++channel) clipped.writeRegister(channel * 2 + 1, 0x1f);
    const auto dc = render(clipped, 17);
    for (float value : dc.left) check(value == 32767.0f / 32768, "raw legacy four-channel sum retains upstream clamp");
    Core muted, reference;
    configure(muted, 3); configure(reference, 3);
    render(muted, 53); render(reference, 53);
    for (unsigned channel = 0; channel < 4; ++channel) muted.mute(channel, true);
    const auto silence = render(muted, 733);
    check(std::all_of(silence.left.begin(), silence.left.end(), [](float value) { return value == 0; }), "monitor mute suppresses held and new output immediately");
    render(reference, 733);
    for (unsigned channel = 0; channel < 4; ++channel) muted.mute(channel, false);
    exact(render(muted, 433), render(reference, 433), "monitor mute preserves counter and polynomial advancement");
}

void resetAndPartitions() {
    for (unsigned rate : {44100u, 48000u, 96000u})
        for (unsigned clock : {1789790u, 1789773u, 1773447u})
            for (unsigned mode : {0u, 0x80u, 0x40u, 0x20u, 0x10u, 0x08u, 0x04u, 0x02u, 0x01u, 0xffu}) {
                Core whole(clock, rate), split(clock, rate);
                configure(whole, mode & 3); configure(split, mode & 3);
                whole.writeRegister(8, uint8_t(mode)); split.writeRegister(8, uint8_t(mode));
                whole.writeRegister(9, 0); split.writeRegister(9, 0);
                const auto expected = render(whole, 4093, {4093});
                exact(render(split, 4093, {1, 7, 128, 509, 3}), expected, "exact render partition continuation");
                for (unsigned address = 0; address < 16; ++address)
                    check(whole.readRegister(address) == split.readRegister(address), "read I/O matches after partitioned render");
                whole.reset(); split.reset();
                configure(whole, mode & 3); configure(split, mode & 3);
                whole.writeRegister(8, uint8_t(mode)); split.writeRegister(8, uint8_t(mode));
                whole.writeRegister(9, 0); split.writeRegister(9, 0);
                exact(render(whole, 4093), expected, "cold reset replays PCM exactly");
                exact(render(split, 4093, {97, 256, 11}), expected, "reset and alternate partition replay");
            }
}

void dualInstances() {
    constexpr unsigned RATE = 48000;
    std::unique_ptr<Core> first(new Core(1789790, RATE));
    Core second(1773447, RATE), firstReference(1789790, RATE), secondReference(1773447, RATE);
    configure(*first, 1); configure(firstReference, 1);
    configure(second, 7); configure(secondReference, 7);
    for (unsigned block = 0; block < 37; ++block) {
        const unsigned count = 1 + block * 13 % 251;
        const unsigned channel = block % 4;
        const uint8_t divisor = uint8_t(19 + block * 7);
        first->writeRegister(channel * 2, divisor); firstReference.writeRegister(channel * 2, divisor);
        exact(render(*first, count), render(firstReference, count), "dual A interleaving matches isolated reference");
        const uint8_t distortion = uint8_t(((block & 7) << 5) | (3 + block % 12));
        second.writeRegister(channel * 2 + 1, distortion); secondReference.writeRegister(channel * 2 + 1, distortion);
        exact(render(second, count + 9), render(secondReference, count + 9), "dual B independent clock/noise continuation");
    }
    // A's monitor changes, cold reset and lifetime cannot alter B's counters,
    // polynomial state, sample-rate remainder or reads.
    for (unsigned operation = 0; operation < 4; ++operation) {
        if (operation == 0) for (unsigned channel = 0; channel < 4; ++channel) first->mute(channel, true);
        if (operation == 1) first->reset();
        if (operation == 2) first.reset();
        if (operation == 3) first.reset(new Core(1000000, 96000));
        if (first) { configure(*first, operation); render(*first, 731 + operation); }
        exact(render(second, 1021), render(secondReference, 1021), "mute/reset/destroy/recreate A preserves B");
        for (unsigned address = 0; address < 16; ++address)
            check(second.readRegister(address) == secondReference.readRegister(address), "B I/O unchanged by A lifecycle");
    }
    // A host can mix either stereo routes or both chips to centered mono;
    // routing has no place in the four-channel core register model.
    Core left(1789790, RATE), right(1789790, RATE);
    configure(left, 1); configure(right, 5);
    const auto a = render(left, 997), b = render(right, 997);
    check(a.left != b.left, "two separately authored chips have distinct signals");
    for (unsigned i = 0; i < a.left.size(); ++i) {
        const float mono = (a.left[i] + b.left[i]) * 0.5f;
        check(std::isfinite(mono), "explicit centered dual mix is finite");
    }
}

void hotPaths() {
    Core chip;
    configure(chip);
    std::array<float, 128> left{}, right{};
    chip.generate(left.data(), right.data(), unsigned(left.size()));
    allocations = 0; auditing = true;
    void* probe = ::operator new(1); ::operator delete(probe);
    auditing = false;
    check(allocations == 1, "C++ allocation audit positive control");
    allocations = 0; auditing = true;
    for (unsigned i = 0; i < 2048; ++i) {
        chip.writeRegister((i & 3) * 2, uint8_t(i));
        chip.writeRegister((i & 3) * 2 + 1, uint8_t(0xa0 | (i & 15)));
        chip.mute(i & 3, (i & 4) != 0);
        (void)chip.readRegister(10);
        chip.generate(left.data(), right.data(), unsigned(left.size()));
    }
    auditing = false;
    check(allocations == 0, "2048 hot render/control blocks allocate no C++ memory");
}

unsigned number(const char* text) {
    if (!text || !*text || *text == '-') throw std::runtime_error("Expected an unsigned decimal number");
    char* end = nullptr;
    const unsigned long long value = std::strtoull(text, &end, 10);
    if (*end || value > UINT32_MAX) throw std::runtime_error("Unsigned number is out of range");
    return unsigned(value);
}
void byte(unsigned value) { if (std::fputc(int(value & 255), stdout) == EOF) throw std::runtime_error("Output write failed"); }
void sample(float value) {
    static_assert(sizeof(float) == sizeof(uint32_t), "Fixture requires IEEE float32 storage");
    uint32_t bits; std::memcpy(&bits, &value, sizeof(bits));
    for (unsigned shift = 0; shift < 32; shift += 8) byte(bits >> shift);
}
int cli(int argc, char** argv) {
    const bool dual = argc == 5 && std::string(argv[1]) == "--dual";
    if (!dual && argc != 3) throw std::runtime_error("Usage: tetorica_pokey_fixture CLOCK RATE | --dual CLOCK_A CLOCK_B RATE | --self-test");
    const unsigned clock = number(argv[dual ? 2 : 1]), rate = number(argv[dual ? 4 : 2]);
    const unsigned secondClock = dual ? number(argv[3]) : clock;
    if (!Core::validConfiguration(clock, rate) || !Core::validConfiguration(secondClock, rate))
        throw std::runtime_error("Invalid chip clock or output rate");
    std::unique_ptr<Core> chips[2] = {std::unique_ptr<Core>(new Core(clock, rate)),
        dual ? std::unique_ptr<Core>(new Core(secondClock, rate)) : nullptr};
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    std::string line;
    std::array<float, 4096> left{}, right{};
    while (std::getline(std::cin, line)) {
        std::istringstream input(line);
        char command; if (!(input >> command)) continue;
        unsigned index = 0, a = 0, b = 0;
        if (dual && (!(input >> index) || index > 1)) throw std::runtime_error("Expected chip index 0 or 1");
        Core& chip = *chips[index];
        if (command == 'r') chip.reset();
        else if (command == 'w' || command == 'u') {
            if (!(input >> a >> b)) throw std::runtime_error("Expected two operands");
            if (command == 'w') chip.writeRegister(a, uint8_t(b)); else chip.mute(a, b != 0);
        } else if (command == 'q') {
            if (!(input >> a)) throw std::runtime_error("Expected read address");
            byte(chip.readRegister(a));
        } else if (command == 'g') {
            if (!(input >> a) || a > 10000000) throw std::runtime_error("Render frame count exceeds fixture limit");
            while (a) {
                const unsigned count = std::min(a, unsigned(left.size()));
                chip.generate(left.data(), right.data(), count);
                for (unsigned i = 0; i < count; ++i) { sample(left[i]); sample(right[i]); }
                a -= count;
            }
        } else throw std::runtime_error("Unknown fixture operation");
        std::string extra; if (input >> extra) throw std::runtime_error("Unexpected fixture operand");
    }
    if (std::fflush(stdout)) throw std::runtime_error("Output flush failed");
    return 0;
}
}

void* operator new(std::size_t n) { return allocate(n); }
void* operator new[](std::size_t n) { return allocate(n); }
void operator delete(void* p) noexcept { std::free(p); }
void operator delete[](void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }
void operator delete[](void* p, std::size_t) noexcept { std::free(p); }

int main(int argc, char** argv) {
    try {
        if (argc == 2 && std::string(argv[1]) == "--self-test") {
            basic(); gainAndMute(); resetAndPartitions(); dualInstances(); hotPaths();
            std::printf("{\"status\":\"pass\",\"checks\":%u,\"renderBlocks\":2048,\"trackedCppNewAllocations\":%zu,\"directMallocTracked\":false}\n", checks, allocations);
            return 0;
        }
        return cli(argc, argv);
    } catch (const std::exception& error) {
        auditing = false;
        std::fprintf(stderr, "POKEY fixture failed: %s\n", error.what()); return 1;
    }
}
