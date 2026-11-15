# SPDX-License-Identifier: BSD-3-Clause
# The target links the separately licensed GPL-2.0-or-later SSF player.
cmake_minimum_required(VERSION 3.20)
project(tetorica_ssf_player LANGUAGES C CXX)
if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "Configure this WASM recipe through emcmake")
endif()

get_filename_component(TETORICA_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../.." ABSOLUTE)
set(VENDOR "${TETORICA_ROOT}/third_party/ssfplay")
set(MEDNAFEN "${VENDOR}/mednafen/src")
file(MAKE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/generated/trio")
configure_file(config.wasm.h "${CMAKE_CURRENT_BINARY_DIR}/generated/config.h" COPYONLY)
file(COPY
  "${MEDNAFEN}/trio/trio.h" "${MEDNAFEN}/trio/triodef.h"
  "${MEDNAFEN}/trio/trionan.h" "${MEDNAFEN}/trio/triop.h"
  "${MEDNAFEN}/trio/triostr.h"
  DESTINATION "${CMAKE_CURRENT_BINARY_DIR}/generated/trio")

add_library(ssf_zlib STATIC
  "${VENDOR}/zlib/adler32.c" "${VENDOR}/zlib/compress.c"
  "${VENDOR}/zlib/crc32.c" "${VENDOR}/zlib/deflate.c"
  "${VENDOR}/zlib/gzclose.c" "${VENDOR}/zlib/gzlib.c"
  "${VENDOR}/zlib/gzread.c" "${VENDOR}/zlib/gzwrite.c"
  "${VENDOR}/zlib/infback.c" "${VENDOR}/zlib/inffast.c"
  "${VENDOR}/zlib/inflate.c" "${VENDOR}/zlib/inftrees.c"
  "${VENDOR}/zlib/trees.c" "${VENDOR}/zlib/uncompr.c"
  "${VENDOR}/zlib/zutil.c")
target_include_directories(ssf_zlib PUBLIC "${VENDOR}/zlib")
target_compile_definitions(ssf_zlib PRIVATE HAVE_UNISTD_H=1)
target_compile_options(ssf_zlib PRIVATE -Wno-deprecated-non-prototype)

add_library(ssfplay STATIC
  "${VENDOR}/src/ssfplay.cpp" "${VENDOR}/src/mednafen_compat.cpp"
  "${MEDNAFEN}/error.cpp" "${MEDNAFEN}/Stream.cpp"
  "${MEDNAFEN}/MemoryStream.cpp" "${MEDNAFEN}/FileStream.cpp"
  "${MEDNAFEN}/VirtualFS.cpp" "${MEDNAFEN}/PSFLoader.cpp"
  "${MEDNAFEN}/SSFLoader.cpp" "${MEDNAFEN}/compress/DecompressFilter.cpp"
  "${MEDNAFEN}/compress/ZLInflateFilter.cpp" "${MEDNAFEN}/string/string.cpp"
  "${MEDNAFEN}/hw_cpu/m68k/m68k.cpp" "${MEDNAFEN}/resampler/resample.c"
  "${MEDNAFEN}/trio/trio.c" "${MEDNAFEN}/trio/trionan.c"
  "${MEDNAFEN}/trio/triostr.c")
target_compile_features(ssfplay PRIVATE cxx_std_11)
target_compile_definitions(ssfplay PRIVATE
  HAVE_CONFIG_H=1 SSFPLAY_STATIC=1 MDFN_DISABLE_PICPIE_ERRWARN=1
  MDFN_DISABLE_NO_OPT_ERRWARN=1)
target_compile_options(ssfplay PRIVATE
  -fsigned-char -fwrapv -fno-fast-math
  $<$<COMPILE_LANGUAGE:CXX>:-fexceptions;-sDISABLE_EXCEPTION_CATCHING=0>)
target_include_directories(ssfplay PRIVATE
  "${CMAKE_CURRENT_BINARY_DIR}/generated" "${VENDOR}/mednafen/include"
  "${VENDOR}/include")
target_link_libraries(ssfplay PRIVATE ssf_zlib)
set_source_files_properties("${MEDNAFEN}/hw_cpu/m68k/m68k.cpp"
  PROPERTIES COMPILE_OPTIONS "-O1;-fno-jump-tables")
