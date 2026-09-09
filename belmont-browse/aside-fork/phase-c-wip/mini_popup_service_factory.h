// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_EXTENSIONS_API_ASIDE_MINI_POPUP_MINI_POPUP_SERVICE_FACTORY_H_
#define CHROME_BROWSER_EXTENSIONS_API_ASIDE_MINI_POPUP_MINI_POPUP_SERVICE_FACTORY_H_

#include "base/no_destructor.h"
#include "chrome/browser/profiles/profile_keyed_service_factory.h"

namespace content {
class BrowserContext;
}

namespace extensions {

class MiniPopupService;

class MiniPopupServiceFactory : public ProfileKeyedServiceFactory {
 public:
  static MiniPopupService* GetForBrowserContext(
      content::BrowserContext* browser_context);
  static MiniPopupServiceFactory* GetInstance();

  MiniPopupServiceFactory(const MiniPopupServiceFactory&) = delete;
  MiniPopupServiceFactory& operator=(const MiniPopupServiceFactory&) = delete;

 private:
  friend base::NoDestructor<MiniPopupServiceFactory>;
  MiniPopupServiceFactory();
  ~MiniPopupServiceFactory() override;

  // BrowserContextKeyedServiceFactory:
  std::unique_ptr<KeyedService> BuildServiceInstanceForBrowserContext(
      content::BrowserContext* context) const override;
};

}  // namespace extensions

#endif  // CHROME_BROWSER_EXTENSIONS_API_ASIDE_MINI_POPUP_MINI_POPUP_SERVICE_FACTORY_H_
