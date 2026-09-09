// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/views/aside/aside_text_button.h"

#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/views/controls/label.h"

AsideTextButton::~AsideTextButton() = default;

void AsideTextButton::SetLabelFontList(const gfx::FontList& font_list) {
  label()->SetFontList(font_list);
}

BEGIN_METADATA(AsideTextButton)
END_METADATA
