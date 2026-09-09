// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/signin/aside_profile_attributes_updater_factory.h"

#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/signin/aside_profile_attributes_updater.h"

// static
AsideProfileAttributesUpdater*
AsideProfileAttributesUpdaterFactory::GetForProfile(Profile* profile) {
  return static_cast<AsideProfileAttributesUpdater*>(
      GetInstance()->GetServiceForBrowserContext(profile, true));
}

// static
AsideProfileAttributesUpdaterFactory*
AsideProfileAttributesUpdaterFactory::GetInstance() {
  static base::NoDestructor<AsideProfileAttributesUpdaterFactory> instance;
  return instance.get();
}

AsideProfileAttributesUpdaterFactory::AsideProfileAttributesUpdaterFactory()
    : ProfileKeyedServiceFactory(
          "AsideProfileAttributesUpdater",
          ProfileSelections::Builder()
              .WithRegular(ProfileSelection::kOriginalOnly)
              .Build()) {}

AsideProfileAttributesUpdaterFactory::~AsideProfileAttributesUpdaterFactory() =
    default;

std::unique_ptr<KeyedService>
AsideProfileAttributesUpdaterFactory::BuildServiceInstanceForBrowserContext(
    content::BrowserContext* context) const {
  return std::make_unique<AsideProfileAttributesUpdater>(
      Profile::FromBrowserContext(context));
}

bool AsideProfileAttributesUpdaterFactory::ServiceIsCreatedWithBrowserContext()
    const {
  return true;
}
