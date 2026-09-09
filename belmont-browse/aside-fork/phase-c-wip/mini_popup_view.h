// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_EXTENSIONS_API_ASIDE_MINI_POPUP_MINI_POPUP_VIEW_H_
#define CHROME_BROWSER_EXTENSIONS_API_ASIDE_MINI_POPUP_MINI_POPUP_VIEW_H_

#include <memory>

#include "base/memory/raw_ptr.h"
#include "chrome/browser/ui/views/extensions/extension_view_views.h"
#include "ui/views/view.h"

class Profile;

namespace extensions {

class ExtensionViewHost;

// Contents view of the Aside mini popup window: hosts minipopup.html via
// ExtensionViewViews (content half of ExtensionPopup, no bubble/anchor).
class MiniPopupView : public views::View, public ExtensionViewViews::Container {
 public:
  MiniPopupView(Profile* profile, std::unique_ptr<ExtensionViewHost> host);
  MiniPopupView(const MiniPopupView&) = delete;
  MiniPopupView& operator=(const MiniPopupView&) = delete;
  ~MiniPopupView() override;

  ExtensionViewHost* host() { return host_.get(); }

  // ExtensionViewViews::Container:
  gfx::Size GetMinBounds() override;
  gfx::Size GetMaxBounds() override;

 private:
  std::unique_ptr<ExtensionViewHost> host_;
  raw_ptr<ExtensionViewViews> extension_view_ = nullptr;
};

}  // namespace extensions

#endif  // CHROME_BROWSER_EXTENSIONS_API_ASIDE_MINI_POPUP_MINI_POPUP_VIEW_H_
