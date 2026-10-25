#pragma once
#include "ymfm_wasm_interface.h"
#include <array>
// RAM pages are owned by Rust control-side Arcs. The audio thread is their
// sole reader/writer; loading and clearing never allocate or release pages.
struct NativeY8950Memory : ymfm_wasm_interface {
    std::array<uint8_t *, 512> pages{};
    uint32_t memory_size = 0;
    uint64_t memory_revision = 0, memory_upload_revision = 0;
    uint8_t ymfm_external_read(ymfm::access_class type, uint32_t address) override {
        return type == ymfm::ACCESS_ADPCM_B && address < memory_size && pages[address / 4096] ? pages[address / 4096][address % 4096] : 0;
    }
    void ymfm_external_write(ymfm::access_class type, uint32_t address, uint8_t value) override {
        if (type == ymfm::ACCESS_ADPCM_B && address < memory_size && pages[address / 4096]) { pages[address / 4096][address % 4096] = value; ++memory_revision; }
    }
    void memory_page(uint32_t index, uint8_t *page) { if (index < pages.size()) pages[index] = page; }
    void memory_length(uint32_t size) { if (size <= 2097152) { memory_size = size; memory_upload_revision = ++memory_revision; } }
};
