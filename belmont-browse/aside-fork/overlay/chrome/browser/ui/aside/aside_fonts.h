// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_ASIDE_ASIDE_FONTS_H_
#define CHROME_BROWSER_UI_ASIDE_ASIDE_FONTS_H_

#include <string>

#include "ui/gfx/font.h"
#include "ui/gfx/font_list.h"

namespace aside {

// Family name used by the original's vertical tab strip ("Geist" string in
// vertical_tab_strip_region_view.cc).
inline constexpr char kGeistFontFamily[] = "Geist";

// Registers the bundled Geist TTFs (<exe dir>/aside_fonts) with fontconfig so
// gfx::FontList("Geist, ...") resolves. Safe to call more than once.
void RegisterBundledFonts();

// "Geist" when registered, else the platform default family.
std::string PreferredUiFontFamily();

// Geist font list at `size` px with `weight` (registers the fonts first).
gfx::FontList UiFontList(int size, gfx::Font::Weight weight);
inline gfx::FontList UiFontList(int size) {
  return UiFontList(size, gfx::Font::Weight::NORMAL);
}

}  // namespace aside

#endif  // CHROME_BROWSER_UI_ASIDE_ASIDE_FONTS_H_
