// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_WEBUI_ASIDE_IMPORT_DATA_ASIDE_IMPORT_DATA_UI_H_
#define CHROME_BROWSER_UI_WEBUI_ASIDE_IMPORT_DATA_ASIDE_IMPORT_DATA_UI_H_

#include "content/public/browser/web_ui_controller.h"
#include "content/public/browser/webui_config.h"
#include "content/public/common/url_constants.h"

class AsideImportDataUI;

inline constexpr char kChromeUIAsideImportDataHost[] = "aside-import-data";

// chrome://aside-import-data — the original's "Aside Importer" page
// (aside_resources.pak 16140 index.html / 16141 app.js + browser icons).
// The page reads loadTimeData "installedBrowsers" (JSON list of ids), sends
// importFirefoxData / showProfilePicker / selectSafariExportZipFile and
// listens for browser-import-started / -succeeded / -failed /
// safari-import-invalid-file.
class AsideImportDataUIConfig
    : public content::DefaultWebUIConfig<AsideImportDataUI> {
 public:
  AsideImportDataUIConfig()
      : DefaultWebUIConfig(content::kChromeUIScheme,
                           kChromeUIAsideImportDataHost) {}
};

class AsideImportDataUI : public content::WebUIController {
 public:
  explicit AsideImportDataUI(content::WebUI* web_ui);
  AsideImportDataUI(const AsideImportDataUI&) = delete;
  AsideImportDataUI& operator=(const AsideImportDataUI&) = delete;
  ~AsideImportDataUI() override;
};

#endif  // CHROME_BROWSER_UI_WEBUI_ASIDE_IMPORT_DATA_ASIDE_IMPORT_DATA_UI_H_
