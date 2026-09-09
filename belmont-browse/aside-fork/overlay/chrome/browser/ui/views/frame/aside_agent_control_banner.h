// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_AGENT_CONTROL_BANNER_H_
#define CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_AGENT_CONTROL_BANNER_H_

#include "base/memory/raw_ptr.h"
#include "base/scoped_observation.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/devtools_agent_host_observer.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/views/view.h"

class Browser;
class ContentsWebView;
class TabStripModel;

namespace views {
class Label;
class MdTextButton;
}  // namespace views

// The "Aside is controlling the tab" strip shown above the web contents while
// the daemon's DevTools session drives an agent tab; "Take over" detaches it.
// RE: original multi_contents_view.cc (IDS 11706 / 11707).
class AsideAgentControlBanner : public views::View,
                                public TabStripModelObserver,
                                public content::DevToolsAgentHostObserver {
  METADATA_HEADER(AsideAgentControlBanner, views::View)

 public:
  AsideAgentControlBanner(Browser* browser, ContentsWebView* contents_view);
  ~AsideAgentControlBanner() override;

  // Recomputes visibility for the hosted contents.
  void Update();

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

  // content::DevToolsAgentHostObserver:
  void DevToolsAgentHostAttached(content::DevToolsAgentHost* host) override;
  void DevToolsAgentHostDetached(content::DevToolsAgentHost* host) override;

 private:
  void OnTakeOverPressed();

  raw_ptr<Browser> browser_;
  raw_ptr<ContentsWebView> contents_view_;
  raw_ptr<views::Label> label_ = nullptr;
  raw_ptr<views::MdTextButton> take_over_button_ = nullptr;
};

#endif  // CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_AGENT_CONTROL_BANNER_H_
