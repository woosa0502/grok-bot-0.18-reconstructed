// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_EXTENSIONS_API_ASIDE_MINI_POPUP_MINI_POPUP_SERVICE_H_
#define CHROME_BROWSER_EXTENSIONS_API_ASIDE_MINI_POPUP_MINI_POPUP_SERVICE_H_

#include <memory>
#include <string>

#include "base/memory/raw_ptr.h"
#include "components/keyed_service/core/keyed_service.h"

class Profile;

namespace content {
class BrowserContext;
}

namespace views {
class Widget;
class WidgetDelegate;
}

namespace extensions {

class Extension;
class MiniPopupView;

// Per-profile owner of the Aside mini popup window. The window is created on
// demand (first Show/SetState/SetSize) hosting the extension's minipopup.html.
class MiniPopupService : public KeyedService {
 public:
  explicit MiniPopupService(Profile* profile);
  MiniPopupService(const MiniPopupService&) = delete;
  MiniPopupService& operator=(const MiniPopupService&) = delete;
  ~MiniPopupService() override;

  static MiniPopupService* Get(content::BrowserContext* browser_context);

  // Extension-API surface (asideMiniPopup.*):
  void SetState(const Extension& extension, const std::string& state);
  void SetSize(const Extension& extension, int width, int height);
  void Hide();

  // KeyedService:
  void Shutdown() override;

 private:
  // Creates and shows the window if not present. Returns false on failure.
  bool EnsureWindow(const Extension& extension);
  void ResizeTo(int width, int height);

  raw_ptr<Profile> profile_;
  std::unique_ptr<views::WidgetDelegate> delegate_;
  std::unique_ptr<views::Widget> widget_;
  raw_ptr<MiniPopupView> view_ = nullptr;
};

}  // namespace extensions

#endif  // CHROME_BROWSER_EXTENSIONS_API_ASIDE_MINI_POPUP_MINI_POPUP_SERVICE_H_
