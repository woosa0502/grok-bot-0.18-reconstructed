// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/notifications/aside_inbox_delivery.h"

#include <optional>
#include <utility>
#include <vector>

#include "base/base64.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/json/json_writer.h"
#include "base/logging.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "base/uuid.h"
#include "base/values.h"
#include "chrome/browser/content_settings/host_content_settings_map_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/aside/aside_extension_bridge.h"
#include "components/content_settings/core/common/content_settings.h"
#include "components/content_settings/core/common/content_settings_pattern.h"
#include "components/content_settings/core/common/content_settings_types.h"
#include "components/prefs/pref_service.h"
#include "third_party/blink/public/common/notifications/notification_resources.h"
#include "third_party/blink/public/common/notifications/platform_notification_data.h"
#include "ui/gfx/codec/png_codec.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace aside {

namespace {

constexpr char kDeliveryModeByOriginPref[] =
    "persistent_notifications.ai_delivery_mode_by_origin";
constexpr char kInboxDirName[] = "AsideInbox";
const char* g_permission_change_source = "native_ui";

bool IsAiDelivery(Profile* profile, const GURL& origin) {
  if (!profile) {
    return false;
  }
  const base::DictValue& modes =
      profile->GetPrefs()->GetDict(kDeliveryModeByOriginPref);
  const std::string key = url::Origin::Create(origin).Serialize();
  return modes.FindInt(key).value_or(0) != 0;
}

// Writes the payload as <profile>/AsideInbox/<entry id>.json (blocking).
bool StoreInboxEntry(base::FilePath dir, std::string entry_id, std::string json) {
  if (!base::CreateDirectory(dir)) {
    return false;
  }
  return base::WriteFile(dir.AppendASCII(entry_id + ".json"), json);
}

void DispatchInbox(Profile* profile, base::DictValue payload, bool stored) {
  if (!stored) {
    payload.Set("inbox_store_failed", true);
  }
  SendExternalMessage(profile, "aside.inboxNotification", std::move(payload));
}

}  // namespace

bool MaybeDeliverNotificationToAside(
    Profile* profile,
    const std::string& notification_id,
    const GURL& origin,
    const GURL& context_url,
    const blink::PlatformNotificationData& notification_data,
    const blink::NotificationResources& notification_resources) {
  if (!IsAiDelivery(profile, origin) || !IsExtensionEnabled(profile)) {
    return false;
  }
  const std::string entry_id = base::Uuid::GenerateRandomV4().AsLowercaseString();
  VLOG(1) << "aside: delivering notification " << notification_id << " from "
          << origin.spec() << " to the inbox (" << entry_id << ")";
  base::DictValue payload;
  payload.Set("site_url", url::Origin::Create(origin).Serialize());
  payload.Set("notification_id", notification_id);
  payload.Set("inbox_entry_id", entry_id);
  if (context_url.is_valid()) {
    payload.Set("context_url", context_url.spec());
  }
  payload.Set("title", base::UTF16ToUTF8(notification_data.title));
  payload.Set("body", base::UTF16ToUTF8(notification_data.body));
  if (!notification_data.tag.empty()) {
    payload.Set("tag", notification_data.tag);
  }
  if (!notification_resources.notification_icon.drawsNothing()) {
    std::optional<std::vector<uint8_t>> png = gfx::PNGCodec::EncodeBGRASkBitmap(
        notification_resources.notification_icon, /*discard_transparency=*/false);
    if (png) {
      payload.Set("image_png_base64", base::Base64Encode(*png));
    }
  }
  payload.Set("timestamp",
              static_cast<double>(base::Time::Now().InMillisecondsSinceUnixEpoch()));

  std::string json;
  base::JSONWriter::Write(payload, &json);
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::MayBlock(), base::TaskPriority::USER_VISIBLE},
      base::BindOnce(&StoreInboxEntry,
                     profile->GetPath().AppendASCII(kInboxDirName), entry_id,
                     json),
      base::BindOnce(&DispatchInbox, profile, std::move(payload)));
  return true;
}

ScopedPermissionChangeSource::ScopedPermissionChangeSource(const char* source) {
  g_permission_change_source = source;
}

ScopedPermissionChangeSource::~ScopedPermissionChangeSource() {
  g_permission_change_source = "native_ui";
}

void NotifyPermissionChanged(Profile* profile,
                             const GURL& origin,
                             const std::string& source) {
  if (!profile || !IsExtensionEnabled(profile)) {
    return;
  }
  VLOG(1) << "aside: notification permission changed for " << origin.spec()
          << " (" << source << ")";
  HostContentSettingsMap* map =
      HostContentSettingsMapFactory::GetForProfile(profile);
  ContentSetting setting =
      map ? map->GetContentSetting(origin, origin,
                                   ContentSettingsType::NOTIFICATIONS)
          : CONTENT_SETTING_DEFAULT;
  std::string permission = "default";
  if (setting == CONTENT_SETTING_ALLOW) {
    permission = IsAiDelivery(profile, origin) ? "allow_for_ai" : "allow";
  } else if (setting == CONTENT_SETTING_BLOCK) {
    permission = "deny";
  }
  base::DictValue payload;
  payload.Set("origin", url::Origin::Create(origin).Serialize());
  payload.Set("permission", permission);
  payload.Set("source", source);
  payload.Set("timestamp",
              static_cast<double>(base::Time::Now().InMillisecondsSinceUnixEpoch()));
  SendExternalMessage(profile, "aside.notificationPermissionChanged",
                      std::move(payload));
}

NotificationSyncService::NotificationSyncService(Profile* profile)
    : profile_(profile) {
  if (HostContentSettingsMap* map =
          HostContentSettingsMapFactory::GetForProfile(profile_)) {
    observation_.Observe(map);
  }
}

NotificationSyncService::~NotificationSyncService() = default;

void NotificationSyncService::Shutdown() {
  observation_.Reset();
  profile_ = nullptr;
}

void NotificationSyncService::OnContentSettingChanged(
    const ContentSettingsPattern& primary_pattern,
    const ContentSettingsPattern& secondary_pattern,
    ContentSettingsTypeSet content_type_set) {
  if (!profile_ || !content_type_set.Contains(ContentSettingsType::NOTIFICATIONS)) {
    return;
  }
  // Only concrete origins can be reported (wildcard resets are skipped).
  const GURL origin(primary_pattern.ToString());
  if (!origin.is_valid() || primary_pattern.MatchesAllHosts()) {
    return;
  }
  NotifyPermissionChanged(profile_, origin, g_permission_change_source);
}

}  // namespace aside
