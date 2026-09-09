// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_TAB_SWITCHER_VIEW_H_
#define CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_TAB_SWITCHER_VIEW_H_

#include <vector>

#include "base/memory/raw_ptr.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/views/controls/button/button.h"
#include "ui/views/view.h"

namespace content {
class WebContents;
}

namespace views {
class ImageView;
class Label;
}  // namespace views

// One row of the Ctrl+Tab switcher (favicon + title); the selected row paints
// a rounded translucent highlight. RE: original AsideTabSwitcherItemView
// (OnPaintBackground radius 14 / alpha 0.25; icon 24; row height 40).
class AsideTabSwitcherItemView : public views::Button {
  METADATA_HEADER(AsideTabSwitcherItemView, views::Button)

 public:
  AsideTabSwitcherItemView(content::WebContents* contents,
                           PressedCallback callback);
  ~AsideTabSwitcherItemView() override;

  void SetSelected(bool selected);
  content::WebContents* contents() const { return contents_; }

  // views::View:
  void OnPaintBackground(gfx::Canvas* canvas) override;

 private:
  raw_ptr<content::WebContents> contents_;
  raw_ptr<views::ImageView> icon_ = nullptr;
  raw_ptr<views::Label> title_ = nullptr;
  bool selected_ = false;
};

// The translucent HUD listing the tabs to cycle through. RE: original
// AsideTabSwitcherView (panel width 336, corner radius 14).
class AsideTabSwitcherView : public views::View {
  METADATA_HEADER(AsideTabSwitcherView, views::View)

 public:
  using ActivateCallback =
      base::RepeatingCallback<void(content::WebContents*)>;

  AsideTabSwitcherView(const std::vector<content::WebContents*>& tabs,
                       ActivateCallback activate);
  ~AsideTabSwitcherView() override;

  void SelectIndex(int index);
  void Advance(int delta);
  int selected_index() const { return selected_index_; }
  content::WebContents* selected_contents() const;
  size_t item_count() const { return items_.size(); }

  // views::View:
  void OnPaintBackground(gfx::Canvas* canvas) override;

 private:
  std::vector<raw_ptr<AsideTabSwitcherItemView>> items_;
  ActivateCallback activate_;
  int selected_index_ = 0;
};

#endif  // CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_TAB_SWITCHER_VIEW_H_
