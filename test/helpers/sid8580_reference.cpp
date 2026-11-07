// SPDX-License-Identifier: BSD-3-Clause
// Separate GPL-2.0-or-later executable when linked with pinned libresidfp.
// No PSID parser, C64 CPU, firmware, application code or audio device is used.
// stdin: SID8PROBE 1 RATE MODEL, then w REG BYTE / r REG / c CYCLES / reset.
// w/r act at the current completed-tick boundary and consume no implicit ticks.
// c advances exactly the requested ticks. reset restarts the SID/resampler,
// while total cycles and the concatenated output remain monotonic.
// stdout: signed PCM16 little endian; stderr: one final JSON metadata object.
#include <residfp/residfp.h>
#include <array>
#include <cstdint>
#include <iomanip>
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
constexpr uint64_t clockHz = 985248;
constexpr uint64_t maximumCycles = 60 * clockHz;
constexpr size_t maximumInputBytes = 1024 * 1024;
void check(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
uint64_t integer(const std::string& text, uint64_t maximum) {
    check(!text.empty(), "Missing unsigned decimal integer");
    uint64_t result = 0;
    for (const unsigned char ch : text) {
        check(ch >= '0' && ch <= '9', "Expected unsigned decimal integer");
        const unsigned digit = ch - '0';
        check(digit <= maximum && result <= (maximum - digit) / 10, "Integer exceeds protocol limit");
        result = result * 10 + digit;
    }
    return result;
}
bool line(std::string& text, size_t& inputBytes) {
    text.clear(); char ch;
    while (std::cin.get(ch)) {
        check(++inputBytes <= maximumInputBytes, "Input exceeds one MiB");
        if (ch == '\n') return true;
        const unsigned char byte = static_cast<unsigned char>(ch);
        check((byte >= 32 && byte <= 126) || ch == '\r' || ch == '\t', "Protocol must be ASCII text");
        check(text.size() < 128, "Protocol line exceeds 128 bytes");
        text.push_back(ch);
    }
    check(!std::cin.bad(), "Could not read protocol input");
    return !text.empty();
}
enum class Kind { Write, Read, Clock, Reset };
struct Command { Kind kind; uint64_t first = 0, second = 0; };
struct Read { uint64_t cycle, epochCycle, epoch; unsigned reg, value; };
}

