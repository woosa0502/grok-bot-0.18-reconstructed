// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/extensions/api/aside_account/aside_account_api.h"

#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>
#include <utility>
#include <vector>

#include "base/files/file_path.h"
#include "base/strings/utf_string_conversions.h"
#include "base/values.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/profiles/profile.h"
#include "components/prefs/pref_service.h"
#include "chrome/browser/profiles/profile_attributes_entry.h"
#include "chrome/browser/profiles/profile_attributes_storage.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/common/extensions/api/aside_account.h"

#include "base/base64.h"
#include "base/strings/string_number_conversions.h"
#include "base/environment.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "crypto/keypair.h"
#include "crypto/sign.h"

namespace extensions {

namespace {
namespace aside_account = api::aside_account;

// Daemon auth signing input prefix (matches the original Aside daemon protocol).
constexpr char kDaemonAuthPrefix[] = "Aside Daemon Auth v1";

// Loads the per-installation P-256 private key (PKCS#8 DER). The path comes from
// the ASIDE_INSTALLATION_KEY env var, else <profile>/AsideInstallationKey. This
// is the key the Aside daemon trusts for this installation.
std::optional<std::vector<uint8_t>> LoadInstallationKeyDer(Profile* profile) {
  base::FilePath path;
  std::unique_ptr<base::Environment> env = base::Environment::Create();
  std::optional<std::string> env_path = env->GetVar("ASIDE_INSTALLATION_KEY");
  if (env_path && !env_path->empty()) {
    path = base::FilePath::FromUTF8Unsafe(*env_path);
  } else if (profile) {
    path = profile->GetPath().Append(FILE_PATH_LITERAL("AsideInstallationKey"));
  }
  if (path.empty()) {
    return std::nullopt;
  }
  std::string contents;
  if (!base::ReadFileToString(path, &contents)) {
    return std::nullopt;
  }
  return std::vector<uint8_t>(contents.begin(), contents.end());
}
}  // namespace

ExtensionFunction::ResponseAction
AsideAccountGetProfileContextFunction::Run() {
  // Contract (from the Aside extension's K(e) serializer + the daemon):
  //   { boundAccountId, boundUserId, profileId, profileIndex, profilePath }
  // profileId/boundAccountId/boundUserId mirror the original's account-bound
  // state (macOS keychain/account on the original); here they are injected via
  // env to match what the daemon was provisioned with, exactly as the belmont
  // shim did. profilePath/profileIndex come from Chromium.
  Profile* profile = Profile::FromBrowserContext(browser_context());
  base::DictValue dict;

  std::string profile_path =
      profile ? profile->GetPath().AsUTF8Unsafe() : std::string();
  std::optional<int> profile_index;
  if (profile) {
    ProfileManager* profile_manager = g_browser_process->profile_manager();
    if (profile_manager) {
      ProfileAttributesStorage& storage =
          profile_manager->GetProfileAttributesStorage();
      int index = 0;
      for (ProfileAttributesEntry* entry : storage.GetAllProfilesAttributes()) {
        if (entry->GetPath() == profile->GetPath()) {
          profile_index = index;
          break;
        }
        ++index;
      }
    }
  }

  // Value sources reverse-engineered from the original binary (getProfileContext
  // @VA 0x404e7e0-0x404e9bc): boundAccountId <- pref "aside.account_id",
  // boundUserId <- pref "aside.account_user_id". profileId/profileIndex/profilePath come
  // from the profile object (matched below). ASIDE_PROFILE_ID env overrides
  // profileId for the belmont daemon provisioning.
  PrefService* prefs = profile ? profile->GetPrefs() : nullptr;
  // RE 0x404e7c8..0x404e96c (adversarial verification): every field is emitted
  // only when it has a value — profileId/profilePath/boundUserId when non-empty,
  // profileIndex when known, boundAccountId when aside.account_id >= 0
  // (tbnz w0,#31 -> skip). The daemon's zod schema relies on this (boundUserId
  // min 1 char, boundAccountId >= 0). Missing profileId is an error.
  // profileId <- pref "aside.profile_id" (RE 0x3f37cac). Fork-only fallback:
  // ASIDE_PROFILE_ID env / profile dir name for belmont daemon provisioning.
  std::string profile_id =
      prefs ? prefs->GetString("aside.profile_id") : std::string();
  if (profile_id.empty()) {
    std::unique_ptr<base::Environment> env = base::Environment::Create();
    profile_id = env->GetVar("ASIDE_PROFILE_ID")
                     .value_or(base::FilePath(profile_path).BaseName().AsUTF8Unsafe());
  }
  if (!profile_id.empty()) {
    dict.Set("profileId", profile_id);
  }
  if (!profile_path.empty()) {
    dict.Set("profilePath", profile_path);
  }
  if (profile_index.has_value()) {
    dict.Set("profileIndex", *profile_index);
  }
  const std::string bound_user_id =
      prefs ? prefs->GetString("aside.account_user_id") : std::string();
  if (!bound_user_id.empty()) {
    dict.Set("boundUserId", bound_user_id);
  }
  if (prefs && prefs->FindPreference("aside.account_id")) {
    const int bound_account_id = prefs->GetInteger("aside.account_id");
    if (bound_account_id >= 0) {
      dict.Set("boundAccountId", bound_account_id);
    }
  }
  if (!dict.Find("profileId")) {
    return RespondNow(Error("Aside account profile context unavailable"));
  }
  return RespondNow(WithArguments(std::move(dict)));
}

ExtensionFunction::ResponseAction AsideAccountGetProfilesFunction::Run() {
  std::vector<aside_account::ProfileInfo> profiles;
  ProfileManager* profile_manager = g_browser_process->profile_manager();
  if (!profile_manager) {
    return RespondNow(Error("Chromium profile manager unavailable"));
  }
  {
    ProfileAttributesStorage& storage =
        profile_manager->GetProfileAttributesStorage();
    Profile* current = Profile::FromBrowserContext(browser_context());
    base::FilePath current_path =
        current ? current->GetPath() : base::FilePath();
    int index = 0;
    for (ProfileAttributesEntry* entry : storage.GetAllProfilesAttributes()) {
      aside_account::ProfileInfo info;
      info.profile_index = index++;
      info.name = base::UTF16ToUTF8(entry->GetName());
      info.is_current = entry->GetPath() == current_path;
      info.is_locked = entry->IsSigninRequired();
      profiles.push_back(std::move(info));
    }
  }
  return RespondNow(
      ArgumentList(aside_account::GetProfiles::Results::Create(profiles)));
}

ExtensionFunction::ResponseAction
AsideAccountSignDaemonAuthChallengeFunction::Run() {
  std::optional<aside_account::SignDaemonAuthChallenge::Params> params =
      aside_account::SignDaemonAuthChallenge::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid daemon auth challenge"));
  }

