// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/extensions/api/aside_mini_popup/mini_popup_service.h"

#include <utility>

#include "base/functional/function_ref.h"
#include "chrome/browser/extensions/api/aside_mini_popup/mini_popup_service_factory.h"
#include "chrome/browser/extensions/api/aside_mini_popup/mini_popup_view.h"
#include "chrome/browser/extensions/extension_view_host.h"
#include "chrome/browser/extensions/extension_view_host_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface_iterator.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/extension_host.h"
#include "extensions/common/extension.h"
#include "ui/base/base_window.h"
#include "ui/base/hit_test.h"
#include "ui/base/ui_base_types.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"
#include "ui/views/widget/widget.h"
#include "ui/views/widget/widget_delegate.h"
#include "ui/views/window/frame_view.h"
#include "ui/views/window/non_client_view.h"

namespace extensions {

namespace {
// A frameless frame view: the whole window is client area, no title bar/border.
class MiniPopupFrameView : public views::FrameView {
 public:
  MiniPopupFrameView() = default;
  MiniPopupFrameView(const MiniPopupFrameView&) = delete;
  MiniPopupFrameView& operator=(const MiniPopupFrameView&) = delete;
  ~MiniPopupFrameView() override = default;

  gfx::Rect GetBoundsForClientView() const override { return GetLocalBounds(); }
  gfx::Rect GetWindowBoundsForClientBounds(
      const gfx::Rect& client_bounds) const override {
    return client_bounds;
  }
  int NonClientHitTest(const gfx::Point& point) override { return HTCLIENT; }
};

// A minimal widget delegate that owns the MiniPopupView contents and supplies
// a NonClientFrameView so the top-level window has a valid frame (otherwise
// X11 window-shape code dereferences a null frame view).
class MiniPopupWidgetDelegate : public views::WidgetDelegate {
 public:
  explicit MiniPopupWidgetDelegate(std::unique_ptr<MiniPopupView> contents) {
    contents_ = SetContentsView(std::move(contents));
    SetCanActivate(true);
    SetShowTitle(false);
    SetHasWindowSizeControls(false);
  }
  MiniPopupWidgetDelegate(const MiniPopupWidgetDelegate&) = delete;
  MiniPopupWidgetDelegate& operator=(const MiniPopupWidgetDelegate&) = delete;
  ~MiniPopupWidgetDelegate() override = default;

  MiniPopupView* contents() { return contents_; }

  std::unique_ptr<views::FrameView> CreateFrameView(
      views::Widget* widget) override {
    return std::make_unique<MiniPopupFrameView>();
  }

 private:
  raw_ptr<MiniPopupView> contents_ = nullptr;
};

gfx::Size SizeForState(const std::string& state) {
  if (state == "expanded") {
    return gfx::Size(420, 640);
  }
  if (state == "compact-with-attachments") {
    return gfx::Size(420, 360);
  }
  return gfx::Size(420, 220);
}
}  // namespace

MiniPopupService::MiniPopupService(Profile* profile) : profile_(profile) {}

MiniPopupService::~MiniPopupService() = default;

// static
MiniPopupService* MiniPopupService::Get(
    content::BrowserContext* browser_context) {
  return MiniPopupServiceFactory::GetForBrowserContext(browser_context);
}

bool MiniPopupService::EnsureWindow(const Extension& extension) {
  if (widget_) {
    return true;
  }
  // Find a browser window on this profile to host + parent the popup.
  BrowserWindowInterface* browser = nullptr;
  ForEachCurrentBrowserWindowInterfaceOrderedByActivation(
      [&](BrowserWindowInterface* candidate) {
        if (candidate->GetProfile() == profile_) {
          browser = candidate;
          return false;  // stop iterating
        }
        return true;
      });
  if (!browser) {
    return false;
  }

  const GURL url = extension.GetResourceURL("minipopup.html");
  std::unique_ptr<ExtensionViewHost> host =
      ExtensionViewHostFactory::CreatePopupHost(extension, url, browser);
  if (!host) {
    return false;
  }

  auto view = std::make_unique<MiniPopupView>(profile_, std::move(host));
  auto delegate = std::make_unique<MiniPopupWidgetDelegate>(std::move(view));
  view_ = delegate->contents();

  views::Widget::InitParams params(
      views::Widget::InitParams::CLIENT_OWNS_WIDGET,
      views::Widget::InitParams::TYPE_WINDOW);
  params.context = browser->GetWindow()->GetNativeWindow();
  params.delegate = delegate.get();
  params.remove_standard_frame = true;
  params.z_order = ui::ZOrderLevel::kFloatingWindow;
  params.name = "AsideMiniPopup";
  params.bounds = gfx::Rect(0, 0, 420, 220);

  widget_ = std::make_unique<views::Widget>();
  widget_->Init(std::move(params));
  delegate_ = std::move(delegate);
  widget_->CenterWindow(gfx::Size(420, 220));
  widget_->Show();
  if (view_ && view_->host()) {
    view_->host()->host_contents()->Focus();
  }
  return true;
}

void MiniPopupService::ResizeTo(int width, int height) {
  if (widget_) {
    widget_->SetSize(gfx::Size(width, height));
  }
}

void MiniPopupService::SetState(const Extension& extension,
                                const std::string& state) {
  if (!EnsureWindow(extension)) {
    return;
  }
  const gfx::Size size = SizeForState(state);
  ResizeTo(size.width(), size.height());
}

void MiniPopupService::SetSize(const Extension& extension,
                               int width,
                               int height) {
  if (!EnsureWindow(extension)) {
    return;
  }
  ResizeTo(width, height);
}

void MiniPopupService::Hide() {
  if (widget_) {
    widget_->Hide();
  }
}

void MiniPopupService::Shutdown() {
  view_ = nullptr;
  widget_.reset();
  delegate_.reset();
}

}  // namespace extensions
