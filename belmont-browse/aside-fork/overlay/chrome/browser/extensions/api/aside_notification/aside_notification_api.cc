// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/extensions/api/aside_notification/aside_notification_api.h"

#include "chrome/browser/notifications/aside_inbox_delivery.h"

#include <optional>
#include <string>

#include "base/values.h"
#include "chrome/browser/content_settings/host_content_settings_map_factory.h"
#include "chrome/browser/extensions/extension_tab_util.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/common/extensions/api/aside_notification.h"
#include "components/content_settings/core/browser/host_content_settings_map.h"
#include "components/content_settings/core/common/content_settings.h"
#include "components/content_settings/core/common/content_settings_types.h"
#include "components/prefs/pref_service.h"
#include "components/prefs/scoped_user_pref_update.h"
#include "content/public/browser/web_contents.h"
#include "extensions/common/extension.h"
#include "extensions/common/mojom/api_permission_id.mojom.h"
#include "extensions/common/permissions/permissions_data.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace extensions {

namespace {

// RE 0x3f39714 / 0x3f39bb0: the original keeps its own per-origin ledger of
// AI-notification delivery modes in this profile dict pref (origin -> mode 1),
// in addition to the Chromium notification content setting.
constexpr char kDeliveryModeByOriginPref[] =
    "persistent_notifications.ai_delivery_mode_by_origin";
constexpr int kDeliveryModeDefault = 1;

// RE 0x3f393f4: the handler re-checks the private entitlement at runtime.
bool HasPrivateEntitlement(const Extension* extension) {
  return extension && extension->permissions_data()->HasAPIPermission(
                          mojom::APIPermissionID::kAsideNotification);
}

}  // namespace

ExtensionFunction::ResponseAction AsideNotificationRequestPermissionFunction::Run() {
  if (!HasPrivateEntitlement(extension())) {
    return RespondNow(Error("Permission denied: missing private entitlements"));
  }
  std::optional<api::aside_notification::RequestPermission::Params> params =
      api::aside_notification::RequestPermission::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid tabId for requestPermission"));
  }
  Profile* profile = Profile::FromBrowserContext(browser_context());
  content::WebContents* contents = nullptr;
  if (!ExtensionTabUtil::GetTabById(params->tab_id, profile,
                                    include_incognito_information(),
                                    &contents) ||
      !contents) {
    return RespondNow(Error("Invalid tabId for requestPermission"));
  }
  // RE 0x3f39564: only http(s) tab origins are eligible.
  const GURL& tab_url = contents->GetLastCommittedURL();
  if (!tab_url.is_valid() || !tab_url.SchemeIsHTTPOrHTTPS()) {
    return RespondNow(
        Error("Tab URL is not eligible for notification permission"));
  }
  const url::Origin origin = url::Origin::Create(tab_url);
  {
    ScopedDictPrefUpdate update(profile->GetPrefs(), kDeliveryModeByOriginPref);
    update->Set(origin.Serialize(), kDeliveryModeDefault);
  }
  // RE 0x3f397b4: content setting ALLOW (1) for the origin.
  if (HostContentSettingsMap* map =
          HostContentSettingsMapFactory::GetForProfile(profile)) {
    aside::ScopedPermissionChangeSource source("default");
    map->SetContentSettingDefaultScope(origin.GetURL(), GURL(),
                                       ContentSettingsType::NOTIFICATIONS,
                                       CONTENT_SETTING_ALLOW);
  }
  return RespondNow(WithArguments(true));
}

ExtensionFunction::ResponseAction AsideNotificationRevokePermissionFunction::Run() {
  if (!HasPrivateEntitlement(extension())) {
    return RespondNow(Error("Permission denied: missing private entitlements"));
  }
  std::optional<api::aside_notification::RevokePermission::Params> params =
      api::aside_notification::RevokePermission::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid origin for revokePermission"));
  }
  const GURL origin_url(params->origin);
  if (!origin_url.is_valid() || !origin_url.SchemeIsHTTPOrHTTPS()) {
    return RespondNow(Error("Invalid origin for revokePermission"));
  }
  Profile* profile = Profile::FromBrowserContext(browser_context());
  const url::Origin origin = url::Origin::Create(origin_url);
  {
    ScopedDictPrefUpdate update(profile->GetPrefs(), kDeliveryModeByOriginPref);
    update->Remove(origin.Serialize());
  }
  // RE 0x3f39b84: content setting back to DEFAULT (0).
  if (HostContentSettingsMap* map =
          HostContentSettingsMapFactory::GetForProfile(profile)) {
    aside::ScopedPermissionChangeSource source("default");
    map->SetContentSettingDefaultScope(origin.GetURL(), GURL(),
                                       ContentSettingsType::NOTIFICATIONS,
                                       CONTENT_SETTING_DEFAULT);
  }
  return RespondNow(WithArguments(true));
}

}  // namespace extensions
