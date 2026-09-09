// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_SIGNIN_ASIDE_PROFILE_ATTRIBUTES_UPDATER_FACTORY_H_
#define CHROME_BROWSER_SIGNIN_ASIDE_PROFILE_ATTRIBUTES_UPDATER_FACTORY_H_

#include "base/no_destructor.h"
#include "chrome/browser/profiles/profile_keyed_service_factory.h"

class AsideProfileAttributesUpdater;
class Profile;

class AsideProfileAttributesUpdaterFactory : public ProfileKeyedServiceFactory {
 public:
  static AsideProfileAttributesUpdater* GetForProfile(Profile* profile);
  static AsideProfileAttributesUpdaterFactory* GetInstance();

 private:
  friend base::NoDestructor<AsideProfileAttributesUpdaterFactory>;
  AsideProfileAttributesUpdaterFactory();
  ~AsideProfileAttributesUpdaterFactory() override;

  std::unique_ptr<KeyedService> BuildServiceInstanceForBrowserContext(
      content::BrowserContext* context) const override;
  bool ServiceIsCreatedWithBrowserContext() const override;
};

#endif  // CHROME_BROWSER_SIGNIN_ASIDE_PROFILE_ATTRIBUTES_UPDATER_FACTORY_H_
