// In-process, same-build state encoding. Serialize fields, never object pointers/padding.
#pragma once
#include <vector>
#include <cstdint>
#include <cstring>
struct ChipStateIO {
    std::vector<uint8_t> &bytes; bool saving; size_t offset = 0;
    template<class T> void field(T &value) {
        if (saving) { const auto *p = reinterpret_cast<const uint8_t *>(&value); bytes.insert(bytes.end(), p, p + sizeof(T)); }
        else { std::memcpy(&value, bytes.data() + offset, sizeof(T)); offset += sizeof(T); }
    }
};
