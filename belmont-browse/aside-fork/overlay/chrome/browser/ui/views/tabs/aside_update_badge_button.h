// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_VIEWS_TABS_ASIDE_UPDATE_BADGE_BUTTON_H_
#define CHROME_BROWSER_UI_VIEWS_TABS_ASIDE_UPDATE_BADGE_BUTTON_H_

#include "base/memory/raw_ptr.h"
#include "chrome/browser/upgrade_detector/upgrade_observer.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/views/controls/button/label_button.h"

class Browser;

// Badge shown in the vertical tab strip header when an update is ready
// (RE: AsideUpdateBadgeButton, 0x3fc3dc8; version "1.0.825.1"; honours
// --simulate-upgrade / --aside-debug-update-prompt). Pressing it runs the
// relaunch/update flow (IDC_UPGRADE_DIALOG).
class AsideUpdateBadgeButton : public views::LabelButton,
                               public UpgradeObserver {
  METADATA_HEADER(AsideUpdateBadgeButton, views::LabelButton)

 public:
  explicit AsideUpdateBadgeButton(Browser* browser);
  ~AsideUpdateBadgeButton() override;

  void UpdateVisibility();

  // UpgradeObserver:
  void OnUpgradeRecommended() override;

 private:
  void OnPressed();

  raw_ptr<Browser> browser_;
};

#endif  // CHROME_BROWSER_UI_VIEWS_TABS_ASIDE_UPDATE_BADGE_BUTTON_H_
