// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/views/frame/aside_tab_switcher_view.h"

#include <memory>

#include "base/functional/bind.h"
#include "chrome/browser/ui/aside/aside_fonts.h"
#include "chrome/browser/ui/views/aside/icons/vector_icons.h"
#include "components/favicon/content/content_favicon_driver.h"
#include "content/public/browser/web_contents.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/models/image_model.h"
#include "ui/color/color_id.h"
#include "ui/color/color_provider.h"
#include "ui/gfx/canvas.h"
#include "ui/gfx/geometry/insets.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/views/controls/image_view.h"
#include "ui/views/controls/label.h"
#include "ui/views/layout/box_layout.h"

namespace {

constexpr int kPanelWidth = 336;
constexpr int kPanelRadius = 14;
constexpr int kItemRadius = 12;
constexpr int kItemHeight = 40;
constexpr int kIconSize = 24;
constexpr int kPadding = 8;
constexpr float kSelectedAlpha = 0.25f;
constexpr float kPanelAlpha = 0.85f;

}  // namespace

// AsideTabSwitcherItemView --------------------------------------------------

AsideTabSwitcherItemView::AsideTabSwitcherItemView(
    content::WebContents* contents,
    PressedCallback callback)
    : views::Button(std::move(callback)), contents_(contents) {
  auto* layout = SetLayoutManager(std::make_unique<views::BoxLayout>(
      views::BoxLayout::Orientation::kHorizontal, gfx::Insets::VH(0, kPadding),
      kPadding));
  layout->set_cross_axis_alignment(
      views::BoxLayout::CrossAxisAlignment::kCenter);
  icon_ = AddChildView(std::make_unique<views::ImageView>());
  ui::ImageModel favicon = ui::ImageModel::FromVectorIcon(
      kAsideGlobeIcon, ui::kColorIconSecondary, kIconSize);
  if (auto* driver = favicon::ContentFaviconDriver::FromWebContents(contents);
      driver && !driver->GetFavicon().IsEmpty()) {
    favicon = ui::ImageModel::FromImage(driver->GetFavicon());
  }
  icon_->SetImage(favicon);
  icon_->SetImageSize(gfx::Size(kIconSize, kIconSize));
  title_ = AddChildView(std::make_unique<views::Label>(
      contents->GetTitle(), views::style::CONTEXT_LABEL,
      views::style::STYLE_PRIMARY));
  title_->SetHorizontalAlignment(gfx::ALIGN_LEFT);
  title_->SetElideBehavior(gfx::ELIDE_TAIL);
  title_->SetFontList(aside::UiFontList(13));
  layout->SetFlexForView(title_, 1);
  SetPreferredSize(gfx::Size(kPanelWidth - 2 * kPadding, kItemHeight));
  SetTooltipText(contents->GetTitle());
}

AsideTabSwitcherItemView::~AsideTabSwitcherItemView() = default;

void AsideTabSwitcherItemView::SetSelected(bool selected) {
  if (selected_ == selected) {
    return;
  }
  selected_ = selected;
  SchedulePaint();
}

void AsideTabSwitcherItemView::OnPaintBackground(gfx::Canvas* canvas) {
  if (!selected_) {
    return;
  }
  cc::PaintFlags flags;
  flags.setAntiAlias(true);
  flags.setColor(SkColorSetA(
      GetColorProvider()->GetColor(ui::kColorSysOnSurface),
      static_cast<U8CPU>(kSelectedAlpha * 255)));
  canvas->DrawRoundRect(gfx::RectF(GetLocalBounds()), kItemRadius, flags);
}

BEGIN_METADATA(AsideTabSwitcherItemView)
END_METADATA

// AsideTabSwitcherView ------------------------------------------------------

AsideTabSwitcherView::AsideTabSwitcherView(
    const std::vector<content::WebContents*>& tabs,
    ActivateCallback activate)
    : activate_(std::move(activate)) {
  SetLayoutManager(std::make_unique<views::BoxLayout>(
      views::BoxLayout::Orientation::kVertical, gfx::Insets(kPadding), 2));
  for (content::WebContents* contents : tabs) {
    auto* item = AddChildView(std::make_unique<AsideTabSwitcherItemView>(
        contents, base::BindRepeating(
                      [](AsideTabSwitcherView* view, content::WebContents* wc) {
                        view->activate_.Run(wc);
                      },
                      base::Unretained(this), contents)));
    items_.push_back(item);
  }
  SetPreferredSize(gfx::Size(
      kPanelWidth,
      2 * kPadding + static_cast<int>(items_.size()) * (kItemHeight + 2)));
  SelectIndex(0);
}

AsideTabSwitcherView::~AsideTabSwitcherView() = default;

void AsideTabSwitcherView::SelectIndex(int index) {
  if (items_.empty()) {
    return;
  }
  const int count = static_cast<int>(items_.size());
  selected_index_ = ((index % count) + count) % count;
  for (int i = 0; i < count; ++i) {
    items_[i]->SetSelected(i == selected_index_);
  }
}

void AsideTabSwitcherView::Advance(int delta) {
  SelectIndex(selected_index_ + delta);
}

content::WebContents* AsideTabSwitcherView::selected_contents() const {
  if (items_.empty()) {
    return nullptr;
  }
  return items_[selected_index_]->contents();
}

void AsideTabSwitcherView::OnPaintBackground(gfx::Canvas* canvas) {
  cc::PaintFlags flags;
  flags.setAntiAlias(true);
  flags.setColor(SkColorSetA(
      GetColorProvider()->GetColor(ui::kColorSysSurface),
      static_cast<U8CPU>(kPanelAlpha * 255)));
  canvas->DrawRoundRect(gfx::RectF(GetLocalBounds()), kPanelRadius, flags);
}

BEGIN_METADATA(AsideTabSwitcherView)
END_METADATA
