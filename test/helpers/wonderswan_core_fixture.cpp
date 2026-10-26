// license:BSD-3-Clause
// copyright-holders:kyorohiro
// Small text-command runner used by check_wonderswan_core.mjs. PCM is binary
// interleaved native float32; register and memory reads append individual bytes.
#include "wonderswan.h"
#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

int main(int argc, char** argv) {
    if (argc != 3) return 2;
    const auto clock = uint32_t(std::strtoul(argv[1], nullptr, 10));
    const auto rate = uint32_t(std::strtoul(argv[2], nullptr, 10));
    if (!WonderSwan::validConfiguration(clock, rate)) return 2;
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    WonderSwan chip(clock, rate);
    std::vector<float> left(1024), right(1024), interleaved(2048);
    std::string operation;
    while (std::cin >> operation) {
        uint32_t a, b;
        if (operation == "w" || operation == "m" || operation == "u") {
            if (!(std::cin >> a >> b)) return 2;
            if (operation == "w") chip.writeRegister(a, uint8_t(b));
            if (operation == "m") chip.writeMemory(a, uint8_t(b));
            if (operation == "u") chip.mute(a, b != 0);
        } else if (operation == "r") {
            chip.reset();
        } else if (operation == "q" || operation == "p") {
            if (!(std::cin >> a)) return 2;
            const char byte = operation == "q" ? chip.readRegister(a) : chip.readMemory(a);
            std::cout.write(&byte, 1);
        } else if (operation == "g") {
            if (!(std::cin >> a) || a > 0x1000000) return 2;
            while (a) {
                const auto frames = std::min(a, uint32_t(left.size()));
                chip.generate(left.data(), right.data(), frames);
                for (uint32_t i = 0; i < frames; ++i) {
                    interleaved[i * 2] = left[i];
                    interleaved[i * 2 + 1] = right[i];
                }
                std::cout.write(reinterpret_cast<const char*>(interleaved.data()), frames * 8);
                a -= frames;
            }
        } else return 2;
    }
    return std::cin.eof() && std::cout.good() ? 0 : 2;
}
