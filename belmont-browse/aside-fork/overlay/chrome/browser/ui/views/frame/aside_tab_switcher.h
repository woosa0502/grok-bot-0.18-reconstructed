// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_TAB_SWITCHER_H_
#define CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_TAB_SWITCHER_H_

#include <list>
#include <memory>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "ui/events/event_handler.h"

class AsideTabSwitcherView;
class Browser;

namespace content {
class WebContents;
}

namespace views {
class Widget;
}

// Ctrl+Tab / Ctrl+Shift+Tab switcher. The first press opens a HUD listing the
// tabs (most-recently-used order when aside.tab_switcher.sort_by_recently_used
// is set, else strip order), further presses move the selection, releasing
// Ctrl activates the selected tab; Esc cancels. RE: original
// chrome/browser/ui/views/frame/aside_tab_switcher.cc (HandleTabAccelerator,
// user actions Accel_SelectNextTab / SelectNextTab, observes
// Browser::OnActiveTabChanged).
class AsideTabSwitcher : public TabStripModelObserver,
                         public ui::EventHandler {
 public:
  // Called from the browser command controller for IDC_SELECT_NEXT_TAB /
  // IDC_SELECT_PREVIOUS_TAB. Returns true when the switcher consumed the
  // accelerator.
  static bool HandleTabAccelerator(Browser* browser, bool forward);

  static AsideTabSwitcher* FromBrowser(Browser* browser);

  ~AsideTabSwitcher() override;

  bool is_showing() const { return widget_ != nullptr; }

  // TabStripModelObserver:
  void OnTabStripModelChanged(
      TabStripModel* tab_strip_model,
      const TabStripModelChange& change,
      const TabStripSelectionChange& selection) override;

  void OnTabStripModelDestroyed(TabStripModel* tab_strip_model) override;

  // ui::EventHandler:
  void OnKeyEvent(ui::KeyEvent* event) override;

 private:
  explicit AsideTabSwitcher(Browser* browser);

  std::vector<content::WebContents*> OrderedTabs() const;
  void Show(bool forward);
  void Commit();
  void Cancel();
  void CloseWidget();
  void ActivateContents(content::WebContents* contents);

  raw_ptr<Browser> browser_;
  std::list<raw_ptr<content::WebContents>> mru_;
  std::unique_ptr<views::Widget> widget_;
  raw_ptr<AsideTabSwitcherView> view_ = nullptr;
  bool key_handler_installed_ = false;
};

#endif  // CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_TAB_SWITCHER_H_
