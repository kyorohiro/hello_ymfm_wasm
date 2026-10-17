// Native accurate-core reference for synthetic fixtures; no device or game data.
#include "SNES_SPC.h"
#include <algorithm>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <iterator>
#include <vector>
int main(int argc, char** argv) {
  if (argc != 5) { std::cerr << "fixture.spc output.s16 frames partitionFrames\n"; return 2; }
  std::ifstream in(argv[1], std::ios::binary);
  std::vector<unsigned char> bytes((std::istreambuf_iterator<char>(in)), {});
  SNES_SPC core;
  const char* error = core.init();
  if (!error) error = core.load_spc(bytes.data(), bytes.size());
  if (error) { std::cerr << error << '\n'; return 1; }
  const int frames = std::atoi(argv[3]), partition = std::atoi(argv[4]);
  if (frames < 1 || partition < 1 || partition > 65536) return 2;
  std::ofstream out(argv[2], std::ios::binary);
  std::vector<short> pcm(partition * 2);
  for (int offset = 0; offset < frames;) {
    const int count = std::min(partition, frames - offset);
    error = core.play(count * 2, pcm.data());
    if (error) { std::cerr << error << '\n'; return 1; }
    out.write(reinterpret_cast<const char*>(pcm.data()), count * 2 * sizeof(short));
    offset += count;
  }
  if (!out) return 1;
}
