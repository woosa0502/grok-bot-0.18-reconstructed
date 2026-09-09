// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/notifications/aside_notification_sync_service_factory.h"

#include "chrome/browser/content_settings/host_content_settings_map_factory.h"
#include "chrome/browser/notifications/aside_inbox_delivery.h"
#include "chrome/browser/profiles/profile.h"

// static
AsideNotificationSyncServiceFactory*
AsideNotificationSyncServiceFactory::GetInstance() {
  static base::NoDestructor<AsideNotificationSyncServiceFactory> instance;
  return instance.get();
}

AsideNotificationSyncServiceFactory::AsideNotificationSyncServiceFactory()
    : ProfileKeyedServiceFactory(
          "AsideNotificationSyncService",
          ProfileSelections::Builder()
              .WithRegular(ProfileSelection::kOriginalOnly)
              .Build()) {
  DependsOn(HostContentSettingsMapFactory::GetInstance());
}

AsideNotificationSyncServiceFactory::~AsideNotificationSyncServiceFactory() =
    default;

std::unique_ptr<KeyedService>
AsideNotificationSyncServiceFactory::BuildServiceInstanceForBrowserContext(
    content::BrowserContext* context) const {
  return std::make_unique<aside::NotificationSyncService>(
      Profile::FromBrowserContext(context));
}

bool AsideNotificationSyncServiceFactory::ServiceIsCreatedWithBrowserContext()
    const {
  return true;
}
