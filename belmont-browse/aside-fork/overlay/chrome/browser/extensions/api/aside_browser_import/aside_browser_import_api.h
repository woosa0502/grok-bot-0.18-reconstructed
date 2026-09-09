// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_EXTENSIONS_API_ASIDE_BROWSER_IMPORT_ASIDE_BROWSER_IMPORT_API_H_
#define CHROME_BROWSER_EXTENSIONS_API_ASIDE_BROWSER_IMPORT_ASIDE_BROWSER_IMPORT_API_H_

#include <memory>

#include "extensions/browser/extension_function.h"

class ImporterList;

namespace extensions {

class AsideBrowserImportGetImportSourcesFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserImport.getImportSources", ASIDEBROWSERIMPORT_GETIMPORTSOURCES)
  AsideBrowserImportGetImportSourcesFunction();

 private:
  ~AsideBrowserImportGetImportSourcesFunction() final;
  ResponseAction Run() final;
  void OnSourcesReady();
  std::unique_ptr<ImporterList> importer_list_;
};

class AsideBrowserImportStartImportFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserImport.startImport", ASIDEBROWSERIMPORT_STARTIMPORT)

 private:
  ~AsideBrowserImportStartImportFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserImportGetImportProgressFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserImport.getImportProgress", ASIDEBROWSERIMPORT_GETIMPORTPROGRESS)

 private:
  ~AsideBrowserImportGetImportProgressFunction() final = default;
  ResponseAction Run() final;
};

class AsideBrowserImportCancelImportFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideBrowserImport.cancelImport", ASIDEBROWSERIMPORT_CANCELIMPORT)

 private:
  ~AsideBrowserImportCancelImportFunction() final = default;
  ResponseAction Run() final;
};

}  // namespace extensions

#endif  // CHROME_BROWSER_EXTENSIONS_API_ASIDE_BROWSER_IMPORT_ASIDE_BROWSER_IMPORT_API_H_
