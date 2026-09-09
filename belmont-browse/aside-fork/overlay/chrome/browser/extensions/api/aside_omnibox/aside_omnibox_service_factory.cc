// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/extensions/api/aside_omnibox/aside_omnibox_service_factory.h"

#include "chrome/browser/extensions/api/aside_omnibox/aside_omnibox_service.h"
#include "chrome/browser/profiles/profile.h"

namespace extensions {

// static
AsideOmniboxService* AsideOmniboxServiceFactory::GetForBrowserContext(
    content::BrowserContext* browser_context) {
  return static_cast<AsideOmniboxService*>(
      GetInstance()->GetServiceForBrowserContext(browser_context,
                                                 /*create=*/true));
}

// static
AsideOmniboxServiceFactory* AsideOmniboxServiceFactory::GetInstance() {
  static base::NoDestructor<AsideOmniboxServiceFactory> instance;
  return instance.get();
}

AsideOmniboxServiceFactory::AsideOmniboxServiceFactory()
    : ProfileKeyedServiceFactory("AsideOmniboxService") {}

AsideOmniboxServiceFactory::~AsideOmniboxServiceFactory() = default;

std::unique_ptr<KeyedService>
AsideOmniboxServiceFactory::BuildServiceInstanceForBrowserContext(
    content::BrowserContext* context) const {
  return std::make_unique<AsideOmniboxService>(
      Profile::FromBrowserContext(context));
}

}  // namespace extensions
