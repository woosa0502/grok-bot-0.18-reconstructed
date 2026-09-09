// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_EXTENSIONS_API_ASIDE_OMNIBOX_ASIDE_OMNIBOX_API_H_
#define CHROME_BROWSER_EXTENSIONS_API_ASIDE_OMNIBOX_ASIDE_OMNIBOX_API_H_

#include "extensions/browser/extension_function.h"

namespace extensions {

class AsideOmniboxCreateSessionFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.createSession", ASIDEOMNIBOX_CREATESESSION)

 private:
  ~AsideOmniboxCreateSessionFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxDestroySessionFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.destroySession", ASIDEOMNIBOX_DESTROYSESSION)

 private:
  ~AsideOmniboxDestroySessionFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxGetSearchEnginesFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.getSearchEngines", ASIDEOMNIBOX_GETSEARCHENGINES)

 private:
  ~AsideOmniboxGetSearchEnginesFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxOnFocusChangedFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.onFocusChanged", ASIDEOMNIBOX_ONFOCUSCHANGED)

 private:
  ~AsideOmniboxOnFocusChangedFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxQueryAutocompleteFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.queryAutocomplete", ASIDEOMNIBOX_QUERYAUTOCOMPLETE)

 private:
  ~AsideOmniboxQueryAutocompleteFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxStopAutocompleteFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.stopAutocomplete", ASIDEOMNIBOX_STOPAUTOCOMPLETE)

 private:
  ~AsideOmniboxStopAutocompleteFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxOpenAutocompleteMatchFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.openAutocompleteMatch", ASIDEOMNIBOX_OPENAUTOCOMPLETEMATCH)

 private:
  ~AsideOmniboxOpenAutocompleteMatchFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxSetPopupSelectionFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.setPopupSelection", ASIDEOMNIBOX_SETPOPUPSELECTION)

 private:
  ~AsideOmniboxSetPopupSelectionFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxOpenPopupSelectionFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.openPopupSelection", ASIDEOMNIBOX_OPENPOPUPSELECTION)

 private:
  ~AsideOmniboxOpenPopupSelectionFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxOnNavigationLikelyFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.onNavigationLikely", ASIDEOMNIBOX_ONNAVIGATIONLIKELY)

 private:
  ~AsideOmniboxOnNavigationLikelyFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxDeleteAutocompleteMatchFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.deleteAutocompleteMatch", ASIDEOMNIBOX_DELETEAUTOCOMPLETEMATCH)

 private:
  ~AsideOmniboxDeleteAutocompleteMatchFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxActivateKeywordFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.activateKeyword", ASIDEOMNIBOX_ACTIVATEKEYWORD)

 private:
  ~AsideOmniboxActivateKeywordFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxExecuteActionFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.executeAction", ASIDEOMNIBOX_EXECUTEACTION)

 private:
  ~AsideOmniboxExecuteActionFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxOnThumbnailRemovedFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.onThumbnailRemoved", ASIDEOMNIBOX_ONTHUMBNAILREMOVED)

 private:
  ~AsideOmniboxOnThumbnailRemovedFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxGetPlaceholderConfigFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.getPlaceholderConfig", ASIDEOMNIBOX_GETPLACEHOLDERCONFIG)

 private:
  ~AsideOmniboxGetPlaceholderConfigFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxGetRecentTabsFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.getRecentTabs", ASIDEOMNIBOX_GETRECENTTABS)

 private:
  ~AsideOmniboxGetRecentTabsFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxGetTabPreviewFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.getTabPreview", ASIDEOMNIBOX_GETTABPREVIEW)

 private:
  ~AsideOmniboxGetTabPreviewFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxGetInputStateFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.getInputState", ASIDEOMNIBOX_GETINPUTSTATE)

 private:
  ~AsideOmniboxGetInputStateFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxNotifySessionStartedFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.notifySessionStarted", ASIDEOMNIBOX_NOTIFYSESSIONSTARTED)

 private:
  ~AsideOmniboxNotifySessionStartedFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxNotifySessionAbandonedFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.notifySessionAbandoned", ASIDEOMNIBOX_NOTIFYSESSIONABANDONED)

 private:
  ~AsideOmniboxNotifySessionAbandonedFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxAddFileContextFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.addFileContext", ASIDEOMNIBOX_ADDFILECONTEXT)

 private:
  ~AsideOmniboxAddFileContextFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxAddTabContextFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.addTabContext", ASIDEOMNIBOX_ADDTABCONTEXT)

 private:
  ~AsideOmniboxAddTabContextFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxDeleteContextFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.deleteContext", ASIDEOMNIBOX_DELETECONTEXT)

 private:
  ~AsideOmniboxDeleteContextFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxClearFilesFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.clearFiles", ASIDEOMNIBOX_CLEARFILES)

 private:
  ~AsideOmniboxClearFilesFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxSubmitQueryFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.submitQuery", ASIDEOMNIBOX_SUBMITQUERY)

 private:
  ~AsideOmniboxSubmitQueryFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxOpenLensSearchFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.openLensSearch", ASIDEOMNIBOX_OPENLENSSEARCH)

 private:
  ~AsideOmniboxOpenLensSearchFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxSetActiveToolModeFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.setActiveToolMode", ASIDEOMNIBOX_SETACTIVETOOLMODE)

 private:
  ~AsideOmniboxSetActiveToolModeFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxSetActiveModelModeFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.setActiveModelMode", ASIDEOMNIBOX_SETACTIVEMODELMODE)

 private:
  ~AsideOmniboxSetActiveModelModeFunction() final = default;
  ResponseAction Run() final;
};

class AsideOmniboxActivateMetricsFunnelFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideOmnibox.activateMetricsFunnel", ASIDEOMNIBOX_ACTIVATEMETRICSFUNNEL)

 private:
  ~AsideOmniboxActivateMetricsFunnelFunction() final = default;
  ResponseAction Run() final;
};

}  // namespace extensions

#endif  // CHROME_BROWSER_EXTENSIONS_API_ASIDE_OMNIBOX_ASIDE_OMNIBOX_API_H_
