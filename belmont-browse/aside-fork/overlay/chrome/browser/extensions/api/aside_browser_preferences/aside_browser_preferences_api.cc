// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/extensions/api/aside_browser_preferences/aside_browser_preferences_api.h"

#include <string>

#include "base/values.h"
#include "chrome/common/extensions/api/aside_browser_preferences.h"
#include "components/version_info/version_info.h"

#include <cmath>
#include <optional>

#include "base/strings/string_number_conversions.h"
#include "base/strings/string_split.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/search_engines/template_url_service_factory.h"
#include "chrome/browser/themes/theme_service.h"
#include "chrome/browser/themes/theme_service_factory.h"
#include "chrome/browser/ui/zoom/chrome_zoom_level_prefs.h"
#include "components/language/core/browser/pref_names.h"
#include "components/prefs/pref_service.h"
#include "components/search_engines/choice_made_location.h"
#include "components/search_engines/default_search_manager.h"
#include "components/search_engines/template_url.h"
#include "components/search_engines/template_url_service.h"
#include "components/spellcheck/browser/pref_names.h"
#include "third_party/blink/public/common/page/page_zoom.h"

#include "base/functional/bind.h"
#include "base/memory/scoped_refptr.h"
#include "chrome/browser/browser_process.h"
#include "chrome/common/pref_names.h"
#include "chrome/browser/shell_integration.h"
#include "chrome/browser/sync/sync_service_factory.h"
#include "components/signin/public/identity_manager/account_info.h"
#include "components/sync/service/sync_service.h"
#include "base/command_line.h"
#include "base/containers/flat_set.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/translate/chrome_translate_client.h"
#include "components/language/core/browser/language_prefs.h"
#include "components/spellcheck/common/spellcheck_common.h"
#include "components/translate/core/browser/translate_prefs.h"
#include "ui/base/l10n/l10n_util.h"
#include "ui/base/ui_base_switches.h"

