// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_ASIDE_ASIDE_AI_TABS_METADATA_H_
#define CHROME_BROWSER_UI_ASIDE_ASIDE_AI_TABS_METADATA_H_

#include <optional>
#include <string>

#include "components/tab_groups/tab_group_id.h"

class TabGroup;

namespace aside {

// Metadata attached to the "Agent Tabs" tab group by Browser.setAiTabsMetadata
// (RE: original strings badgeLabel / initialOrigin; AiTabsCountBadgeView).
struct AiTabsMetadata {
  std::string badge_label;
  std::string initial_origin;
};

// The extension creates the agent group with this title (background.js:
// chrome.tabGroups.update(id, {title: "Agent Tabs"})); the original browser
// carries the same UTF-16 literal.
inline constexpr char16_t kAgentTabsGroupTitle[] = u"Agent Tabs";

void SetAiTabsMetadata(const tab_groups::TabGroupId& group,
                       AiTabsMetadata metadata);
std::optional<AiTabsMetadata> GetAiTabsMetadata(
    const tab_groups::TabGroupId& group);
void ClearAiTabsMetadata(const tab_groups::TabGroupId& group);

// True for the group the agent works in: either flagged through
// setAiTabsMetadata or titled "Agent Tabs" by the extension.
bool IsAgentTabsGroup(const TabGroup* group);

}  // namespace aside

#endif  // CHROME_BROWSER_UI_ASIDE_ASIDE_AI_TABS_METADATA_H_
