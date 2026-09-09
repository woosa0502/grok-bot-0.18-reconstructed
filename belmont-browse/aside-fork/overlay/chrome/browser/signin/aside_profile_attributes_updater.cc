// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/signin/aside_profile_attributes_updater.h"

#include <utility>

#include "base/environment.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/logging.h"
#include "base/task/bind_post_task.h"
#include "base/json/json_writer.h"
#include "base/path_service.h"
#include "base/strings/string_number_conversions.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/uuid.h"
#include "base/values.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_attributes_entry.h"
#include "chrome/browser/profiles/profile_attributes_storage.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/signin/aside_daemon_authorizer.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/storage_partition.h"

namespace {

constexpr char kProfileIdPref[] = "aside.profile_id";
constexpr char kAccountIdPref[] = "aside.account_id";
constexpr char kAccountUserIdPref[] = "aside.account_user_id";
constexpr char kAccountEmailPref[] = "aside.account_email";
constexpr char kAccountDisplayNamePref[] = "aside.account_display_name";
constexpr char kAccountProfileUrlPref[] = "aside.account_profile_url";
constexpr char kAccountAuthPausedPref[] = "aside.account_auth_paused";
constexpr char kAccountHasPersistedSessionPref[] =
    "aside.account_has_persisted_session";
constexpr char kBootstrapCompletePref[] = "aside.bootstrap_complete";

std::optional<std::string> ReadFile(const base::FilePath& path) {
  std::string contents;
  if (!base::ReadFileToString(path, &contents)) {
    return std::nullopt;
  }
  return contents;
}

std::optional<int> ProfileIndexFor(const base::FilePath& profile_path) {
  ProfileManager* manager = g_browser_process->profile_manager();
  if (!manager) {
    return std::nullopt;
  }
  int index = 0;
  for (ProfileAttributesEntry* entry :
       manager->GetProfileAttributesStorage().GetAllProfilesAttributes()) {
    if (entry->GetPath() == profile_path) {
      return index;
    }
    ++index;
  }
  return std::nullopt;
}

}  // namespace

AsideProfileAttributesUpdater::AsideProfileAttributesUpdater(Profile* profile)
    : profile_(profile),
      watcher_(base::ThreadPool::CreateSequencedTaskRunner(
          {base::MayBlock(), base::TaskPriority::BEST_EFFORT})) {
  PrefService* prefs = profile_->GetPrefs();
  if (prefs->GetString(kProfileIdPref).empty()) {
    prefs->SetString(kProfileIdPref,
                     base::Uuid::GenerateRandomV4().AsLowercaseString());
  }
  StartWatchingAccountsState();
  RefreshAccountsState();
}

AsideProfileAttributesUpdater::~AsideProfileAttributesUpdater() = default;

void AsideProfileAttributesUpdater::Shutdown() {
  watcher_.Reset();
  profile_ = nullptr;
}

// static
base::FilePath AsideProfileAttributesUpdater::AccountsJsonPath() {
  std::unique_ptr<base::Environment> env = base::Environment::Create();
  std::optional<std::string> home = env->GetVar("ASIDE_HOME");
  base::FilePath dir;
  if (home && !home->empty()) {
    dir = base::FilePath::FromUTF8Unsafe(*home);
  } else {
    base::PathService::Get(base::DIR_HOME, &dir);
    dir = dir.Append(FILE_PATH_LITERAL(".aside"));
  }
  return dir.Append(FILE_PATH_LITERAL("accounts.json"));
}

void AsideProfileAttributesUpdater::StartWatchingAccountsState() {
  // The parent directory is watched so the file appearing later is noticed.
  watcher_.AsyncCall(&base::FilePathWatcher::Watch)
      .WithArgs(AccountsJsonPath().DirName(),
                base::FilePathWatcher::Type::kNonRecursive,
                base::BindPostTask(
                    base::SequencedTaskRunner::GetCurrentDefault(),
                    base::BindRepeating(
                        &AsideProfileAttributesUpdater::OnAccountsFileChanged,
                        weak_factory_.GetWeakPtr())))
      .Then(base::BindOnce([](bool ok) {
        VLOG_IF(1, !ok) << "aside: accounts.json watch failed";
      }));
}

void AsideProfileAttributesUpdater::OnAccountsFileChanged(
    const base::FilePath& path,
    bool error) {
  RefreshAccountsState();
}

void AsideProfileAttributesUpdater::RefreshAccountsState() {
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::MayBlock(), base::TaskPriority::USER_VISIBLE},
      base::BindOnce(&ReadFile, AccountsJsonPath()),
      base::BindOnce(&AsideProfileAttributesUpdater::OnAccountsRead,
                     weak_factory_.GetWeakPtr()));
}

