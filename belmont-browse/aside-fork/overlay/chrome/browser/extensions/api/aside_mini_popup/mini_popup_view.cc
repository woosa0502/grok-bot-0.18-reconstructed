// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/extensions/api/aside_mini_popup/mini_popup_view.h"

#include <utility>

#include "chrome/browser/extensions/extension_view_host.h"
#include "ui/views/layout/fill_layout.h"

namespace extensions {

MiniPopupView::MiniPopupView(Profile* profile,
                             std::unique_ptr<ExtensionViewHost> host)
    : host_(std::move(host)) {
  SetLayoutManager(std::make_unique<views::FillLayout>());
  extension_view_ =
      AddChildView(std::make_unique<ExtensionViewViews>(profile, host_.get()));
  extension_view_->SetContainer(this);
  extension_view_->Init();
}

MiniPopupView::~MiniPopupView() {
  if (extension_view_) {
    std::unique_ptr<views::View> owned =
        RemoveChildViewT(extension_view_.get());
    extension_view_ = nullptr;
  }
  host_.reset();
}

gfx::Size MiniPopupView::GetMinBounds() {
  return gfx::Size(200, 120);
}

gfx::Size MiniPopupView::GetMaxBounds() {
  return gfx::Size(1200, 900);
}

}  // namespace extensions
