// Self-authored SID host regression fixture. BSD-3-Clause; included chip: zlib.
// Usage: fixture --self-test | fixture SAMPLE_RATE CLOCK_HZ < commands.txt
// Commands: w REGISTER VALUE, a REGISTER (bus read), r FRAMES, reset.
// stdout: little-endian mono float32 PCM. stderr: final state JSON.
#include "../../tetorica_src/wasm/sid_core.h"
#include <algorithm>
#include <cstring>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {
void check(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
unsigned number(const std::string& text, unsigned maximum) {
    check(!text.empty(), "Missing unsigned integer");
    uint64_t value = 0;
    for (const char c : text) {
        check(c >= '0' && c <= '9', "Expected a decimal unsigned integer");
        value = value * 10 + static_cast<unsigned>(c - '0');
        check(value <= maximum, "Integer exceeds the supported range");
    }
    return static_cast<unsigned>(value);
}
void rawWrite(m6581_t& chip, unsigned reg, unsigned value) {
    uint64_t pins = M6581_CS | reg;
    M6581_SET_DATA(pins, value);
    m6581_tick(&chip, pins);
}
void configureTone(tetorica::SidCore& core) {
    for (const auto& command : std::array<std::array<unsigned, 2>, 5>{{
             {{0, 37}}, {{1, 20}}, {{5, 0}}, {{6, 240}}, {{24, 15}}}})
        check(core.write(command[0], command[1]), "Tone setup rejected");
    check(core.write(4, 33), "Gate setup rejected");
}
void selfTest() {
    unsigned clockCases = 0;
    for (const int rate : {8000, 32000, 44100, 48000, 96000}) {
        for (const int clock : {900000, 985248, 1022727, 1100000}) {
            tetorica::SidCore core(rate, clock);
            std::vector<float> samples(rate);
            core.render(samples.data(), 0);
            check(core.cycles() == 0, "Empty render consumed clocks");
            core.render(samples.data(), rate);
            check(core.cycles() == static_cast<unsigned>(clock), "One-second rational clock drift");
            check(std::all_of(samples.begin(), samples.end(), [](float value) { return value == 0; }), "Reset chip must be silent");
            ++clockCases;
        }
    }
    for (const bool reads : {false, true}) {
        tetorica::SidCore reference(48000, 985248), queued(48000, 985248);
        configureTone(reference); configureTone(queued);
        std::vector<float> expected(tetorica::SidCore::queueCapacity), actual(expected.size());
        reference.render(expected.data(), static_cast<unsigned>(expected.size()));
        unsigned accesses = 0;
        while (reads ? queued.read(27) >= 0 : queued.write(31, 0)) ++accesses;
        check(accesses > 4096, "Queue filled before chip clocks produced its samples");
        const auto cycles = queued.cycles();
        const auto registers = queued.registers();
        check(!queued.write(0, 1) && queued.read(28) == -1, "Full queue must reject accesses");
        check(queued.cycles() == cycles && queued.registers() == registers, "Rejected access changed chip state");
        queued.render(actual.data(), static_cast<unsigned>(actual.size()));
        check(expected == actual && reference.cycles() == queued.cycles(), "Register I/O lost or reordered PCM");
        check(*std::max_element(expected.begin(), expected.end()) > 0.01f, "Queue comparison must use sounding PCM");
        reference.render(expected.data(), 127); queued.render(actual.data(), 127);
        check(std::equal(expected.begin(), expected.begin() + 127, actual.begin()), "Queue continuation differs");
        queued.reset(); queued.render(actual.data(), static_cast<unsigned>(actual.size()));
        check(std::all_of(actual.begin(), actual.end(), [](float value) { return value == 0; }), "Reset retained queued sound");
        const auto resetCycles = queued.cycles();
        check(!queued.write(32, 0) && !queued.write(0, 256) && queued.read(32) == -1, "Invalid access accepted");
        check(queued.cycles() == resetCycles, "Invalid access consumed clocks");
    }
    const m6581_desc_t descriptor{985248, 48000, 1};
    for (unsigned source = 0; source < 3; ++source) {
        m6581_t chip{}; m6581_init(&chip, &descriptor);
        for (auto& voice : chip.voice) { voice.ctrl = M6581_CTRL_SAWTOOTH; voice.wav_accum = 0x100000; voice.freq = 100; }
        chip.voice[source].wav_accum = 0x7fffff; chip.voice[source].freq = 1;
        const unsigned target = (source + 1) % 3;
        chip.voice[target].ctrl |= M6581_CTRL_SYNC;
        m6581_tick(&chip, 0);
        check(chip.voice[target].wav_accum == 0, "Sync reset the wrong voice");
        check(chip.voice[(source + 2) % 3].wav_accum == 0x100064, "Sync changed an unconnected voice");
    }
    {
        m6581_t chip{}; m6581_init(&chip, &descriptor);
        for (auto& voice : chip.voice) { voice.ctrl = M6581_CTRL_SAWTOOTH | M6581_CTRL_SYNC; voice.wav_accum = 0x7fffff; voice.freq = 1; }
        m6581_tick(&chip, 0);
        for (const auto& voice : chip.voice) check(voice.wav_accum == 0x800000, "Simultaneous sync chain was not suppressed");
    }
    {
        m6581_t chip{}; m6581_init(&chip, &descriptor);
        chip.voice[0].ctrl = M6581_CTRL_SAWTOOTH; chip.voice[0].wav_accum = 0x7fffff; chip.voice[0].freq = 1;
        chip.voice[1].ctrl = M6581_CTRL_SAWTOOTH | M6581_CTRL_SYNC; chip.voice[1].wav_accum = 0x100000; chip.voice[1].freq = 100;
        rawWrite(chip, 4, M6581_CTRL_SAWTOOTH | M6581_CTRL_TEST);
        check(chip.voice[0].sync && chip.voice[1].wav_accum == 0, "TEST regression did not begin on a rising edge");
        for (unsigned i = 0; i < 100; ++i) m6581_tick(&chip, 0);
        check(!chip.voice[0].sync && chip.voice[1].wav_accum == 10000, "TEST retained a stale sync edge");
    }
    {
        m6581_t chip{}; m6581_init(&chip, &descriptor);
        rawWrite(chip, 0, 255); rawWrite(chip, 1, 255); rawWrite(chip, 5, 0); rawWrite(chip, 6, 255);
        rawWrite(chip, 24, 15); rawWrite(chip, 4, M6581_CTRL_SAWTOOTH | M6581_CTRL_GATE);
        for (unsigned i = 0; i < 1000000; ++i) m6581_tick(&chip, 0);
        check(chip.voice[0].env_cur_level == 255, "Envelope did not reach full sustain");
        rawWrite(chip, 4, M6581_CTRL_SAWTOOTH); rawWrite(chip, 4, M6581_CTRL_SAWTOOTH | M6581_CTRL_GATE);
        for (unsigned i = 0; i < 50000; ++i) {
            m6581_tick(&chip, 0);
            check(chip.voice[0].env_cur_level <= 255, "Retrigger exceeded the 8-bit envelope range");
        }
        check(chip.voice[0].env_cur_level == 0 && chip.voice[0].env_state == M6581_ENV_FROZEN, "Envelope wrap did not freeze at zero");
        rawWrite(chip, 4, M6581_CTRL_SAWTOOTH); rawWrite(chip, 4, M6581_CTRL_SAWTOOTH | M6581_CTRL_GATE);
        for (unsigned i = 0; i < 50000; ++i) m6581_tick(&chip, 0);
        check(chip.voice[0].env_cur_level > 0 && chip.voice[0].env_cur_level <= 255, "Gate cycle did not unlock frozen envelope");
    }
    std::cerr << "SID self-test passed: " << clockCases << " rational-clock cases, I/O queues, reset, sync, TEST and 8-bit retrigger.\n";
}
void writeSamples(const float* samples, unsigned frames) {
    static_assert(sizeof(float) == 4 && std::numeric_limits<float>::is_iec559, "Fixture needs IEEE float32");
    std::array<unsigned char, 4096 * 4> bytes{};
    for (unsigned i = 0; i < frames; ++i) {
        check(std::isfinite(samples[i]), "Nonfinite Native PCM");
        uint32_t bits; std::memcpy(&bits, samples + i, sizeof(bits));
        for (unsigned j = 0; j < 4; ++j) bytes[i * 4 + j] = static_cast<unsigned char>(bits >> (j * 8));
    }
    std::cout.write(reinterpret_cast<const char*>(bytes.data()), frames * 4);
    check(static_cast<bool>(std::cout), "Could not write fixture PCM");
}
}

