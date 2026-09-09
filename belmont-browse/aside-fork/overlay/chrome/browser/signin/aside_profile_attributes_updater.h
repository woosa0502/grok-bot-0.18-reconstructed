// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_SIGNIN_ASIDE_PROFILE_ATTRIBUTES_UPDATER_H_
#define CHROME_BROWSER_SIGNIN_ASIDE_PROFILE_ATTRIBUTES_UPDATER_H_

#include <memory>
#include <optional>
#include <string>

#include "base/files/file_path.h"
#include "base/files/file_path_watcher.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/threading/sequence_bound.h"
#include "components/keyed_service/core/keyed_service.h"

class Profile;

// Mirrors the Aside daemon's account registry (~/.aside/accounts.json) into
// the profile's aside.account_* prefs and registers this profile with the
// daemon (/accounts/profile-binding). RE: original
// chrome/browser/signin/aside_profile_attributes_updater.cc
// (StartWatchingAccountsState, RefreshAccountsState,
// PostJsonToDaemonWithAuthorization, "/accounts/profile-binding",
// "/accounts/profile-binding/delete", "profileIndex").
class AsideProfileAttributesUpdater : public KeyedService {
 public:
  explicit AsideProfileAttributesUpdater(Profile* profile);
  ~AsideProfileAttributesUpdater() override;

  static base::FilePath AccountsJsonPath();

  // Re-reads accounts.json and updates the prefs.
  void RefreshAccountsState();

  // KeyedService:
  void Shutdown() override;

 private:
  void StartWatchingAccountsState();
  void OnAccountsFileChanged(const base::FilePath& path, bool error);
  void OnAccountsRead(std::optional<std::string> contents);
  void MaybePostProfileBinding(const std::string& user_id,
                               int account_id,
                               bool already_bound);
  void OnBindingPosted(std::optional<std::string> body);

  raw_ptr<Profile> profile_;
  base::SequenceBound<base::FilePathWatcher> watcher_;
  std::string last_posted_binding_;
  base::WeakPtrFactory<AsideProfileAttributesUpdater> weak_factory_{this};
};

#endif  // CHROME_BROWSER_SIGNIN_ASIDE_PROFILE_ATTRIBUTES_UPDATER_H_
