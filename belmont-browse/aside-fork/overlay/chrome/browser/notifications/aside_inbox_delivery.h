// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_NOTIFICATIONS_ASIDE_INBOX_DELIVERY_H_
#define CHROME_BROWSER_NOTIFICATIONS_ASIDE_INBOX_DELIVERY_H_

#include <string>

#include "base/memory/raw_ptr.h"
#include "base/scoped_observation.h"
#include "components/content_settings/core/browser/content_settings_observer.h"
#include "components/content_settings/core/browser/host_content_settings_map.h"
#include "components/keyed_service/core/keyed_service.h"

class GURL;
class Profile;

namespace blink {
struct NotificationResources;
struct PlatformNotificationData;
}  // namespace blink

namespace aside {

// Web notifications from origins whose delivery mode is "AI"
// (persistent_notifications.ai_delivery_mode_by_origin, set by
// asideNotification.requestPermission) are not shown; instead the payload is
// stored in the profile's AsideInbox and handed to the Aside extension as an
// external runtime message {type:"aside.inboxNotification", site_url,
// notification_id, inbox_entry_id, context_url, title, body,
// image_png_base64, timestamp}. RE: original
// chrome/browser/notifications/platform_notification_service_impl.cc
// (SaveAsideInboxPayloadAndDispatch, "AsideInbox", "inbox_store_failed").
// Returns true when the notification was taken over.
bool MaybeDeliverNotificationToAside(
    Profile* profile,
    const std::string& notification_id,
    const GURL& origin,
    const GURL& context_url,
    const blink::PlatformNotificationData& notification_data,
    const blink::NotificationResources& notification_resources);

// Tells the extension about a notification permission change:
// {type:"aside.notificationPermissionChanged", origin, permission
// ("allow"|"deny"|"allow_for_ai"|"default"), source ("native_ui"|"default"),
// timestamp}.
void NotifyPermissionChanged(Profile* profile,
                             const GURL& origin,
                             const std::string& source);

// While alive, permission changes observed by NotificationSyncService are
// reported with `source` (the asideNotification API uses "default") instead
// of "native_ui".
class ScopedPermissionChangeSource {
 public:
  explicit ScopedPermissionChangeSource(const char* source);
  ~ScopedPermissionChangeSource();
};

// Watches the profile's notification content settings and reports changes
// made from the native UI (page info, prompts) to the extension.
class NotificationSyncService : public KeyedService,
                                public content_settings::Observer {
 public:
  explicit NotificationSyncService(Profile* profile);
  ~NotificationSyncService() override;

  // content_settings::Observer:
  void OnContentSettingChanged(
      const ContentSettingsPattern& primary_pattern,
      const ContentSettingsPattern& secondary_pattern,
      ContentSettingsTypeSet content_type_set) override;

  // KeyedService:
  void Shutdown() override;

 private:
  raw_ptr<Profile> profile_;
  base::ScopedObservation<HostContentSettingsMap, content_settings::Observer>
      observation_{this};
};

}  // namespace aside

#endif  // CHROME_BROWSER_NOTIFICATIONS_ASIDE_INBOX_DELIVERY_H_
