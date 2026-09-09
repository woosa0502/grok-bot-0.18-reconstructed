// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/extensions/api/aside_mini_popup/mini_popup_service_factory.h"

#include "chrome/browser/extensions/api/aside_mini_popup/mini_popup_service.h"
#include "chrome/browser/profiles/profile.h"

namespace extensions {

// static
MiniPopupService* MiniPopupServiceFactory::GetForBrowserContext(
    content::BrowserContext* browser_context) {
  return static_cast<MiniPopupService*>(
      GetInstance()->GetServiceForBrowserContext(browser_context,
                                                 /*create=*/true));
}

// static
MiniPopupServiceFactory* MiniPopupServiceFactory::GetInstance() {
  static base::NoDestructor<MiniPopupServiceFactory> instance;
  return instance.get();
}

MiniPopupServiceFactory::MiniPopupServiceFactory()
    : ProfileKeyedServiceFactory("AsideMiniPopupService") {}

MiniPopupServiceFactory::~MiniPopupServiceFactory() = default;

std::unique_ptr<KeyedService>
MiniPopupServiceFactory::BuildServiceInstanceForBrowserContext(
    content::BrowserContext* context) const {
  return std::make_unique<MiniPopupService>(
      Profile::FromBrowserContext(context));
}

}  // namespace extensions
