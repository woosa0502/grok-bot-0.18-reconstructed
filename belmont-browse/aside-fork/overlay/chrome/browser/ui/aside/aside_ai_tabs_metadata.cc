// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/aside/aside_ai_tabs_metadata.h"

#include <map>
#include <utility>

#include "base/no_destructor.h"
#include "components/tab_groups/tab_group_visual_data.h"
#include "components/tabs/public/tab_group.h"

namespace aside {

namespace {

std::map<tab_groups::TabGroupId, AiTabsMetadata>& Registry() {
  static base::NoDestructor<std::map<tab_groups::TabGroupId, AiTabsMetadata>>
      registry;
  return *registry;
}

}  // namespace

void SetAiTabsMetadata(const tab_groups::TabGroupId& group,
                       AiTabsMetadata metadata) {
  Registry()[group] = std::move(metadata);
}

std::optional<AiTabsMetadata> GetAiTabsMetadata(
    const tab_groups::TabGroupId& group) {
  auto it = Registry().find(group);
  if (it == Registry().end()) {
    return std::nullopt;
  }
  return it->second;
}

void ClearAiTabsMetadata(const tab_groups::TabGroupId& group) {
  Registry().erase(group);
}

bool IsAgentTabsGroup(const TabGroup* group) {
  if (!group) {
    return false;
  }
  if (Registry().contains(group->id())) {
    return true;
  }
  return group->visual_data()->title() == kAgentTabsGroupTitle;
}

}  // namespace aside
