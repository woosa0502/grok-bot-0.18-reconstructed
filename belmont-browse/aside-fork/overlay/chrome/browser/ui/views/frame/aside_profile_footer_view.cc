// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/views/frame/aside_profile_footer_view.h"

#include <memory>
#include <string>

#include "base/functional/bind.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/app/chrome_command_ids.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_attributes_entry.h"
#include "chrome/browser/profiles/profile_attributes_storage.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/ui/aside/aside_fonts.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/views/aside/aside_text_button.h"
#include "chrome/browser/ui/views/aside/icons/vector_icons.h"
#include "chrome/browser/ui/views/frame/aside_tab_search_bubble.h"
#include "components/prefs/pref_service.h"
#include "components/vector_icons/vector_icons.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/models/image_model.h"
#include "ui/color/color_id.h"
#include "ui/gfx/geometry/insets.h"
#include "ui/views/controls/button/image_button.h"
#include "ui/views/controls/button/image_button_factory.h"
#include "ui/views/layout/box_layout.h"

namespace {

constexpr int kAvatarSize = 20;

std::u16string ProfileDisplayName(Browser* browser) {
  PrefService* prefs = browser->profile()->GetPrefs();
  std::string name = prefs->GetString("aside.account_display_name");
  if (name.empty()) {
    name = prefs->GetString("aside.account_email");
  }
  if (name.empty()) {
    ProfileManager* manager = g_browser_process->profile_manager();
    if (manager) {
      ProfileAttributesEntry* entry =
          manager->GetProfileAttributesStorage().GetProfileAttributesWithPath(
              browser->profile()->GetPath());
      if (entry) {
        return entry->GetName();
      }
    }
  }
  return base::UTF8ToUTF16(name);
}

}  // namespace

AsideProfileFooterView::AsideProfileFooterView(Browser* browser)
    : browser_(browser) {
  SetOrientation(views::BoxLayout::Orientation::kHorizontal);
  SetCrossAxisAlignment(views::LayoutAlignment::kCenter);
  SetInsideBorderInsets(gfx::Insets::VH(6, 8));
  SetBetweenChildSpacing(4);

  auto profile = std::make_unique<AsideTextButton>(
      base::BindRepeating(&AsideProfileFooterView::OnProfilePressed,
                          base::Unretained(this)),
      std::u16string(), views::style::CONTEXT_BUTTON_MD);
  profile->SetStyle(ui::ButtonStyle::kText);
  profile->SetHorizontalAlignment(gfx::ALIGN_LEFT);
  profile->SetCustomPadding(gfx::Insets::VH(4, 6));
  profile->SetImageLabelSpacing(6);
  profile->SetLabelFontList(aside::UiFontList(13, gfx::Font::Weight::MEDIUM));
  profile_button_ = AddChildView(std::move(profile));
  SetFlexForView(profile_button_, 1);

  auto search = views::CreateVectorImageButtonWithNativeTheme(
      base::BindRepeating(&AsideProfileFooterView::OnSearchPressed,
                          base::Unretained(this)),
      kAsideMagnifyingGlassStrokeIcon, 18);
  search->SetTooltipText(u"Search");
  search_button_ = AddChildView(std::move(search));

  pref_registrar_.Init(browser_->profile()->GetPrefs());
  auto update = base::BindRepeating(&AsideProfileFooterView::UpdateFromPrefs,
                                    base::Unretained(this));
  for (const char* pref :
       {"aside.account_display_name", "aside.account_email",
        "aside.account_auth_paused", "aside.account_id"}) {
    pref_registrar_.Add(pref, update);
  }
  UpdateFromPrefs();
}

AsideProfileFooterView::~AsideProfileFooterView() = default;

void AsideProfileFooterView::UpdateFromPrefs() {
  const bool incognito = browser_->profile()->IsIncognitoProfile();
  const bool paused =
      browser_->profile()->GetPrefs()->GetBoolean("aside.account_auth_paused");
  profile_button_->SetText(ProfileDisplayName(browser_));
  profile_button_->SetImageModel(
      views::Button::STATE_NORMAL,
      ui::ImageModel::FromVectorIcon(
          incognito ? kAsideIncognitoRefreshMenuIcon
                    : vector_icons::kAccountCircleChromeRefreshOldIcon,
          paused ? ui::kColorAlertMediumSeverityIcon : ui::kColorIcon,
          kAvatarSize));
  profile_button_->SetTooltipText(
      paused ? std::u16string(u"Sign-in paused")
             : std::u16string(profile_button_->GetText()));
}

void AsideProfileFooterView::OnProfilePressed() {
  chrome::ExecuteCommand(browser_, IDC_SHOW_AVATAR_MENU);
}

void AsideProfileFooterView::OnSearchPressed() {
  AsideTabSearchBubbleContentsView::MaybeShow(search_button_,
                                              browser_->profile());
}

BEGIN_METADATA(AsideProfileFooterView)
END_METADATA