  Profile* profile = Profile::FromBrowserContext(browser_context());
  base::DictValue dict;

  std::optional<std::vector<uint8_t>> key_der = LoadInstallationKeyDer(profile);
  if (!key_der) {
    return RespondNow(Error("Installation signing key unavailable"));
  }
  std::optional<crypto::keypair::PrivateKey> key =
      crypto::keypair::PrivateKey::FromPrivateKeyInfo(*key_der);
  if (!key) {
    return RespondNow(Error("Installation signing key unavailable"));
  }

  std::string challenge_bytes;
  if (!base::Base64Decode(params->challenge, &challenge_bytes)) {
    return RespondNow(Error("Invalid daemon auth challenge"));
  }

  // Signing input: "Aside Daemon Auth v1\0" || challenge_bytes.
  std::string_view prefix(kDaemonAuthPrefix);
  std::vector<uint8_t> input;
  input.reserve(prefix.size() + 1 + challenge_bytes.size());
  input.insert(input.end(), prefix.begin(), prefix.end());
  input.push_back(0);  // trailing NUL, part of the prefix
  input.insert(input.end(), challenge_bytes.begin(), challenge_bytes.end());

  std::vector<uint8_t> signature =
      crypto::sign::Sign(crypto::sign::ECDSA_SHA256, *key, input);
  dict.Set("signedChallenge", base::Base64Encode(signature));
  return RespondNow(WithArguments(std::move(dict)));
}

}  // namespace extensions
