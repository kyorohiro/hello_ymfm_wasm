// Cycle-addressed SID comparison renderer. BSD-3-Clause; chip: zlib.
// Build with -std=c++17 -O2 -ffp-contract=off. No device, ROM or game data.
// stdin: SIDTRACE 1 RATE CLOCK DURATION_CYCLES CHUNK_FRAMES DC_BLOCK(0|1)
// followed by strictly increasing CYCLE REGISTER VALUE decimal lines.
// stdout: mono IEEE float32 little endian. stderr: one final JSON object.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#define CHIPS_IMPL
#include "../../third_party/chips-m6581/m6581.h"
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {
constexpr uint64_t clockHz = 985248;
constexpr uint64_t maximumDuration = 60 * clockHz;
constexpr size_t maximumInputBytes = 32 * 1024 * 1024;
constexpr size_t maximumWrites = 1000000;
void check(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
uint64_t number(const std::string& text, uint64_t maximum) {
    check(!text.empty(), "Missing decimal integer");
    uint64_t value = 0;
    for (const unsigned char c : text) {
        check(c >= '0' && c <= '9', "Expected a decimal unsigned integer");
        const uint64_t digit = c - '0';
        check(digit <= maximum && value <= (maximum - digit) / 10, "Integer exceeds supported range");
        value = value * 10 + digit;
    }
    return value;
}
// getline() alone can allocate an unbounded hostile line before validation.
bool readLine(std::string& line, size_t& bytes, size_t maximumLine) {
    line.clear(); char c;
    while (std::cin.get(c)) {
        check(++bytes <= maximumInputBytes, "Input exceeds 32 MiB");
        if (c == '\n') return true;
        const unsigned char byte = static_cast<unsigned char>(c);
        check((byte >= 32 && byte <= 126) || c == '\t' || c == '\r', "Protocol must be ASCII text");
        check(line.size() < maximumLine, "Protocol line is too long");
        line.push_back(c);
    }
    check(!std::cin.bad(), "Could not read protocol input");
    return !line.empty();
}
struct Write { uint64_t cycle; unsigned reg, value; };
void writeSamples(const float* samples, unsigned frames) {
    static_assert(sizeof(float) == 4 && std::numeric_limits<float>::is_iec559, "IEEE float32 is required");
    std::array<unsigned char, 8192 * 4> bytes{};
    for (unsigned i = 0; i < frames; ++i) {
        check(std::isfinite(samples[i]), "Nonfinite SID output");
        uint32_t bits; std::memcpy(&bits, samples + i, sizeof(bits));
        for (unsigned byte = 0; byte < 4; ++byte) bytes[i * 4 + byte] = static_cast<unsigned char>(bits >> (byte * 8));
    }
    std::cout.write(reinterpret_cast<const char*>(bytes.data()), frames * 4);
    check(static_cast<bool>(std::cout), "Could not write PCM output");
}
}

int main() {
    try {
        size_t inputBytes = 0; std::string line;
        check(readLine(line, inputBytes, 256), "Missing SIDTRACE header");
        std::istringstream header(line); std::string magic, version, rateText, clockText, durationText, chunkText, dcText, extra;
        check(static_cast<bool>(header >> magic >> version >> rateText >> clockText >> durationText >> chunkText >> dcText)
            && !(header >> extra), "Expected SIDTRACE 1 RATE CLOCK DURATION CHUNK DC_BLOCK");
        check(magic == "SIDTRACE" && version == "1", "Unsupported SIDTRACE format/version");
        const unsigned rate = static_cast<unsigned>(number(rateText, 96000));
        check(rate >= 8000, "Sample rate must be 8000..96000");
        check(number(clockText, clockHz) == clockHz, "Only PAL 985248 Hz is supported");
        const uint64_t duration = number(durationText, maximumDuration);
        check(duration >= 1, "Duration must be 1..60 PAL seconds");
        const unsigned chunkFrames = static_cast<unsigned>(number(chunkText, 8192));
        check(chunkFrames >= 1, "Chunk size must be 1..8192");
        const bool dcBlock = number(dcText, 1) != 0;
        std::vector<Write> writes;
        // Validate the complete bounded stream before producing any PCM. An
        // invalid last event must not leave a misleading partial WAV behind.
        while (readLine(line, inputBytes, 128)) {
            check(writes.size() < maximumWrites, "More than 1000000 writes");
            std::istringstream event(line); std::string cycleText, registerText, valueText;
            check(static_cast<bool>(event >> cycleText >> registerText >> valueText) && !(event >> extra), "Expected CYCLE REGISTER VALUE");
            const uint64_t cycle = number(cycleText, duration - 1);
            check(writes.empty() || cycle > writes.back().cycle, "Write cycles must be strictly increasing");
            writes.push_back({cycle, static_cast<unsigned>(number(registerText, 31)), static_cast<unsigned>(number(valueText, 255))});
        }
#ifdef _WIN32
        check(_setmode(_fileno(stdout), _O_BINARY) != -1, "Could not set stdout binary mode");
#endif
        m6581_t chip{}; const m6581_desc_t desc{static_cast<int>(clockHz), static_cast<int>(rate), 1.0f};
        m6581_init(&chip, &desc);
        std::array<uint8_t, 32> registers{};
        std::array<float, 8192> samples{};
        unsigned buffered = 0; uint64_t frames = 0; size_t nextWrite = 0;
        double previousInput = 0, previousOutput = 0;
        const double pole = std::exp(-2.0 * 3.14159265358979323846 * 12.0 / rate);
        for (uint64_t cycle = 0; cycle < duration; ++cycle) {
            uint64_t pins = 0;
            if (nextWrite < writes.size() && writes[nextWrite].cycle == cycle) {
                const auto& write = writes[nextWrite++];
                pins = M6581_CS | write.reg; M6581_SET_DATA(pins, write.value);
                registers[write.reg] = static_cast<uint8_t>(write.value);
            }
            // m6581_tick advances audio before committing this bus write.
            // Every SAMPLE is consumed here, including those on write cycles.
            if (m6581_tick(&chip, pins) & M6581_SAMPLE) {
                const double input = chip.sample;
                double output = input;
                if (dcBlock) {
                    output = input - previousInput + pole * previousOutput;
                    previousInput = input; previousOutput = output;
                }
                samples[buffered++] = static_cast<float>(output); ++frames;
                if (buffered == chunkFrames) { writeSamples(samples.data(), buffered); buffered = 0; }
            }
        }
        if (buffered) writeSamples(samples.data(), buffered);
        std::cout.flush(); check(static_cast<bool>(std::cout), "Could not flush PCM output");
        check(nextWrite == writes.size() && frames == duration * rate / clockHz, "Cycle/sample accounting failed");
        std::cerr << std::setprecision(17) << "{\"frames\":" << frames << ",\"cycles\":" << duration
                  << ",\"sampleRate\":" << rate << ",\"clockHz\":" << clockHz << ",\"chunkFrames\":" << chunkFrames
                  << ",\"writeCount\":" << writes.size() << ",\"pcmFormat\":\"float32le\",\"channels\":1,\"registers\":[";
        for (unsigned i = 0; i < 32; ++i) std::cerr << (i ? "," : "") << static_cast<unsigned>(registers[i]);
        std::cerr << "],\"envelopes\":[";
        for (unsigned i = 0; i < 3; ++i) std::cerr << (i ? "," : "") << (chip.voice[i].env_cur_level & 255);
        std::cerr << "],\"phases\":[";
        for (unsigned i = 0; i < 3; ++i) std::cerr << (i ? "," : "") << chip.voice[i].wav_accum;
        std::cerr << "],\"dc\":{\"enabled\":" << (dcBlock ? "true" : "false")
                  << ",\"cutoffHz\":12,\"pole\":" << pole << ",\"previousInput\":" << previousInput
                  << ",\"previousOutput\":" << previousOutput << "}}\n";
        return 0;
    } catch (const std::exception& error) { std::cerr << "SID trace renderer failed: " << error.what() << '\n'; return 1; }
}
