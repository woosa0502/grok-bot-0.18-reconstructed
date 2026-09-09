// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_PROFILE_FOOTER_VIEW_H_
#define CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_PROFILE_FOOTER_VIEW_H_

#include "base/memory/raw_ptr.h"
#include "components/prefs/pref_change_registrar.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/views/layout/box_layout_view.h"

class AsideTextButton;
class Browser;

namespace views {
class ImageButton;
}

// Bottom row of the vertical tab strip: VerticalTabSidebarProfileButton
// (avatar circle + account name + kAsideExpandMoreIcon; reads
// aside.account_* prefs, incognito uses kAsideIncognitoRefreshMenuIcon) and
// ProfileSearchButton (kAsideMagnifyingGlassStrokeIcon → tab search).
// RE: vertical_tab_strip_region_view.cc 0x43fb000–0x440e000.
class AsideProfileFooterView : public views::BoxLayoutView {
  METADATA_HEADER(AsideProfileFooterView, views::BoxLayoutView)

 public:
  explicit AsideProfileFooterView(Browser* browser);
  ~AsideProfileFooterView() override;

  void UpdateFromPrefs();

 private:
  void OnProfilePressed();
  void OnSearchPressed();

  raw_ptr<Browser> browser_;
  raw_ptr<AsideTextButton> profile_button_ = nullptr;
  raw_ptr<views::ImageButton> search_button_ = nullptr;
  PrefChangeRegistrar pref_registrar_;
};

#endif  // CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_PROFILE_FOOTER_VIEW_H_
