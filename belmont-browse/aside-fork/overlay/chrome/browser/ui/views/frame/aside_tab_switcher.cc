// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/views/frame/aside_tab_switcher.h"

#include <algorithm>
#include <map>

#include "base/functional/bind.h"
#include "base/metrics/user_metrics.h"
#include "base/no_destructor.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_window.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/tabs/tab_strip_user_gesture_details.h"
#include "chrome/browser/ui/views/frame/aside_tab_switcher_view.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/web_contents.h"
#include "ui/aura/window.h"
#include "ui/events/event.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/views/widget/widget.h"

namespace {

constexpr char kSortByRecentlyUsedPref[] =
    "aside.tab_switcher.sort_by_recently_used";

std::map<Browser*, std::unique_ptr<AsideTabSwitcher>>& Switchers() {
  static base::NoDestructor<std::map<Browser*, std::unique_ptr<AsideTabSwitcher>>>
      map;
  return *map;
}

}  // namespace

// static
AsideTabSwitcher* AsideTabSwitcher::FromBrowser(Browser* browser) {
  if (!browser) {
    return nullptr;
  }
  auto& map = Switchers();
  auto it = map.find(browser);
  if (it == map.end()) {
    it = map.emplace(browser, base::WrapUnique(new AsideTabSwitcher(browser)))
             .first;
  }
  return it->second.get();
}

// static
bool AsideTabSwitcher::HandleTabAccelerator(Browser* browser, bool forward) {
  AsideTabSwitcher* switcher = FromBrowser(browser);
  if (!switcher || browser->tab_strip_model()->count() < 2) {
    return false;
  }
  base::RecordAction(base::UserMetricsAction(
      forward ? "Accel_SelectNextTab" : "Accel_SelectPreviousTab"));
  if (!switcher->is_showing()) {
    switcher->Show(forward);
  } else {
    switcher->view_->Advance(forward ? 1 : -1);
  }
  return true;
}

AsideTabSwitcher::AsideTabSwitcher(Browser* browser) : browser_(browser) {
  browser_->tab_strip_model()->AddObserver(this);
  for (int i = 0; i < browser_->tab_strip_model()->count(); ++i) {
    mru_.push_back(browser_->tab_strip_model()->GetWebContentsAt(i));
  }
  if (content::WebContents* active =
          browser_->tab_strip_model()->GetActiveWebContents()) {
    mru_.remove(active);
    mru_.push_front(active);
  }
}

AsideTabSwitcher::~AsideTabSwitcher() {
  CloseWidget();
  if (browser_) {
    browser_->tab_strip_model()->RemoveObserver(this);
  }
}

std::vector<content::WebContents*> AsideTabSwitcher::OrderedTabs() const {
  std::vector<content::WebContents*> tabs;
  TabStripModel* model = browser_->tab_strip_model();
  const bool mru = browser_->profile()->GetPrefs()->GetBoolean(
      kSortByRecentlyUsedPref);
  if (mru) {
    for (content::WebContents* contents : mru_) {
      if (model->GetIndexOfWebContents(contents) != TabStripModel::kNoTab) {
        tabs.push_back(contents);
      }
    }
    for (int i = 0; i < model->count(); ++i) {
      content::WebContents* contents = model->GetWebContentsAt(i);
      if (!std::ranges::contains(tabs, contents)) {
        tabs.push_back(contents);
      }
    }
  } else {
    for (int i = 0; i < model->count(); ++i) {
      tabs.push_back(model->GetWebContentsAt(i));
    }
  }
  return tabs;
}

