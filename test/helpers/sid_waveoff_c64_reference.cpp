// SPDX-License-Identifier: BSD-3-Clause
// Original native observer for the existing C64 host. Link the repository's
// C hardware translation unit and marked SID translation unit unchanged.
#ifndef SID_WAVEOFF_C64_HEADER
#define SID_WAVEOFF_C64_HEADER "../../tetorica_src/wasm/sid_rsid_core.h"
#endif
#include SID_WAVEOFF_C64_HEADER
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
unsigned number(const char* text, unsigned maximum) {
    if (!*text) throw std::runtime_error("Missing numeric argument");uint64_t value = 0;
    for (const unsigned char ch : std::string(text)) {
        if (ch < '0' || ch > '9') throw std::runtime_error("Expected decimal argument");
        const unsigned digit = ch - '0';if (digit > maximum || value > (maximum - digit) / 10) throw std::runtime_error("Argument exceeds bound");value = value * 10 + digit;
    }
    return unsigned(value);
}
void check(bool value, const char* message) {if (!value) throw std::runtime_error(message);}
}
int main(int argc, char** argv) {
    try {
        check(argc >= 11, "Usage: sid-waveoff-c64 PAYLOAD RATE MODE LOAD INIT PLAY SONG_ZERO DRIVER_PAGE FRAMES CHUNK [RAM...]");
        const unsigned rate = number(argv[2], 96000), mode = number(argv[3], 2), load = number(argv[4], 65535), init = number(argv[5], 65535),
            play = number(argv[6], 65535), song = number(argv[7], 255), page = number(argv[8], 255), frames = number(argv[9], 192000), chunk = number(argv[10], 4096);
        check(rate >= 8000 && frames && chunk, "Invalid rate/frame/chunk bounds");
        std::ifstream input(argv[1], std::ios::binary | std::ios::ate);check(bool(input), "Payload could not open");
        const auto length = input.tellg();check(length > 0 && length <= 65536, "Payload exceeds64KiB");
        const auto core = std::make_unique<tetorica::SidRsidCore>(rate);input.seekg(0);input.read(reinterpret_cast<char*>(core->input()), length);check(bool(input), "Payload could not read");
        const bool loaded = mode == 0 ? core->load(unsigned(length), load, init, song, 0, 0)
            : mode == 1 ? core->loadPsid(unsigned(length), load, init, play, song, 0, page)
              : core->loadPsidVbi(unsigned(length), load, init, play, song, 0, page);
        check(loaded, core->error());
        static_assert(sizeof(float) == 4 && std::numeric_limits<float>::is_iec559, "Expected Float32 PCM");
        const uint16_t endian = 1;check(*reinterpret_cast<const uint8_t*>(&endian) == 1, "Capture requires little-endian Float32");
#ifdef _WIN32
        check(_setmode(_fileno(stdout), _O_BINARY) != -1, "Binary stdout unavailable");
#endif
        for (unsigned offset = 0; offset < frames;) {
            const unsigned count = std::min(chunk, frames - offset);check(core->render(count), core->error());
            std::cout.write(reinterpret_cast<const char*>(core->output()), count * sizeof(float));check(bool(std::cout), "PCM output failed");offset += count;
        }
        std::cout.flush();check(bool(std::cout), "PCM flush failed");
        std::cerr << "{\"sampleRate\":" << rate << ",\"frames\":" << frames << ",\"state\":{\"cycles\":" << core->cycles()
            << ",\"initCycles\":" << core->initCycles() << ",\"bootCycles\":" << core->bootCycles()
            << ",\"initReturned\":" << (core->initReturned() ? "true" : "false") << ",\"initPending\":" << (core->initPending() ? "true" : "false")
            << ",\"initCycleLimit\":" << core->initLimit() << ",\"initReturnCycle\":" << core->initReturnCycle()
            << ",\"irqCount\":" << core->irqCount() << ",\"nmiCount\":" << core->nmiCount() << ",\"playCalls\":" << core->playCalls()
            << ",\"driverAddress\":" << core->driverAddress() << ",\"readCount\":" << core->readCount() << ",\"writeCount\":" << core->writeCount() << ",\"pc\":" << core->pc() << ",\"registers\":[";
        for (unsigned r = 0; r < 32; r++) std::cerr << (r ? "," : "") << core->reg(r);
        std::cerr << "],\"voices\":[";
        for (unsigned v = 0; v < 3; v++) std::cerr << (v ? "," : "") << "{\"envelope\":" << core->envelope(v) << ",\"phase\":" << core->phase(v) << "}";
        std::cerr << "]},\"trace\":{\"writes\":[";
        for (unsigned i = 0; i < core->traceCount(); i++) {
            const auto& entry = core->trace()[i];const uint64_t cycle = uint64_t(entry.cycleLow) | uint64_t(entry.cycleHigh) << 32;
            std::cerr << (i ? "," : "") << "{\"cycle\":" << cycle << ",\"register\":" << entry.reg << ",\"value\":" << entry.value << "}";
        }
        std::cerr << "],\"dropped\":" << core->droppedTrace() << "},\"ram\":[";
        for (int i = 11; i < argc; i++) {const auto address = number(argv[i], 65535);std::cerr << (i > 11 ? "," : "") << '[' << address << ',' << core->ramRead(address) << ']';}
        std::cerr << "]}\n";return 0;
    } catch (const std::exception& error) {std::cerr << "Native C64 capture failed: " << error.what() << '\n';return 1;}
}