void AsideProfileAttributesUpdater::OnAccountsRead(
    std::optional<std::string> contents) {
  if (!profile_) {
    return;
  }
  PrefService* prefs = profile_->GetPrefs();
  std::optional<base::Value> json =
      contents ? base::JSONReader::Read(*contents, base::JSON_PARSE_RFC)
               : std::nullopt;
  if (!json || !json->is_dict()) {
    // No registry: signed out.
    prefs->SetInteger(kAccountIdPref, -1);
    prefs->SetString(kAccountUserIdPref, std::string());
    prefs->SetString(kAccountEmailPref, std::string());
    prefs->SetString(kAccountDisplayNamePref, std::string());
    prefs->SetString(kAccountProfileUrlPref, std::string());
    prefs->SetBoolean(kAccountAuthPausedPref, false);
    prefs->SetBoolean(kAccountHasPersistedSessionPref, false);
    prefs->SetBoolean(kBootstrapCompletePref, false);
    return;
  }
  const base::DictValue& registry = json->GetDict();
  VLOG(1) << "aside: accounts.json loaded (" << contents->size() << " bytes)";
  const std::string profile_id = prefs->GetString(kProfileIdPref);

  // A binding recorded for this profile wins over the daemon's current
  // account (profiles can be bound to different accounts).
  int account_id = registry.FindInt("currentAccountId").value_or(0);
  bool already_bound = false;
  if (const base::DictValue* bindings =
          registry.FindDict("profileAccountBindings")) {
    if (const base::DictValue* binding = bindings->FindDict(profile_id)) {
      account_id = binding->FindInt("accountId").value_or(account_id);
      already_bound = true;
    }
  }

  const base::DictValue* account = nullptr;
  if (const base::ListValue* accounts = registry.FindList("accounts")) {
    for (const base::Value& entry : *accounts) {
      if (entry.is_dict() &&
          entry.GetDict().FindInt("id").value_or(-1) == account_id) {
        account = &entry.GetDict();
        break;
      }
    }
  }
  if (!account) {
    prefs->SetInteger(kAccountIdPref, -1);
    prefs->SetString(kAccountUserIdPref, std::string());
    return;
  }
  const std::string key = base::NumberToString(account_id);
  const std::string* user_id = account->FindString("userId");
  const std::string* email = account->FindString("email");
  const std::string* name = account->FindString("name");
  const std::string* profile_url = account->FindString("profileUrl");
  const std::string* auth_status = account->FindString("authStatus");
  bool has_session = false;
  if (const base::DictValue* sessions = registry.FindDict("sessions")) {
    has_session = sessions->FindDict(key) != nullptr;
  }
  bool bootstrap_complete = false;
  if (const base::DictValue* bootstraps = registry.FindDict("localBootstraps")) {
    if (const base::DictValue* bootstrap = bootstraps->FindDict(key)) {
      bootstrap_complete = bootstrap->FindBool("isComplete").value_or(false);
    }
  }

  prefs->SetInteger(kAccountIdPref, account_id);
  prefs->SetString(kAccountUserIdPref, user_id ? *user_id : std::string());
  prefs->SetString(kAccountEmailPref, email ? *email : std::string());
  prefs->SetString(kAccountDisplayNamePref, name ? *name : std::string());
  prefs->SetString(kAccountProfileUrlPref,
                   profile_url ? *profile_url : std::string());
  prefs->SetBoolean(kAccountAuthPausedPref,
                    auth_status && *auth_status == "paused");
  prefs->SetBoolean(kAccountHasPersistedSessionPref, has_session);
  prefs->SetBoolean(kBootstrapCompletePref, bootstrap_complete);

  if (user_id && !user_id->empty()) {
    MaybePostProfileBinding(*user_id, account_id, already_bound);
  }
}

void AsideProfileAttributesUpdater::MaybePostProfileBinding(
    const std::string& user_id,
    int account_id,
    bool already_bound) {
  base::DictValue body;
  body.Set("profileId", profile_->GetPrefs()->GetString(kProfileIdPref));
  body.Set("userId", user_id);
  body.Set("accountId", account_id);
  if (std::optional<int> index = ProfileIndexFor(profile_->GetPath())) {
    body.Set("profileIndex", *index);
  }
  body.Set("profilePath", profile_->GetPath().AsUTF8Unsafe());
  std::string json;
  base::JSONWriter::Write(body, &json);
  if (already_bound && json == last_posted_binding_) {
    return;
  }
  last_posted_binding_ = json;
  VLOG(1) << "aside: posting profile-binding " << json;
  AsideDaemonAuthorizer::GetInstance()->PostJsonWithAuthorization(
      profile_->GetDefaultStoragePartition()
          ->GetURLLoaderFactoryForBrowserProcess(),
      "/accounts/profile-binding", std::move(json),
      base::BindOnce(&AsideProfileAttributesUpdater::OnBindingPosted,
                     weak_factory_.GetWeakPtr()));
}

void AsideProfileAttributesUpdater::OnBindingPosted(
    std::optional<std::string> body) {
  VLOG(1) << "aside: profile-binding response " << body.value_or("<none>");
}
