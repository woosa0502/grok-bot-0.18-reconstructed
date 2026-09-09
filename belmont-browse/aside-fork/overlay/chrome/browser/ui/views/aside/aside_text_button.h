// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_VIEWS_ASIDE_ASIDE_TEXT_BUTTON_H_
#define CHROME_BROWSER_UI_VIEWS_ASIDE_ASIDE_TEXT_BUTTON_H_

#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/gfx/font_list.h"
#include "ui/views/controls/button/md_text_button.h"

// MdTextButton whose label font can be set (the Aside strip uses Geist).
class AsideTextButton : public views::MdTextButton {
  METADATA_HEADER(AsideTextButton, views::MdTextButton)

 public:
  using views::MdTextButton::MdTextButton;
  ~AsideTextButton() override;

  void SetLabelFontList(const gfx::FontList& font_list);
};

#endif  // CHROME_BROWSER_UI_VIEWS_ASIDE_ASIDE_TEXT_BUTTON_H_
