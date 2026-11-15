#include <mednafen/mednafen.h>

#include <cstdarg>
#include <cstdio>

namespace Mednafen {

void MDFND_OutputNotice(MDFN_NoticeType, const char*) noexcept {
}

bool MDFN_GetSettingB(const char* name) {
  return !strcmp(name, "filesys.untrusted_fip_check");
}

void MDFN_printf(const char* format, ...) noexcept {
  va_list ap;
  va_start(ap, format);
  vfprintf(stderr, format, ap);
  va_end(ap);
}

bool MDFNSS_StateAction(StateMem*, unsigned, bool, const SFORMAT*, const char*, bool) noexcept {
  return true;
}

}
