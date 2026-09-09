// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_ASIDE_ASIDE_AGENT_TABS_H_
#define CHROME_BROWSER_UI_ASIDE_ASIDE_AGENT_TABS_H_

#include <vector>

class Browser;
class TabStripModel;

namespace content {
class WebContents;
}

namespace aside {

// "Agent tabs" are the tabs the daemon drives inside the "Agent Tabs" group
// (created by the extension / Browser.setAiTabsMetadata). A tab is
// "controlled" while a DevTools client (the daemon's CDP session) is attached
// to it — that is what the original's "Aside is controlling the tab" banner
// and "Take over" button react to.
bool IsAgentTab(TabStripModel* model, int index);
bool IsAgentTab(Browser* browser, content::WebContents* web_contents);
std::vector<int> GetAgentTabIndices(TabStripModel* model);
int CountAgentTabs(TabStripModel* model);

bool IsAgentControlled(Browser* browser, content::WebContents* web_contents);

// Detaches every DevTools client from `web_contents` so the user can take
// over the tab.
void TakeOverTab(content::WebContents* web_contents);

// Closes every agent tab in `model`.
void CloseAllAgentTabs(TabStripModel* model);

}  // namespace aside

#endif  // CHROME_BROWSER_UI_ASIDE_ASIDE_AGENT_TABS_H_
