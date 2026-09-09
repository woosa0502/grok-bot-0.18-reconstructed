// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/extensions/api/aside_mini_popup/aside_mini_popup_api.h"

#include <string>

#include "base/values.h"
#include "chrome/common/extensions/api/aside_mini_popup.h"

#include <optional>
#include <string>
#include <vector>

#include "chrome/browser/profiles/profile.h"
#include "components/prefs/pref_service.h"

#include "chrome/browser/extensions/api/aside_mini_popup/mini_popup_service.h"
#include "extensions/common/extension.h"

#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/platform_util.h"
#include "chrome/browser/profiles/profile_attributes_entry.h"
#include "chrome/browser/profiles/profile_attributes_storage.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/profiles/profile_window.h"
#include "chrome/browser/ui/select_file_policy/chrome_select_file_policy.h"
#include "content/public/browser/web_contents.h"
#include "ui/gfx/native_ui_types.h"
#include "ui/shell_dialogs/selected_file_info.h"

namespace extensions {

namespace {
// RE 0x4055c6c etc.: the mini popup prefs are browser-global (Local State).
PrefService* MiniPopupLocalState() {
  return g_browser_process ? g_browser_process->local_state() : nullptr;
}
// RE: every window-affecting call fails with this when the popup service is gone.
constexpr char kMiniPopupUnavailable[] = "Aside mini popup unavailable";
bool g_folder_picker_in_progress = false;
}  // namespace

ExtensionFunction::ResponseAction AsideMiniPopupHideFunction::Run() {
  MiniPopupService* service = MiniPopupService::Get(browser_context());
  if (!service) {
    return RespondNow(Error(kMiniPopupUnavailable));
  }
  service->Hide();
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideMiniPopupGetEnabledFunction::Run() {
  PrefService* local_state = MiniPopupLocalState();
  if (!local_state) {
    return RespondNow(Error("Local State unavailable"));
  }
  return RespondNow(WithArguments(local_state->GetBoolean("aside.mini_popup.enabled")));
}

ExtensionFunction::ResponseAction AsideMiniPopupSetEnabledFunction::Run() {
  std::optional<api::aside_mini_popup::SetEnabled::Params> params =
      api::aside_mini_popup::SetEnabled::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid mini popup enabled state"));
  }
  PrefService* local_state = MiniPopupLocalState();
  if (!local_state) {
    return RespondNow(Error("Local State unavailable"));
  }
  local_state->SetBoolean("aside.mini_popup.enabled", params->enabled);
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideMiniPopupGetShortcutFunction::Run() {
  PrefService* local_state = MiniPopupLocalState();
  if (!local_state) {
    return RespondNow(Error("Local State unavailable"));
  }
  return RespondNow(WithArguments(local_state->GetString("aside.mini_popup.shortcut")));
}

ExtensionFunction::ResponseAction AsideMiniPopupSetShortcutFunction::Run() {
  std::optional<api::aside_mini_popup::SetShortcut::Params> params =
      api::aside_mini_popup::SetShortcut::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid mini popup shortcut"));
  }
  // RE 0x40563f8: the original parses the accelerator and rejects invalid
  // ones; this fork only rejects an empty shortcut (parser not reproduced).
  if (params->shortcut.empty()) {
    return RespondNow(Error("Invalid mini popup shortcut"));
  }
  PrefService* local_state = MiniPopupLocalState();
  if (!local_state) {
    return RespondNow(Error("Local State unavailable"));
  }
  local_state->SetString("aside.mini_popup.shortcut", params->shortcut);
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideMiniPopupSetStateFunction::Run() {
  std::optional<api::aside_mini_popup::SetState::Params> params =
      api::aside_mini_popup::SetState::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid mini popup state"));
  }
  MiniPopupService* service = MiniPopupService::Get(browser_context());
  if (!service) {
    return RespondNow(Error(kMiniPopupUnavailable));
  }
  if (extension()) {
    service
        ->SetState(*extension(), api::aside_mini_popup::ToString(params->state));
  }
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideMiniPopupSetSizeFunction::Run() {
  std::optional<api::aside_mini_popup::SetSize::Params> params =
      api::aside_mini_popup::SetSize::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid mini popup size"));
  }
  MiniPopupService* service = MiniPopupService::Get(browser_context());
  if (!service) {
    return RespondNow(Error(kMiniPopupUnavailable));
  }
  if (extension()) {
    service
        ->SetSize(*extension(), params->width, params->height);
  }
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideMiniPopupSetOptionWindowSizeFunction::Run() {
  std::optional<api::aside_mini_popup::SetOptionWindowSize::Params> params =
      api::aside_mini_popup::SetOptionWindowSize::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid option window size"));
  }
  MiniPopupService* service = MiniPopupService::Get(browser_context());
  if (!service) {
    return RespondNow(Error(kMiniPopupUnavailable));
  }
  if (extension()) {
    service
        ->SetSize(*extension(), params->width, params->height);
  }
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideMiniPopupPickDirectoryFunction::Run() {
  if (!MiniPopupService::Get(browser_context())) {
    return RespondNow(Error(kMiniPopupUnavailable));
  }
  // RE 0x4057040: only one folder picker at a time.
  if (g_folder_picker_in_progress) {
    return RespondNow(Error("Folder picker request already in progress"));
  }
  g_folder_picker_in_progress = true;
  content::WebContents* web_contents = GetSenderWebContents();
  select_file_dialog_ = ui::SelectFileDialog::Create(
      this, std::make_unique<ChromeSelectFilePolicy>(web_contents));
  gfx::NativeWindow owning_window =
      web_contents ? platform_util::GetTopLevel(web_contents->GetNativeView())
                   : gfx::NativeWindow();
  ui::SelectFileDialog::FileTypeInfo file_type_info;
  select_file_dialog_->SelectFile(
      ui::SelectFileDialog::SELECT_FOLDER, std::u16string(), base::FilePath(),
      &file_type_info, 0, base::FilePath::StringType(), owning_window);
  return RespondLater();
}

ExtensionFunction::ResponseAction AsideMiniPopupSwitchProfileFunction::Run() {
  std::optional<api::aside_mini_popup::SwitchProfile::Params> params =
      api::aside_mini_popup::SwitchProfile::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid Chromium profile index"));
  }
  if (!MiniPopupService::Get(browser_context())) {
    return RespondNow(Error(kMiniPopupUnavailable));
  }
  ProfileManager* profile_manager = g_browser_process->profile_manager();
  if (!profile_manager) {
    return RespondNow(Error("Chromium profile manager unavailable"));
  }
  ProfileAttributesStorage& storage =
      profile_manager->GetProfileAttributesStorage();
  std::vector<ProfileAttributesEntry*> entries =
      storage.GetAllProfilesAttributesSortedForDisplay();
  if (params->profile_index < 0 ||
      static_cast<size_t>(params->profile_index) >= entries.size()) {
    return RespondNow(Error("Invalid Chromium profile index"));
  }
  if (entries[params->profile_index]->IsSigninRequired()) {
    return RespondNow(Error("Chromium profile is locked"));
  }
  base::FilePath profile_path = entries[params->profile_index]->GetPath();
  profiles::SwitchToProfile(
      profile_path, /*always_create=*/false,
      base::BindOnce(&AsideMiniPopupSwitchProfileFunction::OnProfileSwitched,
                     this));
  return RespondLater();
}

AsideMiniPopupPickDirectoryFunction::AsideMiniPopupPickDirectoryFunction() =
    default;

AsideMiniPopupPickDirectoryFunction::~AsideMiniPopupPickDirectoryFunction() {
  if (select_file_dialog_) {
    select_file_dialog_->ListenerDestroyed();
  }
}

void AsideMiniPopupPickDirectoryFunction::FileSelected(
    const ui::SelectedFileInfo& file,
    int index) {
  select_file_dialog_.reset();
  g_folder_picker_in_progress = false;
  Respond(WithArguments(file.path().AsUTF8Unsafe()));
}

void AsideMiniPopupPickDirectoryFunction::FileSelectionCanceled() {
  select_file_dialog_.reset();
  g_folder_picker_in_progress = false;
  Respond(WithArguments(std::string()));
}

void AsideMiniPopupSwitchProfileFunction::OnProfileSwitched(Browser* browser) {
  Respond(NoArguments());
}

}  // namespace extensions
