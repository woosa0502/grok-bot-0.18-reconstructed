// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_EXTENSIONS_API_ASIDE_OMNIBOX_ASIDE_OMNIBOX_SERVICE_FACTORY_H_
#define CHROME_BROWSER_EXTENSIONS_API_ASIDE_OMNIBOX_ASIDE_OMNIBOX_SERVICE_FACTORY_H_

#include "base/no_destructor.h"
#include "chrome/browser/profiles/profile_keyed_service_factory.h"

namespace content {
class BrowserContext;
}

namespace extensions {

class AsideOmniboxService;

class AsideOmniboxServiceFactory : public ProfileKeyedServiceFactory {
 public:
  static AsideOmniboxService* GetForBrowserContext(
      content::BrowserContext* browser_context);
  static AsideOmniboxServiceFactory* GetInstance();

  AsideOmniboxServiceFactory(const AsideOmniboxServiceFactory&) = delete;
  AsideOmniboxServiceFactory& operator=(const AsideOmniboxServiceFactory&) =
      delete;

 private:
  friend base::NoDestructor<AsideOmniboxServiceFactory>;
  AsideOmniboxServiceFactory();
  ~AsideOmniboxServiceFactory() override;

  std::unique_ptr<KeyedService> BuildServiceInstanceForBrowserContext(
      content::BrowserContext* context) const override;
};

}  // namespace extensions

#endif  // CHROME_BROWSER_EXTENSIONS_API_ASIDE_OMNIBOX_ASIDE_OMNIBOX_SERVICE_FACTORY_H_
