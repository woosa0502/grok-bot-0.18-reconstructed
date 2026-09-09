// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_EXTENSIONS_API_ASIDE_ACCOUNT_ASIDE_ACCOUNT_API_H_
#define CHROME_BROWSER_EXTENSIONS_API_ASIDE_ACCOUNT_ASIDE_ACCOUNT_API_H_

#include "extensions/browser/extension_function.h"

namespace extensions {

class AsideAccountGetProfileContextFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideAccount.getProfileContext",
                             ASIDEACCOUNT_GETPROFILECONTEXT)

 private:
  ~AsideAccountGetProfileContextFunction() final = default;
  ResponseAction Run() final;
};

class AsideAccountGetProfilesFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideAccount.getProfiles", ASIDEACCOUNT_GETPROFILES)

 private:
  ~AsideAccountGetProfilesFunction() final = default;
  ResponseAction Run() final;
};

class AsideAccountSignDaemonAuthChallengeFunction final
    : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideAccount.signDaemonAuthChallenge",
                             ASIDEACCOUNT_SIGNDAEMONAUTHCHALLENGE)

 private:
  ~AsideAccountSignDaemonAuthChallengeFunction() final = default;
  ResponseAction Run() final;
};

}  // namespace extensions

#endif  // CHROME_BROWSER_EXTENSIONS_API_ASIDE_ACCOUNT_ASIDE_ACCOUNT_API_H_
