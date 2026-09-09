// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/views/tabs/aside_update_badge_button.h"

#include "base/command_line.h"
#include "base/functional/bind.h"
#include "chrome/app/chrome_command_ids.h"
#include "chrome/browser/ui/aside/aside_fonts.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/views/aside/icons/vector_icons.h"
#include "chrome/browser/upgrade_detector/upgrade_detector.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/models/image_model.h"
#include "ui/color/color_id.h"
#include "ui/gfx/geometry/insets.h"
#include "ui/views/controls/label.h"

namespace {

// Original switch (0x3fc6bf8) that forces the prompt for debugging.
constexpr char kDebugUpdatePromptSwitch[] = "aside-debug-update-prompt";
constexpr char16_t kUpdateLabel[] = u"Update";
constexpr char16_t kUpdateTooltip[] = u"Review App Update";  // IDS 9869

}  // namespace

AsideUpdateBadgeButton::AsideUpdateBadgeButton(Browser* browser)
    : views::LabelButton(
          base::BindRepeating(&AsideUpdateBadgeButton::OnPressed,
                              base::Unretained(this)),
          kUpdateLabel),
      browser_(browser) {
  SetImageModel(views::Button::STATE_NORMAL,
                ui::ImageModel::FromVectorIcon(kAsideArrowDownStrokeIcon,
                                               ui::kColorSysOnPrimary, 14));
  SetTooltipText(kUpdateTooltip);
  SetImageLabelSpacing(4);
  SetBorder(views::CreateEmptyBorder(gfx::Insets::VH(3, 8)));
  label()->SetFontList(aside::UiFontList(12, gfx::Font::Weight::MEDIUM));
  SetEnabledTextColors(ui::kColorSysOnPrimary);
  SetBackground(views::CreateRoundedRectBackground(ui::kColorSysPrimary, 10));
  UpgradeDetector::GetInstance()->AddObserver(this);
  UpdateVisibility();
}

AsideUpdateBadgeButton::~AsideUpdateBadgeButton() {
  UpgradeDetector::GetInstance()->RemoveObserver(this);
}

void AsideUpdateBadgeButton::UpdateVisibility() {
  const bool forced = base::CommandLine::ForCurrentProcess()->HasSwitch(
      kDebugUpdatePromptSwitch);
  SetVisible(forced || UpgradeDetector::GetInstance()->notify_upgrade());
  if (parent()) {
    parent()->InvalidateLayout();
  }
}

void AsideUpdateBadgeButton::OnUpgradeRecommended() {
  UpdateVisibility();
}

void AsideUpdateBadgeButton::OnPressed() {
  chrome::ExecuteCommand(browser_, IDC_UPGRADE_DIALOG);
}

BEGIN_METADATA(AsideUpdateBadgeButton)
END_METADATA