namespace extensions {

namespace {

constexpr char kAsideVerticalTabsEnabled[] =
    "aside.browser_preferences.vertical_tabs_enabled";
constexpr char kAsideHorizontalTabShrink[] =
    "aside.browser_preferences.horizontal_tab_strip_shrink_to_fit_enabled";
constexpr char kAsideBrowserColorScheme[] =
    "aside.browser_preferences.browser_color_scheme";
constexpr char kHorizontalTabStripShrinkToFit[] =
    "horizontal_tab_strip.shrink_to_fit_enabled";

PrefService* LocalState() {
  return g_browser_process ? g_browser_process->local_state() : nullptr;
}

PrefService* OriginalProfilePrefs(Profile* profile) {
  return profile ? profile->GetOriginalProfile()->GetPrefs() : nullptr;
}

std::vector<Profile*> LoadedProfiles() {
  if (!g_browser_process || !g_browser_process->profile_manager()) {
    return {};
  }
  return g_browser_process->profile_manager()->GetLoadedProfiles();
}

// Original two-layer read (RE 0x406b590 tab style, 0x406baa4 tab shrink): the
// Local State aside.* key wins only when the user explicitly set it
// (Preference::HasUserSetting); otherwise the per-profile pref; if there are
// no profile prefs, |no_profile_fallback|.
bool ReadLayeredBool(Profile* profile,
                     const char* aside_key,
                     const char* profile_key,
                     bool no_profile_fallback) {
  if (PrefService* local_state = LocalState()) {
    const PrefService::Preference* pref =
        local_state->FindPreference(aside_key);
    if (pref && pref->HasUserSetting()) {
      return local_state->GetBoolean(aside_key);
    }
  }
  PrefService* prefs = OriginalProfilePrefs(profile);
  return prefs ? prefs->GetBoolean(profile_key) : no_profile_fallback;
}

// Original two-layer write (RE 0x3fd8740 tab style, 0x406bd70 tab shrink): the
// Local State aside.* key, then the per-profile pref on this profile and on
// every loaded profile.
void WriteLayeredBool(Profile* profile,
                      const char* aside_key,
                      const char* profile_key,
                      bool value) {
  if (PrefService* local_state = LocalState()) {
    if (local_state->FindPreference(aside_key)) {
      local_state->SetBoolean(aside_key, value);
    }
  }
  if (PrefService* prefs = OriginalProfilePrefs(profile)) {
    prefs->SetBoolean(profile_key, value);
  }
  for (Profile* loaded : LoadedProfiles()) {
    if (PrefService* prefs = OriginalProfilePrefs(loaded)) {
      prefs->SetBoolean(profile_key, value);
    }
  }
}

// Mirrors settings::DefaultBrowserIsDisabledByPolicy (RE 0x406c7bc).
bool DefaultBrowserIsDisabledByPolicy() {
  PrefService* local_state = LocalState();
  if (!local_state) {
    return false;
  }
  const PrefService::Preference* pref =
      local_state->FindPreference(prefs::kDefaultBrowserSettingEnabled);
  if (!pref || !pref->GetValue()->is_bool()) {
    return false;
  }
  return pref->IsManaged() && !pref->GetValue()->GetBool();
}

// RE 0x406c51c: {state, isDefault, canSet, policyDisabled}.
base::DictValue BuildDefaultBrowserStateDict(
    shell_integration::DefaultWebClientState state) {
  const char* state_name = "unknown";
  switch (state) {
    case shell_integration::NOT_DEFAULT:
      state_name = "not_default";
      break;
    case shell_integration::IS_DEFAULT:
      state_name = "default";
      break;
    case shell_integration::OTHER_MODE_IS_DEFAULT:
      state_name = "other_mode_default";
      break;
    default:
      break;
  }
  const bool policy_disabled = DefaultBrowserIsDisabledByPolicy();
  base::DictValue dict;
  dict.Set("state", state_name);
  dict.Set("isDefault", state == shell_integration::IS_DEFAULT);
  dict.Set("canSet", policy_disabled
                         ? false
                         : shell_integration::CanSetAsDefaultBrowser());
  dict.Set("policyDisabled", policy_disabled);
  return dict;
}

}  // namespace

ExtensionFunction::ResponseAction AsideBrowserPreferencesGetBrowserColorSchemeFunction::Run() {
  // RE 0x7f93dc: --force-dark-mode forces dark; else the Local State aside int
  // (clamped to the enum range: cmp #3 / csel lo); else the profile's
  // ThemeService. Encoding is ThemeService::BrowserColorScheme: 0=system,
  // 1=light, 2=dark.
  Profile* profile = Profile::FromBrowserContext(browser_context());
  int value = 0;
  PrefService* local_state = LocalState();
  if (base::CommandLine::ForCurrentProcess()->HasSwitch(
          switches::kForceDarkMode)) {
    value = 2;
  } else if (local_state &&
             local_state->FindPreference(kAsideBrowserColorScheme)) {
    value = local_state->GetInteger(kAsideBrowserColorScheme);
    if (value < 0 || value >= 3) {
      value = 0;
    }
  } else if (ThemeService* theme = ThemeServiceFactory::GetForProfile(
                 profile->GetOriginalProfile())) {
    value = static_cast<int>(theme->GetBrowserColorScheme());
  }
  std::string scheme = value == 1 ? "light" : value == 2 ? "dark" : "system";
  return RespondNow(WithArguments(scheme));
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesSetBrowserColorSchemeFunction::Run() {
  std::optional<api::aside_browser_preferences::SetBrowserColorScheme::Params> params =
      api::aside_browser_preferences::SetBrowserColorScheme::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid browser color scheme"));
  }
  Profile* profile = Profile::FromBrowserContext(browser_context());
  int value = 0;
  if (params->color_scheme == "light") {
    value = 1;
  } else if (params->color_scheme == "dark") {
    value = 2;
  } else if (params->color_scheme != "system") {
    return RespondNow(Error("Invalid browser color scheme"));
  }
  // RE 0x3fc82e8: --force-dark-mode pins dark.
  if (base::CommandLine::ForCurrentProcess()->HasSwitch(
          switches::kForceDarkMode)) {
    value = 2;
  }
  // RE 0x3fc8300: Local State aside int, then ThemeService on this profile and
  // on every loaded profile.
  if (PrefService* local_state = LocalState();
      local_state && local_state->FindPreference(kAsideBrowserColorScheme)) {
    local_state->SetInteger(kAsideBrowserColorScheme, value);
  }
  auto apply = [value](Profile* target) {
    if (!target) {
      return;
    }
    if (ThemeService* theme = ThemeServiceFactory::GetForProfile(
            target->GetOriginalProfile())) {
      theme->SetBrowserColorScheme(
          static_cast<ThemeService::BrowserColorScheme>(value));
    }
  };
  apply(profile);
  for (Profile* loaded : LoadedProfiles()) {
    apply(loaded);
  }
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesGetTabStyleFunction::Run() {
  // RE 0x406b590: Local State aside override (if user-set) else the profile's
  // vertical_tabs.enabled; no profile prefs -> vertical.
  Profile* profile = Profile::FromBrowserContext(browser_context());
  const bool vertical = ReadLayeredBool(profile, kAsideVerticalTabsEnabled,
                                        prefs::kVerticalTabsEnabled,
                                        /*no_profile_fallback=*/true);
  return RespondNow(WithArguments(std::string(vertical ? "vertical" : "horizontal")));
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesSetTabStyleFunction::Run() {
  std::optional<api::aside_browser_preferences::SetTabStyle::Params> params =
      api::aside_browser_preferences::SetTabStyle::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid tab style"));
  }
  if (params->tab_style != "vertical" && params->tab_style != "horizontal") {
    return RespondNow(Error("Invalid tab style"));
  }
  Profile* profile = Profile::FromBrowserContext(browser_context());
  WriteLayeredBool(profile, kAsideVerticalTabsEnabled,
                   prefs::kVerticalTabsEnabled,
                   params->tab_style == "vertical");
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesGetHorizontalTabShrinkEnabledFunction::Run() {
  // RE 0x406baa4: same two-layer read as tab style.
  Profile* profile = Profile::FromBrowserContext(browser_context());
  return RespondNow(WithArguments(ReadLayeredBool(
      profile, kAsideHorizontalTabShrink, kHorizontalTabStripShrinkToFit,
      /*no_profile_fallback=*/false)));
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesSetHorizontalTabShrinkEnabledFunction::Run() {
  std::optional<api::aside_browser_preferences::SetHorizontalTabShrinkEnabled::Params> params =
      api::aside_browser_preferences::SetHorizontalTabShrinkEnabled::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid horizontal tab shrink enabled value"));
  }
  Profile* profile = Profile::FromBrowserContext(browser_context());
  WriteLayeredBool(profile, kAsideHorizontalTabShrink,
                   kHorizontalTabStripShrinkToFit, params->is_enabled);
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesGetTabSwitcherSortByRecentlyUsedFunction::Run() {
  Profile* profile = Profile::FromBrowserContext(browser_context());
  return RespondNow(WithArguments(profile->GetPrefs()->GetBoolean("aside.tab_switcher.sort_by_recently_used")));
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesSetTabSwitcherSortByRecentlyUsedFunction::Run() {
  std::optional<api::aside_browser_preferences::SetTabSwitcherSortByRecentlyUsed::Params> params =
      api::aside_browser_preferences::SetTabSwitcherSortByRecentlyUsed::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid tab switcher sort by recently used value"));
  }
  Profile* profile = Profile::FromBrowserContext(browser_context());
  profile->GetPrefs()->SetBoolean("aside.tab_switcher.sort_by_recently_used", params->sort_by_recently_used);
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesGetDefaultZoomFunction::Run() {
  Profile* profile = Profile::FromBrowserContext(browser_context());
  double zoom_factor = 1.0;
  if (ChromeZoomLevelPrefs* zoom_prefs = profile->GetZoomLevelPrefs()) {
    zoom_factor = zoom_prefs->GetDefaultZoomFactor();
  }
  return RespondNow(WithArguments(zoom_factor));
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesSetDefaultZoomFunction::Run() {
  std::optional<api::aside_browser_preferences::SetDefaultZoom::Params> params =
      api::aside_browser_preferences::SetDefaultZoom::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid default zoom"));
  }
  // RE 0x406c284: zoom must be a finite factor within [0.25, 5.0].
  if (!std::isfinite(params->zoom) || params->zoom < 0.25 ||
      params->zoom > 5.0) {
    return RespondNow(Error("Invalid default zoom"));
  }
  Profile* profile = Profile::FromBrowserContext(browser_context());
  if (!profile) {
    return RespondNow(Error("Browser profile unavailable"));
  }
  if (ChromeZoomLevelPrefs* zoom_prefs = profile->GetZoomLevelPrefs()) {
    zoom_prefs->SetDefaultZoomLevelPref(blink::ZoomFactorToZoomLevel(params->zoom));
  }
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesGetDefaultBrowserStateFunction::Run() {
  base::MakeRefCounted<shell_integration::DefaultBrowserWorker>()
      ->StartCheckIsDefault(base::BindOnce(
          &AsideBrowserPreferencesGetDefaultBrowserStateFunction::
              OnDefaultChecked,
          this));
  return RespondLater();
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesSetAsDefaultBrowserFunction::Run() {
  // RE 0x7ade1d4: refused when the DefaultBrowserSettingEnabled policy blocks it.
  if (DefaultBrowserIsDisabledByPolicy()) {
    return RespondNow(Error("Default browser setting is disabled by policy"));
  }
  base::MakeRefCounted<shell_integration::DefaultBrowserWorker>()
      ->StartSetAsDefault(base::BindOnce(
          &AsideBrowserPreferencesSetAsDefaultBrowserFunction::OnSetDefault,
          this));
  return RespondLater();
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesGetDockStateFunction::Run() {
  // RE 0x7ade390: {supported, isAdded, canAdd}. The Dock is macOS-only; on
  // Linux nothing is supported.
  base::DictValue dict;
  dict.Set("supported", false);
  dict.Set("isAdded", false);
  dict.Set("canAdd", false);
  return RespondNow(WithArguments(std::move(dict)));
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesAddToDockFunction::Run() {
  // Same shape as getDockState; no Dock on Linux.
  base::DictValue dict;
  dict.Set("supported", false);
  dict.Set("isAdded", false);
  dict.Set("canAdd", false);
  return RespondNow(WithArguments(std::move(dict)));
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesGetKeepTasksRunningStateFunction::Run() {
  // RE 0x406c834: {supported, enabled, canSet, policyDisabled} over the Local
  // State pref background_mode.enabled; canSet = IsUserModifiablePreference,
  // policyDisabled = !canSet.
  PrefService* local_state = LocalState();
  base::DictValue dict;
  dict.Set("supported", local_state != nullptr);
  bool enabled = false;
  bool can_set = false;
  bool policy_disabled = false;
  if (local_state) {
    enabled = local_state->GetBoolean(prefs::kBackgroundModeEnabled);
    can_set =
        local_state->IsUserModifiablePreference(prefs::kBackgroundModeEnabled);
    policy_disabled = !can_set;
  }
  dict.Set("enabled", enabled);
  dict.Set("canSet", can_set);
  dict.Set("policyDisabled", policy_disabled);
  return RespondNow(WithArguments(std::move(dict)));
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesSetKeepTasksRunningEnabledFunction::Run() {
  std::optional<api::aside_browser_preferences::SetKeepTasksRunningEnabled::Params> params =
      api::aside_browser_preferences::SetKeepTasksRunningEnabled::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid keep tasks running enabled value"));
  }
  // RE 0x406cb24: Local State required; refused when policy-managed.
  PrefService* local_state = LocalState();
  if (!local_state) {
    return RespondNow(Error("Browser profile unavailable"));
  }
  if (!local_state->IsUserModifiablePreference(prefs::kBackgroundModeEnabled)) {
    return RespondNow(
        Error("Keep tasks running setting is disabled by policy"));
  }
  local_state->SetBoolean(prefs::kBackgroundModeEnabled, params->enabled);
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesGetAutoPipEnabledFunction::Run() {
  Profile* profile = Profile::FromBrowserContext(browser_context());
  return RespondNow(WithArguments(profile->GetPrefs()->GetBoolean("aside.auto_pip.enabled")));
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesSetAutoPipEnabledFunction::Run() {
  std::optional<api::aside_browser_preferences::SetAutoPipEnabled::Params> params =
      api::aside_browser_preferences::SetAutoPipEnabled::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid auto pip enabled value"));
  }
  Profile* profile = Profile::FromBrowserContext(browser_context());
  profile->GetPrefs()->SetBoolean("aside.auto_pip.enabled", params->is_enabled);
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesGetVerticalTabsBookmarksSectionEnabledFunction::Run() {
  Profile* profile = Profile::FromBrowserContext(browser_context());
  return RespondNow(WithArguments(profile->GetPrefs()->GetBoolean("aside.vertical_tabs.bookmarks_section_enabled")));
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesSetVerticalTabsBookmarksSectionEnabledFunction::Run() {
  std::optional<api::aside_browser_preferences::SetVerticalTabsBookmarksSectionEnabled::Params> params =
      api::aside_browser_preferences::SetVerticalTabsBookmarksSectionEnabled::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid vertical tabs bookmarks section enabled value"));
  }
  Profile* profile = Profile::FromBrowserContext(browser_context());
  profile->GetPrefs()->SetBoolean("aside.vertical_tabs.bookmarks_section_enabled", params->is_enabled);
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesGetBrowserVersionFunction::Run() {
  // RE 0x7ade840: the original returns its app version literal, not the
  // Chromium version. Replicated verbatim so version gating behaves the same.
  return RespondNow(WithArguments(std::string("1.0.825.1")));
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesGetSyncStatusFunction::Run() {
  Profile* profile = Profile::FromBrowserContext(browser_context());
  base::DictValue dict;
  syncer::SyncService* sync = SyncServiceFactory::GetForProfile(profile);
  bool is_syncing = sync && sync->IsSyncFeatureActive();
  dict.Set("isSyncing", is_syncing);
  return RespondNow(WithArguments(std::move(dict)));
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesCheckForUpdatesFunction::Run() {
  // Linux has no in-browser updater (updates via the package manager); report
  // "up to date" so the settings UI does not offer an in-app update path.
  // No macOS Sparkle-style in-browser updater on Linux (updates via the package
  // manager). Field vocabulary matches the original's update-status object.
  base::DictValue dict;
  dict.Set("available", false);
  dict.Set("state", "noUpdate");
  return RespondNow(WithArguments(std::move(dict)));
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesGetLanguageSettingsFunction::Run() {
  // RE 0x406ebe0: preferredLanguages via language::LanguagePrefs
  // (intl.selected_languages, helpers 0x10e8980/0x9a0a358); spellCheckSupported
  // = the spellcheck pref exists; spellCheckEnabled = its value.
  Profile* profile = Profile::FromBrowserContext(browser_context());
  PrefService* prefs = profile->GetPrefs();
  language::LanguagePrefs language_prefs(prefs);
  std::vector<std::string> selected;
  language_prefs.GetUserSelectedLanguagesList(&selected);
  base::ListValue preferred;
  for (const std::string& code : selected) {
    preferred.Append(code);
  }
  base::DictValue dict;
  dict.Set("preferredLanguages", std::move(preferred));
  dict.Set("spellCheckSupported",
           prefs->FindPreference(spellcheck::prefs::kSpellCheckEnable) != nullptr);
  dict.Set("spellCheckEnabled",
           prefs->GetBoolean(spellcheck::prefs::kSpellCheckEnable));
  return RespondNow(WithArguments(std::move(dict)));
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesGetSupportedLanguagesFunction::Run() {
  // RE 0x406eed8 / 0x406f0ec: mirrors languageSettingsPrivate.getLanguageList —
  // TranslatePrefs::GetLanguageInfoList(app_locale, translate allowed by policy
  // (reads translate.enabled)); items {code, displayName, nativeDisplayName,
  // supportsSpellcheck, supportsTranslate}.
  Profile* profile = Profile::FromBrowserContext(browser_context());
  const std::string app_locale = g_browser_process->GetApplicationLocale();
  std::unique_ptr<translate::TranslatePrefs> translate_prefs =
      ChromeTranslateClient::CreateTranslatePrefs(profile->GetPrefs());
  std::vector<translate::TranslateLanguageInfo> infos;
  translate::TranslatePrefs::GetLanguageInfoList(
      app_locale, translate_prefs->IsTranslateAllowedByPolicy(), &infos);
  const base::flat_set<std::string> spellcheck_languages(
      spellcheck::SpellCheckLanguages());
  base::ListValue languages;
  for (const translate::TranslateLanguageInfo& info : infos) {
    base::DictValue entry;
    entry.Set("code", info.code);
    entry.Set("displayName", info.display_name);
    entry.Set("nativeDisplayName", info.native_display_name);
    entry.Set("supportsSpellcheck", spellcheck_languages.contains(info.code));
    entry.Set("supportsTranslate", info.supports_translate);
    languages.Append(std::move(entry));
  }
  base::DictValue dict;
  dict.Set("languages", std::move(languages));
  return RespondNow(WithArguments(std::move(dict)));
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesSetPreferredLanguagesFunction::Run() {
  std::optional<api::aside_browser_preferences::SetPreferredLanguages::Params> params =
      api::aside_browser_preferences::SetPreferredLanguages::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid preferred languages"));
  }
  Profile* profile = Profile::FromBrowserContext(browser_context());
  if (!profile) {
    return RespondNow(Error("Browser profile unavailable"));
  }
  PrefService* prefs = profile->GetPrefs();
  if (!prefs->FindPreference(language::prefs::kSelectedLanguages) ||
      !prefs->IsUserModifiablePreference(language::prefs::kSelectedLanguages)) {
    return RespondNow(
        Error("Preferred languages setting is disabled by policy"));
  }
  language::LanguagePrefs language_prefs(prefs);
  language_prefs.SetUserSelectedLanguagesList(params->language_codes);
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesSetSpellCheckEnabledFunction::Run() {
  std::optional<api::aside_browser_preferences::SetSpellCheckEnabled::Params> params =
      api::aside_browser_preferences::SetSpellCheckEnabled::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid spell check enabled value"));
  }
  Profile* profile = Profile::FromBrowserContext(browser_context());
  if (!profile) {
    return RespondNow(Error("Browser profile unavailable"));
  }
  PrefService* prefs = profile->GetPrefs();
  if (!prefs->FindPreference(spellcheck::prefs::kSpellCheckEnable) ||
      !prefs->IsUserModifiablePreference(spellcheck::prefs::kSpellCheckEnable)) {
    return RespondNow(Error("Spell check setting is disabled by policy"));
  }
  prefs->SetBoolean(spellcheck::prefs::kSpellCheckEnable, params->enabled);
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesGetSearchEnginesFunction::Run() {
  Profile* profile = Profile::FromBrowserContext(browser_context());
  base::DictValue dict;
  base::ListValue engines;
  std::string default_engine_id;
  TemplateURLService* service =
      TemplateURLServiceFactory::GetForProfile(profile);
  if (!service) {
    return RespondNow(Error("Search engine settings unavailable"));
  }
  if (service->loaded()) {
    const TemplateURL* default_provider = service->GetDefaultSearchProvider();
    if (default_provider) {
      default_engine_id = base::NumberToString(default_provider->id());
    }
    for (TemplateURL* turl : service->GetTemplateURLs()) {
      base::DictValue entry;
      entry.Set("id", base::NumberToString(turl->id()));
      // Settings dropdown renders `o.name` (adversarial check) — NOT shortName
      // (that is the omnibox variant's field).
      entry.Set("name", base::UTF16ToUTF8(turl->short_name()));
      entry.Set("keyword", base::UTF16ToUTF8(turl->keyword()));
      entry.Set("isDefault",
                default_provider && default_provider->id() == turl->id());
      engines.Append(std::move(entry));
    }
  } else {
    service->Load();
  }
  dict.Set("searchEngines", std::move(engines));
  dict.Set("defaultEngineId", default_engine_id);
  return RespondNow(WithArguments(std::move(dict)));
}

ExtensionFunction::ResponseAction AsideBrowserPreferencesSetDefaultSearchEngineFunction::Run() {
  std::optional<api::aside_browser_preferences::SetDefaultSearchEngine::Params> params =
      api::aside_browser_preferences::SetDefaultSearchEngine::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid search engine id"));
  }
  int64_t target_id = 0;
  if (!base::StringToInt64(params->engine_id, &target_id)) {
    return RespondNow(Error("Invalid search engine id"));
  }
  Profile* profile = Profile::FromBrowserContext(browser_context());
  if (!profile) {
    return RespondNow(Error("Browser profile unavailable"));
  }
  TemplateURLService* service =
      TemplateURLServiceFactory::GetForProfile(profile);
  if (!service || !service->loaded()) {
    return RespondNow(Error("Search engine settings unavailable"));
  }
  if (service->default_search_provider_source() ==
      DefaultSearchManager::FROM_POLICY) {
    return RespondNow(
        Error("Default search engine setting is disabled by policy"));
  }
  TemplateURL* target = nullptr;
  for (TemplateURL* turl : service->GetTemplateURLs()) {
    if (turl->id() == target_id) {
      target = turl;
      break;
    }
  }
  if (!target) {
    return RespondNow(Error("Invalid search engine id"));
  }
  service->SetUserSelectedDefaultSearchProvider(
      target, search_engines::ChoiceMadeLocation::kOther);
  return RespondNow(NoArguments());
}

void AsideBrowserPreferencesSetAsDefaultBrowserFunction::OnSetDefault(
    shell_integration::DefaultWebClientState state) {
  Respond(WithArguments(BuildDefaultBrowserStateDict(state)));
}

void AsideBrowserPreferencesGetDefaultBrowserStateFunction::OnDefaultChecked(
    shell_integration::DefaultWebClientState state) {
  Respond(WithArguments(BuildDefaultBrowserStateDict(state)));
}

}  // namespace extensions
