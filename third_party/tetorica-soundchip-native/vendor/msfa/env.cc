/*
 * Copyright 2012 Google Inc.
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *      http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#include "synth.h"
#include "env.h"

using namespace std;
namespace {
const int kReferenceOutput = 127 * 32;
const int kSilenceFloor = 16 << 16;
}

void Env::init(const int r[4], const int l[4], int32_t ol, int rate_scaling) {
  for (int i = 0; i < 4; i++) {
    rates_[i] = r[i];
    levels_[i] = l[i];
  }
  outlevel_ = ol;
  initial_outlevel_ = ol;
  rate_scaling_ = rate_scaling;
  state_.level = 0;
  reference_.level = 0;
  reference_outlevel_ = kReferenceOutput;
  live_level_ = false;
  down_ = true;
  advance(state_, 0, initial_outlevel_);
  advance(reference_, 0, kReferenceOutput);
}

int32_t Env::getsample() {
  // Always retain upstream's exact path for notes with no effective level edit.
  const int32_t legacy = sample(state_, initial_outlevel_);
  const int32_t reference = sample(reference_, reference_outlevel_);
  if (!live_level_) return legacy;
  if (reference_.ix >= 4 && reference <= kSilenceFloor) return kSilenceFloor;
  const int32_t shifted = reference + (outlevel_ - reference_outlevel_) * 65536;
  return max(kSilenceFloor, shifted);
}

int32_t Env::sample(State &state, int outlevel) {
  if (state.ix < 3 || (state.ix < 4) && !down_) {
    if (state.rising) {
      const int jumptarget = 1716;
      if (state.level < (jumptarget << 16)) {
        state.level = jumptarget << 16;
      }
      state.level += (((17 << 24) - state.level) >> 24) * state.inc;
      // TODO: should probably be more accurate when inc is large
      if (state.level >= state.targetlevel) {
        state.level = state.targetlevel;
        advance(state, state.ix + 1, outlevel);
      }
    } else {  // !rising
      state.level -= state.inc;
      if (state.level <= state.targetlevel) {
        state.level = state.targetlevel;
        advance(state, state.ix + 1, outlevel);
      }
    }
  }
  // TODO: this would be a good place to set level to 0 when under threshold
  return state.level;
}

void Env::keydown(bool d) {
  if (down_ != d) {
    down_ = d;
    advance(state_, d ? 0 : 3, initial_outlevel_);
    advance(reference_, d ? 0 : 3, reference_outlevel_);
  }
}

void Env::setparam(int param, int value) {
  if (param < 4) {
    rates_[param] = value;
  } else if (param < 8) {
    levels_[param - 4] = value;
  }
  // Unknown parameter, ignore for now
}

// Tetorica: change attenuation, never the progressing EG state. The independent
// reference trajectory handles both operators initialized at output level 0 and
// temporary mute/unmute during release. Neither path can restart a finished EG.
void Env::setoutlevel(int outlevel) {
  if (outlevel == outlevel_) return;
  // A note that completed its legacy release before its first edit stays done,
  // even if the full-level reference has a longer tail at this low output level.
  if (!live_level_ && (down_ || state_.ix < 3 || state_.level > kSilenceFloor)) {
    // For an ordinary attack/release, adopt the exact legacy state at its
    // original fixed output level. A tiny upward edit must never jump to the
    // differently timed full-level attack. Keep the precomputed full-level path
    // only when the legacy EG has collapsed to its floor (e.g. initial OL=0).
    if (state_.level > kSilenceFloor ||
        (state_.ix < 3 && state_.targetlevel > kSilenceFloor)) {
      reference_ = state_;
      reference_outlevel_ = initial_outlevel_;
    }
    live_level_ = true;
  }
  outlevel_ = outlevel;
}

const int levellut[] = {
  0, 5, 9, 13, 17, 20, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 42, 43, 45, 46
};

int Env::scaleoutlevel(int outlevel) {
  return outlevel >= 20 ? 28 + outlevel : levellut[outlevel];
}

int Env::target(int stage, int outlevel) const {
  int newlevel = levels_[stage];
  int actuallevel = scaleoutlevel(newlevel) >> 1;
  actuallevel = (actuallevel << 6) + outlevel - 4256;
  actuallevel = actuallevel < 16 ? 16 : actuallevel;
  // level here is same as Java impl
  return actuallevel << 16;
}

void Env::advance(State &state, int newix, int outlevel) {
  state.ix = newix;
  if (state.ix < 4) {
    state.targetlevel = target(state.ix, outlevel);
    state.rising = (state.targetlevel > state.level);

    // rate
    int qrate = (rates_[state.ix] * 41) >> 6;
    qrate += rate_scaling_;
    qrate = min(qrate, 63);
    state.inc = (4 + (qrate & 3)) << (2 + LG_N + (qrate >> 2));
  }
}

