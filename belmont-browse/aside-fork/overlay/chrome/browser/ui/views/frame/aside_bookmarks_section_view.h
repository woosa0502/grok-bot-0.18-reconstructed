// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_BOOKMARKS_SECTION_VIEW_H_
#define CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_BOOKMARKS_SECTION_VIEW_H_

#include <set>
#include <string>

#include "base/memory/raw_ptr.h"
#include "components/bookmarks/browser/base_bookmark_model_observer.h"
#include "components/prefs/pref_change_registrar.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/views/layout/box_layout_view.h"

class Browser;

namespace bookmarks {
class BookmarkModel;
class BookmarkNode;
}  // namespace bookmarks

class AsideTextButton;

// Vertical tab strip "Bookmarks" section: the bookmark bar tree with
// expandable folders. Driven by the prefs the original consumes
// (aside.vertical_tabs.bookmarks_section_enabled / _expanded /
// expanded_bookmark_folder_ids; RE strings in
// vertical_tab_strip_region_view.cc, icons kAsideBookmarkFolderIcon /
// kAsideBookmarkSolidIcon / kAsideChevronRightMediumStrokeIcon /
// kAsideExpandMoreIcon).
class AsideBookmarksSectionView : public views::BoxLayoutView,
                                  public bookmarks::BaseBookmarkModelObserver {
  METADATA_HEADER(AsideBookmarksSectionView, views::BoxLayoutView)

 public:
  explicit AsideBookmarksSectionView(Browser* browser);
  ~AsideBookmarksSectionView() override;

  void Rebuild();

  // bookmarks::BaseBookmarkModelObserver:
  void BookmarkModelChanged() override;

 private:
  void AddNodeRows(const bookmarks::BookmarkNode* node, int depth);
  void ToggleSection();
  void ToggleFolder(int64_t folder_id);
  void OpenBookmark(int64_t node_id);
  bool IsFolderExpanded(int64_t folder_id) const;
  std::set<std::string> ExpandedFolderIds() const;

  raw_ptr<Browser> browser_;
  raw_ptr<bookmarks::BookmarkModel> model_ = nullptr;
  raw_ptr<AsideTextButton> header_ = nullptr;
  raw_ptr<views::View> rows_ = nullptr;
  PrefChangeRegistrar pref_registrar_;
};

#endif  // CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_BOOKMARKS_SECTION_VIEW_H_
