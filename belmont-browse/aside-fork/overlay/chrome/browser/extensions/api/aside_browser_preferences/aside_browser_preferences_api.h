// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_EXTENSIONS_API_ASIDE_BROWSER_PREFERENCES_ASIDE_BROWSER_PREFERENCES_API_H_
#define CHROME_BROWSER_EXTENSIONS_API_ASIDE_BROWSER_PREFERENCES_ASIDE_BROWSER_PREFERENCES_API_H_

#include "chrome/browser/shell_integration.h"
#include "extensions/browser/extension_function.h"

namespace extensions {

class AsideBrowserPreferencesGetBrowserColorSchemeFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.getBrowserColorScheme", ASIDEBROWSERPREFERENCES_GETBROWSERCOLORSCHEME)

 private:
  ~AsideBrowserPreferencesGetBrowserColorSchemeFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesSetBrowserColorSchemeFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.setBrowserColorScheme", ASIDEBROWSERPREFERENCES_SETBROWSERCOLORSCHEME)

 private:
  ~AsideBrowserPreferencesSetBrowserColorSchemeFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesGetTabStyleFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.getTabStyle", ASIDEBROWSERPREFERENCES_GETTABSTYLE)

 private:
  ~AsideBrowserPreferencesGetTabStyleFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesSetTabStyleFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.setTabStyle", ASIDEBROWSERPREFERENCES_SETTABSTYLE)

 private:
  ~AsideBrowserPreferencesSetTabStyleFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesGetHorizontalTabShrinkEnabledFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.getHorizontalTabShrinkEnabled", ASIDEBROWSERPREFERENCES_GETHORIZONTALTABSHRINKENABLED)

 private:
  ~AsideBrowserPreferencesGetHorizontalTabShrinkEnabledFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesSetHorizontalTabShrinkEnabledFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.setHorizontalTabShrinkEnabled", ASIDEBROWSERPREFERENCES_SETHORIZONTALTABSHRINKENABLED)

 private:
  ~AsideBrowserPreferencesSetHorizontalTabShrinkEnabledFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesGetTabSwitcherSortByRecentlyUsedFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.getTabSwitcherSortByRecentlyUsed", ASIDEBROWSERPREFERENCES_GETTABSWITCHERSORTBYRECENTLYUSED)

 private:
  ~AsideBrowserPreferencesGetTabSwitcherSortByRecentlyUsedFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesSetTabSwitcherSortByRecentlyUsedFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.setTabSwitcherSortByRecentlyUsed", ASIDEBROWSERPREFERENCES_SETTABSWITCHERSORTBYRECENTLYUSED)

 private:
  ~AsideBrowserPreferencesSetTabSwitcherSortByRecentlyUsedFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesGetDefaultZoomFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.getDefaultZoom", ASIDEBROWSERPREFERENCES_GETDEFAULTZOOM)

 private:
  ~AsideBrowserPreferencesGetDefaultZoomFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesSetDefaultZoomFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.setDefaultZoom", ASIDEBROWSERPREFERENCES_SETDEFAULTZOOM)

 private:
  ~AsideBrowserPreferencesSetDefaultZoomFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesGetDefaultBrowserStateFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.getDefaultBrowserState", ASIDEBROWSERPREFERENCES_GETDEFAULTBROWSERSTATE)

 private:
  ~AsideBrowserPreferencesGetDefaultBrowserStateFunction() final = default;
  ResponseAction Run() final;
  void OnDefaultChecked(shell_integration::DefaultWebClientState state);
};

class AsideBrowserPreferencesSetAsDefaultBrowserFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.setAsDefaultBrowser", ASIDEBROWSERPREFERENCES_SETASDEFAULTBROWSER)

 private:
  ~AsideBrowserPreferencesSetAsDefaultBrowserFunction() final = default;
  ResponseAction Run() final;
  void OnSetDefault(shell_integration::DefaultWebClientState state);
};

class AsideBrowserPreferencesGetDockStateFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.getDockState", ASIDEBROWSERPREFERENCES_GETDOCKSTATE)

 private:
  ~AsideBrowserPreferencesGetDockStateFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesAddToDockFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.addToDock", ASIDEBROWSERPREFERENCES_ADDTODOCK)

 private:
  ~AsideBrowserPreferencesAddToDockFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesGetKeepTasksRunningStateFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.getKeepTasksRunningState", ASIDEBROWSERPREFERENCES_GETKEEPTASKSRUNNINGSTATE)

 private:
  ~AsideBrowserPreferencesGetKeepTasksRunningStateFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesSetKeepTasksRunningEnabledFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.setKeepTasksRunningEnabled", ASIDEBROWSERPREFERENCES_SETKEEPTASKSRUNNINGENABLED)

 private:
  ~AsideBrowserPreferencesSetKeepTasksRunningEnabledFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesGetAutoPipEnabledFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.getAutoPipEnabled", ASIDEBROWSERPREFERENCES_GETAUTOPIPENABLED)

 private:
  ~AsideBrowserPreferencesGetAutoPipEnabledFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesSetAutoPipEnabledFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.setAutoPipEnabled", ASIDEBROWSERPREFERENCES_SETAUTOPIPENABLED)

 private:
  ~AsideBrowserPreferencesSetAutoPipEnabledFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesGetVerticalTabsBookmarksSectionEnabledFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.getVerticalTabsBookmarksSectionEnabled", ASIDEBROWSERPREFERENCES_GETVERTICALTABSBOOKMARKSSECTIONENABLED)

 private:
  ~AsideBrowserPreferencesGetVerticalTabsBookmarksSectionEnabledFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesSetVerticalTabsBookmarksSectionEnabledFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.setVerticalTabsBookmarksSectionEnabled", ASIDEBROWSERPREFERENCES_SETVERTICALTABSBOOKMARKSSECTIONENABLED)

 private:
  ~AsideBrowserPreferencesSetVerticalTabsBookmarksSectionEnabledFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesGetBrowserVersionFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.getBrowserVersion", ASIDEBROWSERPREFERENCES_GETBROWSERVERSION)

 private:
  ~AsideBrowserPreferencesGetBrowserVersionFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesGetSyncStatusFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.getSyncStatus", ASIDEBROWSERPREFERENCES_GETSYNCSTATUS)

 private:
  ~AsideBrowserPreferencesGetSyncStatusFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesCheckForUpdatesFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.checkForUpdates", ASIDEBROWSERPREFERENCES_CHECKFORUPDATES)

 private:
  ~AsideBrowserPreferencesCheckForUpdatesFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesGetLanguageSettingsFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.getLanguageSettings", ASIDEBROWSERPREFERENCES_GETLANGUAGESETTINGS)

 private:
  ~AsideBrowserPreferencesGetLanguageSettingsFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesGetSupportedLanguagesFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.getSupportedLanguages", ASIDEBROWSERPREFERENCES_GETSUPPORTEDLANGUAGES)

 private:
  ~AsideBrowserPreferencesGetSupportedLanguagesFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesSetPreferredLanguagesFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.setPreferredLanguages", ASIDEBROWSERPREFERENCES_SETPREFERREDLANGUAGES)

 private:
  ~AsideBrowserPreferencesSetPreferredLanguagesFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesSetSpellCheckEnabledFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.setSpellCheckEnabled", ASIDEBROWSERPREFERENCES_SETSPELLCHECKENABLED)

 private:
  ~AsideBrowserPreferencesSetSpellCheckEnabledFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesGetSearchEnginesFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.getSearchEngines", ASIDEBROWSERPREFERENCES_GETSEARCHENGINES)

 private:
  ~AsideBrowserPreferencesGetSearchEnginesFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserPreferencesSetDefaultSearchEngineFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserPreferences.setDefaultSearchEngine", ASIDEBROWSERPREFERENCES_SETDEFAULTSEARCHENGINE)

 private:
  ~AsideBrowserPreferencesSetDefaultSearchEngineFunction() final = default;
  ResponseAction Run() final;
};

}  // namespace extensions

#endif  // CHROME_BROWSER_EXTENSIONS_API_ASIDE_BROWSER_PREFERENCES_ASIDE_BROWSER_PREFERENCES_API_H_