int main(int argc, char**) {
    try {
        check(argc == 1, "SID8PROBE takes its complete protocol on stdin");
        static_assert(sizeof(short) == 2 && std::numeric_limits<short>::is_signed, "PCM16 short required");
        size_t inputBytes = 0; std::string text, magic, version, rateText, modelText, extra;
        check(line(text, inputBytes), "Missing SID8PROBE header");
        std::istringstream header(text);
        check(static_cast<bool>(header >> magic >> version >> rateText >> modelText) && !(header >> extra), "Expected SID8PROBE 1 RATE MODEL");
        check(magic == "SID8PROBE" && version == "1", "Unsupported probe protocol/version");
        const unsigned rate = static_cast<unsigned>(integer(rateText, 96000));
        check(rate == 44100 || rate == 48000 || rate == 96000, "Rate must be 44100, 48000 or 96000");
        const unsigned model = static_cast<unsigned>(integer(modelText, 8580));
        check(model == 6581 || model == 8580, "Model must be 6581 or 8580");
        std::vector<Command> commands;
        uint64_t requestedCycles = 0;
        // Validate the complete bounded stream before constructing a chip or
        // writing PCM, including an invalid final command after valid audio.
        while (line(text, inputBytes)) {
            std::istringstream input(text); std::string operation, first, second;
            check(static_cast<bool>(input >> operation), "Empty command line");
            if (operation == "w") {
                check(static_cast<bool>(input >> first >> second) && !(input >> extra), "Expected w REGISTER BYTE");
                commands.push_back({Kind::Write, integer(first, 31), integer(second, 255)});
            } else if (operation == "r") {
                check(static_cast<bool>(input >> first) && !(input >> extra), "Expected r REGISTER");
                commands.push_back({Kind::Read, integer(first, 31)});
            } else if (operation == "c") {
                check(static_cast<bool>(input >> first) && !(input >> extra), "Expected c CYCLES");
                const auto cycles = integer(first, maximumCycles);
                check(cycles <= maximumCycles - requestedCycles, "Total duration exceeds 60 PAL seconds");
                requestedCycles += cycles; commands.push_back({Kind::Clock, cycles});
            } else if (operation == "reset") {
                check(!(input >> extra), "reset takes no arguments");
                commands.push_back({Kind::Reset});
            } else throw std::runtime_error("Unknown probe command");
        }

        reSIDfp::residfp sid;
        check(sid.setChipModel(model == 6581 ? reSIDfp::MOS6581 : reSIDfp::CSG8580), "Reference model rejected");
        check(sid.setCombinedWaveforms(reSIDfp::AVERAGE), "Reference combined waveform configuration rejected");
        check(sid.setSamplingParameters(clockHz, reSIDfp::DECIMATE, rate), "Reference sampling rejected");
        sid.input(0); sid.reset();
        // Match the previous reference's all-zero reset volume without an
        // extra bus write: reset() itself also clears the floating bus.
        uint64_t cycles = 0, epochCycle = 0, epoch = 0, frames = 0, writeCount = 0;
        std::vector<Read> reads;
        std::array<unsigned char, 16384> output{}; size_t buffered = 0;
        auto flush = [&]() {
            if (buffered) std::cout.write(reinterpret_cast<const char*>(output.data()), static_cast<std::streamsize>(buffered));
            check(static_cast<bool>(std::cout), "Could not write PCM output"); buffered = 0;
        };
#ifdef _WIN32
        check(_setmode(_fileno(stdout), _O_BINARY) != -1, "Could not set stdout to binary mode");
#endif
        for (const auto& command : commands) {
            switch (command.kind) {
            case Kind::Write:
                sid.write(static_cast<int>(command.first), static_cast<unsigned char>(command.second)); ++writeCount;
                break;
            case Kind::Read:
                reads.push_back({cycles, epochCycle, epoch, static_cast<unsigned>(command.first), sid.read(static_cast<int>(command.first))});
                break;
            case Kind::Reset:
                sid.reset(); ++epoch; epochCycle = 0;
                break;
            case Kind::Clock:
                for (uint64_t i = 0; i < command.first; ++i) {
                    short sample[4]{};
                    const int count = sid.clock(1u, sample);
                    check(count >= 0 && count <= 1, "Unexpected reference samples per cycle");
                    ++cycles; ++epochCycle;
                    for (int index = 0; index < count; ++index) {
                        const uint16_t bits = static_cast<uint16_t>(sample[index]);
                        output[buffered++] = static_cast<unsigned char>(bits);
                        output[buffered++] = static_cast<unsigned char>(bits >> 8); ++frames;
                        if (buffered == output.size()) flush();
                    }
                }
                break;
            }
        }
        flush(); std::cout.flush(); check(static_cast<bool>(std::cout), "Could not flush PCM output");
        check(cycles == requestedCycles, "Reference cycle accounting failed");
        const unsigned cyclesPerSample1024 = static_cast<unsigned>(double(clockHz) / rate * 1024.0);
        std::cerr << std::setprecision(17) << "{\"format\":\"SID8PROBE\",\"version\":1,\"model\":" << model
                  << ",\"sampleRate\":" << rate << ",\"clockHz\":" << clockHz
                  << ",\"cycles\":" << cycles << ",\"epochCycles\":" << epochCycle
                  << ",\"resets\":" << epoch << ",\"frames\":" << frames
                  << ",\"writes\":" << writeCount
                  << ",\"pcmFormat\":\"signed16le\",\"sampling\":\"DECIMATE\",\"combinedWaveforms\":\"AVERAGE\""
                  << ",\"cyclesPerSample1024\":" << cyclesPerSample1024
                  << ",\"effectiveSampleRateHz\":" << double(clockHz) * 1024.0 / cyclesPerSample1024
                  << ",\"accessTiming\":\"completed-tick-boundary; accesses consume no clocks\""
                  << ",\"resetPolicy\":\"chip and resampler reset; total cycles/output remain monotonic\""
                  << ",\"reads\":[";
        for (size_t i = 0; i < reads.size(); ++i) std::cerr << (i ? "," : "") << reads[i].value;
        std::cerr << "],\"readEvents\":[";
        for (size_t i = 0; i < reads.size(); ++i) {
            const auto& read = reads[i];
            std::cerr << (i ? "," : "") << "{\"cycle\":" << read.cycle << ",\"epochCycle\":" << read.epochCycle
                      << ",\"epoch\":" << read.epoch << ",\"register\":" << read.reg << ",\"value\":" << read.value << "}";
        }
        std::cerr << "]}\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "{\"error\":\"SID8PROBE rejected input or failed execution\",\"detail\":\"";
        // All fixed diagnostics are ASCII, with no input text interpolated.
        for (const char ch : std::string(error.what())) {
            if (ch == '"' || ch == '\\') std::cerr << '\\';
            if (static_cast<unsigned char>(ch) >= 32 && static_cast<unsigned char>(ch) <= 126) std::cerr << ch;
        }
        std::cerr << "\"}\n"; return 1;
    }
}
