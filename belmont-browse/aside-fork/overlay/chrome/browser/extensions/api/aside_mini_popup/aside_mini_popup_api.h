// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_EXTENSIONS_API_ASIDE_MINI_POPUP_ASIDE_MINI_POPUP_API_H_
#define CHROME_BROWSER_EXTENSIONS_API_ASIDE_MINI_POPUP_ASIDE_MINI_POPUP_API_H_

#include "base/memory/scoped_refptr.h"
#include "extensions/browser/extension_function.h"
#include "ui/shell_dialogs/select_file_dialog.h"

class Browser;

namespace ui {
struct SelectedFileInfo;
}  // namespace ui

namespace extensions {

class AsideMiniPopupHideFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideMiniPopup.hide", ASIDEMINIPOPUP_HIDE)

 private:
  ~AsideMiniPopupHideFunction() final = default;
  ResponseAction Run() final;
};

class AsideMiniPopupGetEnabledFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideMiniPopup.getEnabled", ASIDEMINIPOPUP_GETENABLED)

 private:
  ~AsideMiniPopupGetEnabledFunction() final = default;
  ResponseAction Run() final;
};

class AsideMiniPopupSetEnabledFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideMiniPopup.setEnabled", ASIDEMINIPOPUP_SETENABLED)

 private:
  ~AsideMiniPopupSetEnabledFunction() final = default;
  ResponseAction Run() final;
};

class AsideMiniPopupGetShortcutFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideMiniPopup.getShortcut", ASIDEMINIPOPUP_GETSHORTCUT)

 private:
  ~AsideMiniPopupGetShortcutFunction() final = default;
  ResponseAction Run() final;
};

class AsideMiniPopupSetShortcutFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideMiniPopup.setShortcut", ASIDEMINIPOPUP_SETSHORTCUT)

 private:
  ~AsideMiniPopupSetShortcutFunction() final = default;
  ResponseAction Run() final;
};

class AsideMiniPopupSetStateFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideMiniPopup.setState", ASIDEMINIPOPUP_SETSTATE)

 private:
  ~AsideMiniPopupSetStateFunction() final = default;
  ResponseAction Run() final;
};

class AsideMiniPopupSetSizeFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideMiniPopup.setSize", ASIDEMINIPOPUP_SETSIZE)

 private:
  ~AsideMiniPopupSetSizeFunction() final = default;
  ResponseAction Run() final;
};

class AsideMiniPopupSetOptionWindowSizeFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideMiniPopup.setOptionWindowSize", ASIDEMINIPOPUP_SETOPTIONWINDOWSIZE)

 private:
  ~AsideMiniPopupSetOptionWindowSizeFunction() final = default;
  ResponseAction Run() final;
};

class AsideMiniPopupPickDirectoryFunction final
    : public ExtensionFunction,
      public ui::SelectFileDialog::Listener {
 public:
  DECLARE_EXTENSION_FUNCTION("asideMiniPopup.pickDirectory", ASIDEMINIPOPUP_PICKDIRECTORY)
  AsideMiniPopupPickDirectoryFunction();

 private:
  ~AsideMiniPopupPickDirectoryFunction() final;
  ResponseAction Run() final;
  // ui::SelectFileDialog::Listener:
  void FileSelected(const ui::SelectedFileInfo& file, int index) override;
  void FileSelectionCanceled() override;

  scoped_refptr<ui::SelectFileDialog> select_file_dialog_;
};

class AsideMiniPopupSwitchProfileFunction final : public ExtensionFunction {
 public:
  DECLARE_EXTENSION_FUNCTION("asideMiniPopup.switchProfile", ASIDEMINIPOPUP_SWITCHPROFILE)

 private:
  ~AsideMiniPopupSwitchProfileFunction() final = default;
  ResponseAction Run() final;
  void OnProfileSwitched(Browser* browser);
};

}  // namespace extensions

#endif  // CHROME_BROWSER_EXTENSIONS_API_ASIDE_MINI_POPUP_ASIDE_MINI_POPUP_API_H_