int main(int argc, char** argv) {
    try {
        if (argc == 2 && std::string(argv[1]) == "--self-test") { selfTest(); return 0; }
        check(argc == 3, "Usage: sid_reference SAMPLE_RATE CLOCK_HZ | --self-test");
        const unsigned rate = number(argv[1], 96000), clock = number(argv[2], 1100000);
        check(rate >= 8000 && clock >= 900000, "Unsupported rate or chip clock");
#ifdef _WIN32
        check(_setmode(_fileno(stdout), _O_BINARY) != -1, "Could not set stdout to binary mode");
#endif
        tetorica::SidCore core(static_cast<int>(rate), static_cast<int>(clock));
        std::array<float, 4096> samples{}; std::vector<int> reads;
        uint64_t totalFrames = 0; std::string line;
        while (std::getline(std::cin, line)) {
            std::istringstream input(line); std::string operation, first, second, extra;
            if (!(input >> operation)) continue;
            if (operation == "w") {
                check(static_cast<bool>(input >> first >> second) && !(input >> extra), "Expected w REGISTER VALUE");
                check(core.write(number(first, 31), number(second, 255)), "Register write rejected");
            } else if (operation == "a") {
                check(static_cast<bool>(input >> first) && !(input >> extra), "Expected a REGISTER");
                const int value = core.read(number(first, 31)); check(value >= 0, "Register read rejected"); reads.push_back(value);
            } else if (operation == "r") {
                check(static_cast<bool>(input >> first) && !(input >> extra), "Expected r FRAMES");
                unsigned frames = number(first, rate * 10);
                totalFrames += frames; check(totalFrames <= uint64_t(rate) * 600, "Fixture exceeds ten minutes");
                while (frames) { const auto count = std::min<unsigned>(frames, samples.size()); core.render(samples.data(), count); writeSamples(samples.data(), count); frames -= count; }
            } else if (operation == "reset") {
                check(!(input >> extra), "reset takes no arguments"); core.reset();
            } else throw std::runtime_error("Unknown fixture command");
        }
        std::cerr << "{\"frames\":" << totalFrames << ",\"cycles\":" << core.cycles() << ",\"registers\":[";
        for (unsigned i = 0; i < 32; ++i) std::cerr << (i ? "," : "") << static_cast<unsigned>(core.registers()[i]);
        std::cerr << "],\"voices\":[";
        for (unsigned i = 0; i < 3; ++i) std::cerr << (i ? "," : "") << "{\"envelope\":" << core.envelope(i) << ",\"phase\":" << core.phase(i) << "}";
        std::cerr << "],\"reads\":[";
        for (unsigned i = 0; i < reads.size(); ++i) std::cerr << (i ? "," : "") << reads[i];
        std::cerr << "]}\n";
        return 0;
    } catch (const std::exception& error) { std::cerr << "SID fixture failed: " << error.what() << '\n'; return 1; }
}