void AsideTabSwitcher::Show(bool forward) {
  std::vector<content::WebContents*> tabs = OrderedTabs();
  if (tabs.size() < 2) {
    return;
  }
  auto view = std::make_unique<AsideTabSwitcherView>(
      tabs, base::BindRepeating(&AsideTabSwitcher::ActivateContents,
                                base::Unretained(this)));
  view_ = view.get();

  const bool mru = browser_->profile()->GetPrefs()->GetBoolean(
      kSortByRecentlyUsedPref);
  content::WebContents* active =
      browser_->tab_strip_model()->GetActiveWebContents();
  int start = 0;
  auto it = std::ranges::find(tabs, active);
  if (it != tabs.end()) {
    start = static_cast<int>(it - tabs.begin());
  }
  // MRU: the first press lands on the previously used tab; strip order:
  // the neighbour of the active tab.
  view_->SelectIndex(mru ? (forward ? start + 1 : start - 1)
                         : (forward ? start + 1 : start - 1));

  views::Widget::InitParams params(
      views::Widget::InitParams::CLIENT_OWNS_WIDGET,
      views::Widget::InitParams::TYPE_POPUP);
  params.opacity = views::Widget::InitParams::WindowOpacity::kTranslucent;
  params.shadow_type = views::Widget::InitParams::ShadowType::kDrop;
  params.activatable = views::Widget::InitParams::Activatable::kNo;
  params.parent = browser_->window()->GetNativeWindow();
  const gfx::Rect browser_bounds = browser_->window()->GetBounds();
  const gfx::Size size = view_->GetPreferredSize();
  params.bounds = gfx::Rect(
      browser_bounds.x() + (browser_bounds.width() - size.width()) / 2,
      browser_bounds.y() + (browser_bounds.height() - size.height()) / 2,
      size.width(), size.height());
  widget_ = std::make_unique<views::Widget>();
  widget_->Init(std::move(params));
  widget_->SetContentsView(std::move(view));
  widget_->ShowInactive();

  if (aura::Window* window = browser_->window()->GetNativeWindow()) {
    window->AddPreTargetHandler(this);
    key_handler_installed_ = true;
  }
}

void AsideTabSwitcher::Commit() {
  content::WebContents* contents = view_ ? view_->selected_contents() : nullptr;
  CloseWidget();
  if (contents) {
    ActivateContents(contents);
  }
}

void AsideTabSwitcher::Cancel() {
  CloseWidget();
}

void AsideTabSwitcher::CloseWidget() {
  if (key_handler_installed_) {
    if (aura::Window* window = browser_->window()->GetNativeWindow()) {
      window->RemovePreTargetHandler(this);
    }
    key_handler_installed_ = false;
  }
  view_ = nullptr;
  widget_.reset();
}

void AsideTabSwitcher::ActivateContents(content::WebContents* contents) {
  TabStripModel* model = browser_->tab_strip_model();
  const int index = model->GetIndexOfWebContents(contents);
  if (index == TabStripModel::kNoTab) {
    return;
  }
  base::RecordAction(base::UserMetricsAction("SelectNextTab"));
  model->ActivateTabAt(index, TabStripUserGestureDetails(
                                  TabStripUserGestureDetails::GestureType::
                                      kKeyboard));
  if (is_showing()) {
    CloseWidget();
  }
}

void AsideTabSwitcher::OnTabStripModelChanged(
    TabStripModel* tab_strip_model,
    const TabStripModelChange& change,
    const TabStripSelectionChange& selection) {
  if (change.type() == TabStripModelChange::kRemoved) {
    for (const auto& removed : change.GetRemove()->contents) {
      mru_.remove(removed.contents);
    }
    if (is_showing()) {
      CloseWidget();
    }
  }
  if (selection.active_tab_changed() && selection.new_contents) {
    mru_.remove(selection.new_contents);
    mru_.push_front(selection.new_contents);
  }
}

void AsideTabSwitcher::OnTabStripModelDestroyed(
    TabStripModel* tab_strip_model) {
  CloseWidget();
  Browser* browser = browser_;
  browser_ = nullptr;
  Switchers().erase(browser);  // deletes this
}

void AsideTabSwitcher::OnKeyEvent(ui::KeyEvent* event) {
  if (!is_showing()) {
    return;
  }
  if (event->type() == ui::EventType::kKeyReleased &&
      event->key_code() == ui::VKEY_CONTROL) {
    Commit();
    event->StopPropagation();
    return;
  }
  if (event->type() == ui::EventType::kKeyPressed &&
      event->key_code() == ui::VKEY_ESCAPE) {
    Cancel();
    event->StopPropagation();
  }
}
