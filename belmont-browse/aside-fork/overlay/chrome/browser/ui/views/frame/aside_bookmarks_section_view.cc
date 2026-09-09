// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/views/frame/aside_bookmarks_section_view.h"

#include <memory>
#include <utility>

#include "base/functional/bind.h"
#include "base/strings/string_number_conversions.h"
#include "base/values.h"
#include "chrome/browser/bookmarks/bookmark_model_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/navigator/browser_navigator.h"
#include "chrome/browser/ui/navigator/browser_navigator_params.h"
#include "chrome/browser/ui/aside/aside_fonts.h"
#include "chrome/browser/ui/views/aside/aside_text_button.h"
#include "chrome/browser/ui/views/aside/icons/vector_icons.h"
#include "components/bookmarks/browser/bookmark_model.h"
#include "components/bookmarks/browser/bookmark_node.h"
#include "components/bookmarks/browser/bookmark_utils.h"
#include "components/prefs/pref_service.h"
#include "components/prefs/scoped_user_pref_update.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/models/image_model.h"
#include "ui/base/page_transition_types.h"
#include "ui/base/window_open_disposition.h"
#include "ui/color/color_id.h"
#include "ui/gfx/geometry/insets.h"
#include "ui/views/controls/button/md_text_button.h"
#include "ui/views/layout/box_layout.h"

namespace {

constexpr char kEnabledPref[] = "aside.vertical_tabs.bookmarks_section_enabled";
constexpr char kExpandedPref[] =
    "aside.vertical_tabs.bookmarks_section_expanded";
constexpr char kExpandedFoldersPref[] =
    "aside.vertical_tabs.expanded_bookmark_folder_ids";
constexpr char16_t kBookmarksTitle[] = u"Bookmarks";
constexpr int kIndent = 14;
constexpr int kMaxRows = 40;

}  // namespace

AsideBookmarksSectionView::AsideBookmarksSectionView(Browser* browser)
    : browser_(browser) {
  SetOrientation(views::BoxLayout::Orientation::kVertical);
  SetCrossAxisAlignment(views::LayoutAlignment::kStretch);

  header_ = AddChildView(std::make_unique<AsideTextButton>(
      base::BindRepeating(&AsideBookmarksSectionView::ToggleSection,
                          base::Unretained(this)),
      kBookmarksTitle, views::style::CONTEXT_BUTTON_MD));
  header_->SetStyle(ui::ButtonStyle::kText);
  header_->SetCustomPadding(gfx::Insets::VH(4, 8));
  header_->SetHorizontalAlignment(gfx::ALIGN_LEFT);
  header_->SetLabelStyle(views::style::STYLE_BODY_4_BOLD);
  header_->SetImageLabelSpacing(4);
  header_->SetLabelFontList(
      aside::UiFontList(12, gfx::Font::Weight::SEMIBOLD));

  auto rows = std::make_unique<views::BoxLayoutView>();
  rows->SetOrientation(views::BoxLayout::Orientation::kVertical);
  rows->SetCrossAxisAlignment(views::LayoutAlignment::kStretch);
  rows_ = AddChildView(std::move(rows));

  model_ = BookmarkModelFactory::GetForBrowserContext(browser_->profile());
  if (model_) {
    model_->AddObserver(this);
  }
  pref_registrar_.Init(browser_->profile()->GetPrefs());
  auto rebuild = base::BindRepeating(&AsideBookmarksSectionView::Rebuild,
                                     base::Unretained(this));
  pref_registrar_.Add(kEnabledPref, rebuild);
  pref_registrar_.Add(kExpandedPref, rebuild);
  pref_registrar_.Add(kExpandedFoldersPref, rebuild);
  Rebuild();
}

AsideBookmarksSectionView::~AsideBookmarksSectionView() {
  if (model_) {
    model_->RemoveObserver(this);
  }
}

void AsideBookmarksSectionView::BookmarkModelChanged() {
  Rebuild();
}

std::set<std::string> AsideBookmarksSectionView::ExpandedFolderIds() const {
  std::set<std::string> ids;
  for (const base::Value& v :
       browser_->profile()->GetPrefs()->GetList(kExpandedFoldersPref)) {
    if (v.is_string()) {
      ids.insert(v.GetString());
    }
  }
  return ids;
}

