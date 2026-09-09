// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_VIEWS_TABS_ASIDE_AGENT_TABS_BUTTON_H_
#define CHROME_BROWSER_UI_VIEWS_TABS_ASIDE_AGENT_TABS_BUTTON_H_

#include "base/memory/raw_ptr.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/views/controls/button/label_button.h"
#include "ui/views/view.h"

class Browser;
class TabStripModel;

// Vertical tab strip button that counts the tabs in the "Agent Tabs" group
// and opens AsideAgentTabsBubbleView. RE: original
// chrome/browser/ui/views/tabs/aside_agent_tabs_button.cc
// (kAsideWindowSparkleStrokeIcon; strings "Agent Tabs",
// "Background tabs Aside opened", "Background tabs opened for work",
// "Close all", "Configure auto close"; bubble rows use kAsideGlobeIcon and
// kCloseIcon).
class AsideAgentTabsButton : public views::LabelButton,
                             public TabStripModelObserver {
  METADATA_HEADER(AsideAgentTabsButton, views::LabelButton)

 public:
  explicit AsideAgentTabsButton(Browser* browser);
  ~AsideAgentTabsButton() override;

  void UpdateState();

  // TabStripModelObserver:
  void OnTabStripModelChanged(
      TabStripModel* tab_strip_model,
      const TabStripModelChange& change,
      const TabStripSelectionChange& selection) override;
  void TabGroupedStateChanged(
      TabStripModel* tab_strip_model,
      std::optional<tab_groups::TabGroupId> old_group,
      std::optional<tab_groups::TabGroupId> new_group,
      tabs::TabInterface* tab,
      int index) override;
  void OnTabGroupChanged(const TabGroupChange& change) override;

 private:
  void OnPressed();

  raw_ptr<Browser> browser_;
};

// Contents of the agent tabs bubble: title, subtitle, one AgentTabsRowView per
// agent tab and an AgentTabsCommandRowView ("Close all",
// "Configure auto close").
class AsideAgentTabsBubbleView : public views::View,
                                 public TabStripModelObserver {
  METADATA_HEADER(AsideAgentTabsBubbleView, views::View)

 public:
  explicit AsideAgentTabsBubbleView(Browser* browser);
  ~AsideAgentTabsBubbleView() override;

  // Shows the bubble anchored at `anchor` (self-owning widget).
  static void Show(views::View* anchor, Browser* browser);

  // TabStripModelObserver:
  void OnTabStripModelChanged(
      TabStripModel* tab_strip_model,
      const TabStripModelChange& change,
      const TabStripSelectionChange& selection) override;
  void TabGroupedStateChanged(
      TabStripModel* tab_strip_model,
      std::optional<tab_groups::TabGroupId> old_group,
      std::optional<tab_groups::TabGroupId> new_group,
      tabs::TabInterface* tab,
      int index) override;

 private:
  void RebuildRows();
  void OnCloseAllPressed();
  void OnConfigureAutoClosePressed();

  raw_ptr<Browser> browser_;
  raw_ptr<views::View> rows_ = nullptr;
};

#endif  // CHROME_BROWSER_UI_VIEWS_TABS_ASIDE_AGENT_TABS_BUTTON_H_
