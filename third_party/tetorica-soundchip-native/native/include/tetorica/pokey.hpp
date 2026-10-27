// SPDX-License-Identifier: BSD-3-Clause
// Standalone audio-only Atari POKEY. Four channels, one mono output duplicated
// to both planar float buffers. Use two independent objects for dual POKEY;
// output mixing and routing belong to the caller, not a global chip selector.
//
// Registers are offsets 0x00..0x0f. Reads use the hardware read-register map;
// they do not return a shadow of the write-only audio registers.
// Raw output retains the upstream legacy linear scale and DC component.
// No board output circuit, normalization or automatic stereo pan is applied.
// See vendor/libvgm-pokey/README.md for source provenance and omitted I/O.
#pragma once

#include "../../../vendor/libvgm-pokey/pokey.h"

namespace tetorica {
using Pokey = ::Pokey;
}
