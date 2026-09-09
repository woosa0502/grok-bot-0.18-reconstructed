// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/aside/aside_fonts.h"

#include "base/base_paths.h"
#include "base/files/file_enumerator.h"
#include "base/files/file_path.h"
#include "base/path_service.h"
#include "build/build_config.h"

#if BUILDFLAG(IS_LINUX)
#include <fontconfig/fontconfig.h>
#endif

namespace aside {

namespace {
bool g_registered = false;
}

void RegisterBundledFonts() {
  if (g_registered) {
    return;
  }
  g_registered = true;
#if BUILDFLAG(IS_LINUX)
  base::FilePath dir;
  if (!base::PathService::Get(base::DIR_MODULE, &dir)) {
    return;
  }
  dir = dir.Append(FILE_PATH_LITERAL("aside_fonts"));
  base::FileEnumerator files(dir, false, base::FileEnumerator::FILES,
                             FILE_PATH_LITERAL("*.ttf"));
  for (base::FilePath path = files.Next(); !path.empty();
       path = files.Next()) {
    FcConfigAppFontAddFile(
        nullptr, reinterpret_cast<const FcChar8*>(path.value().c_str()));
  }
#endif
}

std::string PreferredUiFontFamily() {
  return kGeistFontFamily;
}

gfx::FontList UiFontList(int size, gfx::Font::Weight weight) {
  RegisterBundledFonts();
  return gfx::FontList({kGeistFontFamily}, gfx::Font::NORMAL, size, weight);
}

}  // namespace aside
