// SPDX-License-Identifier: BSD-3-Clause
// Raw standalone WonderSwan headphone core: four 32-sample 4-bit wave channels,
// channel-2 voice PCM, channel-3 sweep and channel-4 noise. No device is owned.
//
// Addresses are absolute byte I/O 0x80..0x9f and owned RAM 0x0000..0x3fff.
// generate() writes planar, unipolar float PCM with the original /1024 gain.
// No centering, output filter, normalization or interpolation is applied.
// See vendor/mame-wonderswan/README.md for the retained hardware differences.
#pragma once

// Resolve the original header within this source SDK without exporting a broad
// vendor include directory or copying declarations into a second public header.
#include "../../../vendor/mame-wonderswan/wonderswan.h"

namespace tetorica {
using WonderSwan = ::WonderSwan;
}
