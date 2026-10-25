// Same-instance, same-build checkpoints. Serialize fields and memory contents,
// never C++ object storage or pointers. Validate all variable lengths first.
#pragma once
#include <initializer_list>
#include "chip_state.h"
#include "ymfm_wasm_interface.h"

template<class Chip>
std::vector<uint8_t> opn_state_prefix(Chip &chip, ymfm_wasm_interface &intf,
                                    std::initializer_list<uint32_t *> masks)
{
    std::vector<uint8_t> bytes;
    ymfm::ymfm_saved_state state(bytes, true);
    chip.save_restore(state);
    ChipStateIO io{bytes, true};
    io.field(intf.irq_asserted); io.field(intf.timer_remaining);
    for (auto mask : masks) io.field(*mask);
    return bytes;
}

template<class Chip>
uint32_t save_opn_state(Chip &chip, ymfm_wasm_interface &intf,
                       std::initializer_list<uint32_t *> masks,
                       std::initializer_list<std::vector<uint8_t> *> memories, uint8_t *out)
{
    auto prefix = opn_state_prefix(chip, intf, masks);
    uint32_t size = prefix.size();
    if (out) std::memcpy(out, prefix.data(), size);
    for (auto memory : memories) {
        const uint32_t length = memory->size();
        if (out) {
            std::memcpy(out + size, &length, sizeof(length));
            if (length) std::memcpy(out + size + sizeof(length), memory->data(), length);
        }
        size += sizeof(length) + length;
    }
    return size;
}

template<class Chip>
bool load_opn_state(Chip &chip, ymfm_wasm_interface &intf,
                    std::initializer_list<uint32_t *> masks,
                    std::initializer_list<std::vector<uint8_t> *> memories,
                    const uint8_t *data, uint32_t size)
{
    const size_t prefix_size = opn_state_prefix(chip, intf, masks).size();
    if (!data || size < prefix_size) return false;
    size_t offset = prefix_size;
    // First check all lengths, then allocate all copies, before changing state.
    std::vector<std::pair<size_t, uint32_t>> ranges;
    for (auto memory : memories) {
        (void)memory;
        if (size - offset < sizeof(uint32_t)) return false;
        uint32_t length;
        std::memcpy(&length, data + offset, sizeof(length)); offset += sizeof(length);
        if (length > 0x1000000 || length > size - offset) return false;
        ranges.emplace_back(offset, length); offset += length;
    }
    if (offset != size) return false;
    std::vector<std::vector<uint8_t>> copies;
    for (const auto &range : ranges) copies.emplace_back(data + range.first, data + range.first + range.second);
    std::vector<uint8_t> prefix(data, data + prefix_size);
    ymfm::ymfm_saved_state state(prefix, false);
    chip.save_restore(state);
    ChipStateIO io{prefix, false}; io.offset = state.m_offset;
    io.field(intf.irq_asserted); io.field(intf.timer_remaining);
    for (auto mask : masks) io.field(*mask);
    size_t index = 0;
    for (auto memory : memories) memory->swap(copies[index++]);
    return true;
}