bool AsideBookmarksSectionView::IsFolderExpanded(int64_t folder_id) const {
  return ExpandedFolderIds().contains(base::NumberToString(folder_id));
}

void AsideBookmarksSectionView::Rebuild() {
  PrefService* prefs = browser_->profile()->GetPrefs();
  const bool enabled = prefs->GetBoolean(kEnabledPref);
  const bool expanded = prefs->GetBoolean(kExpandedPref);
  SetVisible(enabled && model_ && model_->loaded());
  header_->SetImageModel(
      views::Button::STATE_NORMAL,
      ui::ImageModel::FromVectorIcon(expanded ? kAsideExpandMoreIcon
                                              : kAsideChevronRightMediumStrokeIcon,
                                     ui::kColorIcon, 14));
  rows_->RemoveAllChildViews();
  rows_->SetVisible(expanded);
  if (enabled && expanded && model_ && model_->loaded()) {
    AddNodeRows(model_->bookmark_bar_node(), 0);
  }
  InvalidateLayout();
  if (parent()) {
    parent()->InvalidateLayout();
  }
}

void AsideBookmarksSectionView::AddNodeRows(const bookmarks::BookmarkNode* node,
                                            int depth) {
  if (!node) {
    return;
  }
  for (const auto& child : node->children()) {
    if (rows_->children().size() >= kMaxRows) {
      return;
    }
    const bool folder = child->is_folder();
    const bool open = folder && IsFolderExpanded(child->id());
    auto* row = rows_->AddChildView(std::make_unique<AsideTextButton>(
        folder ? base::BindRepeating(&AsideBookmarksSectionView::ToggleFolder,
                                     base::Unretained(this), child->id())
               : base::BindRepeating(&AsideBookmarksSectionView::OpenBookmark,
                                     base::Unretained(this), child->id()),
        child->GetTitle()));
    row->SetStyle(ui::ButtonStyle::kText);
    row->SetHorizontalAlignment(gfx::ALIGN_LEFT);
    row->SetCustomPadding(gfx::Insets::TLBR(3, 8 + depth * kIndent, 3, 8));
    row->SetImageLabelSpacing(6);
    row->SetLabelFontList(aside::UiFontList(13));
    row->SetTooltipText(folder ? child->GetTitle()
                               : base::UTF8ToUTF16(child->url().spec()));
    row->SetImageModel(
        views::Button::STATE_NORMAL,
        ui::ImageModel::FromVectorIcon(
            folder ? (open ? kAsideExpandMoreIcon : kAsideBookmarkFolderIcon)
                   : kAsideBookmarkSolidIcon,
            ui::kColorIcon, 14));
    if (open) {
      AddNodeRows(child.get(), depth + 1);
    }
  }
}

void AsideBookmarksSectionView::ToggleSection() {
  PrefService* prefs = browser_->profile()->GetPrefs();
  prefs->SetBoolean(kExpandedPref, !prefs->GetBoolean(kExpandedPref));
}

void AsideBookmarksSectionView::ToggleFolder(int64_t folder_id) {
  ScopedListPrefUpdate update(browser_->profile()->GetPrefs(),
                              kExpandedFoldersPref);
  const std::string id = base::NumberToString(folder_id);
  base::ListValue& list = update.Get();
  if (!list.EraseValue(base::Value(id))) {
    list.Append(id);
  }
}

void AsideBookmarksSectionView::OpenBookmark(int64_t node_id) {
  if (!model_) {
    return;
  }
  const bookmarks::BookmarkNode* node =
      bookmarks::GetBookmarkNodeByID(model_, node_id);
  if (!node || !node->is_url()) {
    return;
  }
  NavigateParams params(browser_, node->url(),
                        ui::PAGE_TRANSITION_AUTO_BOOKMARK);
  params.disposition = WindowOpenDisposition::CURRENT_TAB;
  Navigate(&params);
}

BEGIN_METADATA(AsideBookmarksSectionView)
END_METADATA
