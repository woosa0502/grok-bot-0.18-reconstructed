// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/views/frame/aside_agent_control_banner.h"

#include <memory>

#include "base/functional/bind.h"
#include "chrome/browser/ui/aside/aside_agent_tabs.h"
#include "chrome/browser/ui/aside/aside_fonts.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/views/aside/icons/vector_icons.h"
#include "chrome/browser/ui/views/frame/contents_web_view.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/models/image_model.h"
#include "ui/color/color_id.h"
#include "ui/gfx/geometry/insets.h"
#include "ui/views/background.h"
#include "ui/views/controls/button/md_text_button.h"
#include "ui/views/controls/image_view.h"
#include "ui/views/controls/label.h"
#include "ui/views/layout/box_layout.h"

namespace {

// Aside-only strings (aside_resources): IDS 11706 / 11707.
constexpr char16_t kControllingLabel[] = u"Aside is controlling the tab";
constexpr char16_t kTakeOverLabel[] = u"Take over";

}  // namespace

AsideAgentControlBanner::AsideAgentControlBanner(Browser* browser,
                                                 ContentsWebView* contents_view)
    : browser_(browser), contents_view_(contents_view) {
  auto* layout = SetLayoutManager(std::make_unique<views::BoxLayout>(
      views::BoxLayout::Orientation::kHorizontal, gfx::Insets::VH(6, 12), 8));
  layout->set_cross_axis_alignment(views::BoxLayout::CrossAxisAlignment::kCenter);
  SetBackground(
      views::CreateSolidBackground(ui::kColorSubtleEmphasisBackground));

  auto icon = std::make_unique<views::ImageView>(ui::ImageModel::FromVectorIcon(
      kAsideWindowSparkleStrokeIcon, ui::kColorIcon, 16));
  AddChildView(std::move(icon));
  label_ = AddChildView(std::make_unique<views::Label>(
      kControllingLabel, views::style::CONTEXT_LABEL,
      views::style::STYLE_PRIMARY));
  label_->SetHorizontalAlignment(gfx::ALIGN_LEFT);
  label_->SetFontList(aside::UiFontList(13, gfx::Font::Weight::MEDIUM));
  layout->SetFlexForView(label_, 1);
  take_over_button_ = AddChildView(std::make_unique<views::MdTextButton>(
      base::BindRepeating(&AsideAgentControlBanner::OnTakeOverPressed,
                          base::Unretained(this)),
      kTakeOverLabel));
  take_over_button_->SetStyle(ui::ButtonStyle::kProminent);

  SetVisible(false);
  if (browser_) {
    browser_->tab_strip_model()->AddObserver(this);
  }
  content::DevToolsAgentHost::AddObserver(this);
}

AsideAgentControlBanner::~AsideAgentControlBanner() {
  content::DevToolsAgentHost::RemoveObserver(this);
  if (browser_) {
    browser_->tab_strip_model()->RemoveObserver(this);
  }
}

void AsideAgentControlBanner::Update() {
  content::WebContents* contents =
      contents_view_ ? contents_view_->web_contents() : nullptr;
  const bool visible = aside::IsAgentControlled(browser_, contents);
  if (visible != GetVisible()) {
    SetVisible(visible);
    if (parent()) {
      parent()->InvalidateLayout();
    }
  }
}

void AsideAgentControlBanner::OnTabStripModelChanged(
    TabStripModel* tab_strip_model,
    const TabStripModelChange& change,
    const TabStripSelectionChange& selection) {
  Update();
}

void AsideAgentControlBanner::TabGroupedStateChanged(
    TabStripModel* tab_strip_model,
    std::optional<tab_groups::TabGroupId> old_group,
    std::optional<tab_groups::TabGroupId> new_group,
    tabs::TabInterface* tab,
    int index) {
  Update();
}

void AsideAgentControlBanner::OnTabGroupChanged(const TabGroupChange& change) {
  Update();
}

void AsideAgentControlBanner::DevToolsAgentHostAttached(
    content::DevToolsAgentHost* host) {
  Update();
}

void AsideAgentControlBanner::DevToolsAgentHostDetached(
    content::DevToolsAgentHost* host) {
  Update();
}

void AsideAgentControlBanner::OnTakeOverPressed() {
  if (contents_view_) {
    aside::TakeOverTab(contents_view_->web_contents());
  }
  Update();
}

BEGIN_METADATA(AsideAgentControlBanner)
END_METADATA
