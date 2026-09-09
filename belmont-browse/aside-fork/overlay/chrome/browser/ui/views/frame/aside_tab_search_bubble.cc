// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/views/frame/aside_tab_search_bubble.h"

#include <memory>

#include "chrome/browser/profiles/profile.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/common/extension.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/mojom/dialog_button.mojom.h"
#include "ui/gfx/geometry/insets.h"
#include "ui/gfx/geometry/size.h"
#include "base/functional/bind.h"
#include "ui/views/bubble/bubble_border.h"
#include "ui/views/bubble/bubble_dialog_delegate_view.h"
#include "ui/views/layout/fill_layout.h"
#include "ui/views/widget/widget.h"
#include "url/gurl.h"

namespace {

constexpr char kAsideExtensionId[] = "fjdhphbdlfjogobdofoaagnlnkoibdge";
constexpr char kTabSearchPage[] = "tabsearch.html";
// The page sizes itself; keep the bubble within a sidebar-friendly range.
constexpr gfx::Size kMinSize(320, 240);
constexpr gfx::Size kMaxSize(560, 820);

}  // namespace

AsideTabSearchWebView::AsideTabSearchWebView(Profile* profile)
    : views::WebView(profile) {
  EnableSizingFromWebContents(kMinSize, kMaxSize);
  SetPreferredSize(kMinSize);
}

AsideTabSearchWebView::~AsideTabSearchWebView() = default;

BEGIN_METADATA(AsideTabSearchWebView)
END_METADATA

AsideTabSearchBubbleContentsView::AsideTabSearchBubbleContentsView(
    Profile* profile) {
  SetLayoutManager(std::make_unique<views::FillLayout>());
  web_view_ = AddChildView(std::make_unique<AsideTabSearchWebView>(profile));
  web_view_->LoadInitialURL(GURL("chrome-extension://" +
                                 std::string(kAsideExtensionId) + "/" +
                                 kTabSearchPage));
}

AsideTabSearchBubbleContentsView::~AsideTabSearchBubbleContentsView() = default;

namespace {

// Owns the delegate and the widget (CLIENT_OWNS_WIDGET) for one bubble
// instance and deletes itself when the bubble closes; the delegate must
// outlive the widget, so it is declared first (destroyed last).
class AsideTabSearchBubbleController {
 public:
  AsideTabSearchBubbleController(views::View* anchor, Profile* profile) {
    delegate_ = std::make_unique<views::BubbleDialogDelegate>(
        anchor, views::BubbleBorder::TOP_LEFT);
    delegate_->SetButtons(static_cast<int>(ui::mojom::DialogButton::kNone));
    delegate_->SetShowCloseButton(false);
    delegate_->SetShowTitle(false);
    delegate_->set_margins(gfx::Insets());
    auto contents = std::make_unique<AsideTabSearchBubbleContentsView>(profile);
    delegate_->SetInitiallyFocusedView(contents->web_view());
    delegate_->SetContentsView(std::move(contents));
    widget_ = views::BubbleDialogDelegate::CreateBubble(
        delegate_.get(),
        base::BindOnce(&AsideTabSearchBubbleController::OnClosed,
                       base::Unretained(this)));
    widget_->Show();
  }

 private:
  void OnClosed(views::Widget::ClosedReason) { delete this; }

  std::unique_ptr<views::BubbleDialogDelegate> delegate_;
  std::unique_ptr<views::Widget> widget_;
};

}  // namespace

// static
bool AsideTabSearchBubbleContentsView::MaybeShow(views::View* anchor,
                                                 Profile* profile) {
  if (!anchor || !profile) {
    return false;
  }
  extensions::ExtensionRegistry* registry =
      extensions::ExtensionRegistry::Get(profile);
  if (!registry || !registry->enabled_extensions().GetByID(kAsideExtensionId)) {
    return false;
  }
  new AsideTabSearchBubbleController(anchor, profile);  // self-deleting
  return true;
}

BEGIN_METADATA(AsideTabSearchBubbleContentsView)
END_METADATA
