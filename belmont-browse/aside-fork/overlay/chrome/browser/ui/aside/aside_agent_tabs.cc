// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/aside/aside_agent_tabs.h"

#include <algorithm>

#include "chrome/browser/ui/aside/aside_ai_tabs_metadata.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/tabs/tab_enums.h"
#include "chrome/browser/ui/tabs/tab_group_model.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/tabs/public/tab_group.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/web_contents.h"

namespace aside {

bool IsAgentTab(TabStripModel* model, int index) {
  if (!model || index < 0 || index >= model->count()) {
    return false;
  }
  std::optional<tab_groups::TabGroupId> group = model->GetTabGroupForTab(index);
  if (!group || !model->SupportsTabGroups()) {
    return false;
  }
  return IsAgentTabsGroup(model->group_model()->GetTabGroup(*group));
}

bool IsAgentTab(Browser* browser, content::WebContents* web_contents) {
  if (!browser || !web_contents) {
    return false;
  }
  TabStripModel* model = browser->tab_strip_model();
  return IsAgentTab(model, model->GetIndexOfWebContents(web_contents));
}

std::vector<int> GetAgentTabIndices(TabStripModel* model) {
  std::vector<int> indices;
  if (!model) {
    return indices;
  }
  for (int i = 0; i < model->count(); ++i) {
    if (IsAgentTab(model, i)) {
      indices.push_back(i);
    }
  }
  return indices;
}

int CountAgentTabs(TabStripModel* model) {
  return static_cast<int>(GetAgentTabIndices(model).size());
}

bool IsAgentControlled(Browser* browser, content::WebContents* web_contents) {
  if (!IsAgentTab(browser, web_contents)) {
    return false;
  }
  if (!content::DevToolsAgentHost::HasFor(web_contents)) {
    return false;
  }
  return content::DevToolsAgentHost::GetOrCreateFor(web_contents)->IsAttached();
}

void TakeOverTab(content::WebContents* web_contents) {
  if (!web_contents || !content::DevToolsAgentHost::HasFor(web_contents)) {
    return;
  }
  content::DevToolsAgentHost::GetOrCreateFor(web_contents)
      ->ForceDetachAllSessions();
}

void CloseAllAgentTabs(TabStripModel* model) {
  std::vector<int> indices = GetAgentTabIndices(model);
  std::sort(indices.rbegin(), indices.rend());
  for (int index : indices) {
    model->CloseWebContentsAt(index, TabCloseTypes::CLOSE_USER_GESTURE);
  }
}

}  // namespace aside
