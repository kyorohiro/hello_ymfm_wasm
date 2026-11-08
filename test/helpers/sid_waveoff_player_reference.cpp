// SPDX-License-Identifier: BSD-3-Clause
// Independent native capture of the bounded C++ PSID host. Original fixture
// payload only; no PSID parser, WASM, firmware or external reference is linked.
#ifndef SID_WAVEOFF_PLAYER_HEADER
#define SID_WAVEOFF_PLAYER_HEADER "../../tetorica_src/wasm/sid_player_core.h"
#endif
#include SID_WAVEOFF_PLAYER_HEADER
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {
unsigned number(const char* input, unsigned maximum) {
    const std::string text(input);
    if (text.empty()) throw std::runtime_error("Missing decimal argument");
    uint64_t value = 0;
    for (unsigned char ch : text) {
        if (ch < '0' || ch > '9') throw std::runtime_error("Expected an unsigned decimal argument");
        const unsigned digit = ch - '0';
        if (digit > maximum || value > (maximum - digit) / 10) throw std::runtime_error("Argument exceeds bound");
        value = value * 10 + digit;
    }
    return static_cast<unsigned>(value);
}
void check(bool value, const char* message) {if (!value) throw std::runtime_error(message);}
}

int main(int argc, char** argv) {
    try {
        check(argc == 9, "Usage: sid-waveoff-player PAYLOAD RATE LOAD INIT PLAY SUBTUNE_ZERO FRAMES CHUNK");
        const unsigned rate = number(argv[2], 96000), load = number(argv[3], 65535), init = number(argv[4], 65535),
            play = number(argv[5], 65535), subtune = number(argv[6], 255), frames = number(argv[7], 96000 * 2), chunk = number(argv[8], 4096);
        check(rate >= 8000 && chunk > 0 && frames > 0, "Invalid rate, frames or chunk");
        std::ifstream input(argv[1], std::ios::binary | std::ios::ate);
        check(static_cast<bool>(input), "Payload could not open");
        const auto length = input.tellg();check(length > 0 && length <= 65536, "Payload exceeds 64 KiB");
        const auto core = std::make_unique<tetorica::SidPlayerCore>(rate);
        input.seekg(0);input.read(reinterpret_cast<char*>(core->input()), length);check(static_cast<bool>(input), "Payload could not read");
        check(core->load(static_cast<unsigned>(length), load, init, play, subtune), core->error());
        static_assert(sizeof(float) == 4 && std::numeric_limits<float>::is_iec559, "Expected IEEE Float32 output");
        const uint16_t endian = 1;check(*reinterpret_cast<const unsigned char*>(&endian) == 1, "Capture requires little endian");
#ifdef _WIN32
        check(_setmode(_fileno(stdout), _O_BINARY) != -1, "Could not set Float32 output mode");
#endif
        for (unsigned offset = 0; offset < frames;) {
            const unsigned count = std::min(chunk, frames - offset);check(core->render(count), core->error());
            std::cout.write(reinterpret_cast<const char*>(core->output()), count * sizeof(float));
            check(static_cast<bool>(std::cout), "Float32 output failed");offset += count;
        }
        std::cout.flush();check(static_cast<bool>(std::cout), "Float32 output flush failed");
        std::cerr << "{\"sampleRate\":" << rate << ",\"frames\":" << frames << ",\"state\":{\"cycles\":" << core->cycles()
            << ",\"initCycles\":" << core->initCycles() << ",\"playCalls\":" << core->playCalls() << ",\"skippedVbis\":" << core->skippedVbis() << ",\"registers\":[";
        for (unsigned reg = 0; reg < 32; ++reg) std::cerr << (reg ? "," : "") << core->reg(reg);
        std::cerr << "],\"voices\":[";
        for (unsigned voice = 0; voice < 3; ++voice) std::cerr << (voice ? "," : "") << "{\"envelope\":" << core->envelope(voice) << ",\"phase\":" << core->phase(voice) << "}";
        std::cerr << "]},\"trace\":{\"writes\":[";
        for (unsigned index = 0; index < core->traceCount(); ++index) {
            const auto& value = core->trace()[index];
            const uint64_t cycle = uint64_t(value.cycleLow) | uint64_t(value.cycleHigh) << 32;
            std::cerr << (index ? "," : "") << "{\"cycle\":" << cycle << ",\"register\":" << value.reg << ",\"value\":" << value.value << "}";
        }
        std::cerr << "],\"dropped\":" << core->droppedTrace() << "}}\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "{\"error\":\"";
        for (unsigned char ch : std::string(error.what())) {
            if (ch == '"' || ch == '\\') std::cerr << '\\';
            if (ch >= 32 && ch <= 126) std::cerr << ch;
        }
        std::cerr << "\"}\n";return 1;
    }
}
