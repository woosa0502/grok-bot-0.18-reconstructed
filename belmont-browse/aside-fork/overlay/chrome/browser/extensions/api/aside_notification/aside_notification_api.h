// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_EXTENSIONS_API_ASIDE_NOTIFICATION_ASIDE_NOTIFICATION_API_H_
#define CHROME_BROWSER_EXTENSIONS_API_ASIDE_NOTIFICATION_ASIDE_NOTIFICATION_API_H_

#include "extensions/browser/extension_function.h"

namespace extensions {

class AsideNotificationRequestPermissionFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideNotification.requestPermission", ASIDENOTIFICATION_REQUESTPERMISSION)

 private:
  ~AsideNotificationRequestPermissionFunction() final = default;
  ResponseAction Run() final;
};

class AsideNotificationRevokePermissionFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideNotification.revokePermission", ASIDENOTIFICATION_REVOKEPERMISSION)

 private:
  ~AsideNotificationRevokePermissionFunction() final = default;
  ResponseAction Run() final;
};

}  // namespace extensions

#endif  // CHROME_BROWSER_EXTENSIONS_API_ASIDE_NOTIFICATION_ASIDE_NOTIFICATION_API_H_
