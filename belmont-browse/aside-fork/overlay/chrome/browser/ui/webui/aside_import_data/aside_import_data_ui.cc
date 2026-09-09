// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/webui/aside_import_data/aside_import_data_ui.h"

#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/base_paths.h"
#include "base/files/file_enumerator.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/files/scoped_temp_dir.h"
#include "base/functional/bind.h"
#include "base/json/json_writer.h"
#include "base/memory/ref_counted_memory.h"
#include "base/memory/weak_ptr.h"
#include "base/path_service.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/thread_pool.h"
#include "base/values.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/importer/external_process_importer_host.h"
#include "chrome/browser/importer/importer_list.h"
#include "chrome/browser/importer/importer_progress_observer.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/importer/profile_writer.h"
#include "chrome/browser/ui/select_file_policy/chrome_select_file_policy.h"
#include "components/user_data_importer/common/importer_data_types.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/web_ui_data_source.h"
#include "content/public/browser/web_ui_message_handler.h"
#include "net/base/mime_util.h"
#include "third_party/zlib/google/zip.h"
#include "ui/shell_dialogs/select_file_dialog.h"
#include "ui/shell_dialogs/selected_file_info.h"

namespace {

constexpr char kSafariInvalidZip[] = "This is not a valid Safari data ZIP file.";
constexpr char kChromiumImportFailed[] = "Chromium browser import failed";

base::FilePath ResourceRoot() {
  base::FilePath dir;
  base::PathService::Get(base::DIR_MODULE, &dir);
  return dir.Append(FILE_PATH_LITERAL("aside_resources"))
      .Append(FILE_PATH_LITERAL("import_data"));
}

std::string ReadResource(const std::string& path) {
  std::string rel = path.empty() ? "index.html" : path;
  const size_t query = rel.find('?');
  if (query != std::string::npos) {
    rel = rel.substr(0, query);
  }
  if (rel.find("..") != std::string::npos) {
    return std::string();
  }
  std::string contents;
  base::ReadFileToString(ResourceRoot().AppendASCII(rel), &contents);
  return contents;
}

bool ShouldServe(const std::string& path) {
  return path.empty() || path == "index.html" || path == "app.js" ||
         path.starts_with("icons/");
}

void ServeResource(const std::string& path,
                   content::WebUIDataSource::GotDataCallback callback) {
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::MayBlock()}, base::BindOnce(&ReadResource, path),
      base::BindOnce(
          [](content::WebUIDataSource::GotDataCallback callback,
             std::string data) {
            std::move(callback).Run(
                base::MakeRefCounted<base::RefCountedString>(std::move(data)));
          },
          std::move(callback)));
}

const char* BrowserIdForType(user_data_importer::ImporterType type) {
  switch (type) {
    case user_data_importer::TYPE_FIREFOX:
      return "firefox";
#if BUILDFLAG(IS_MAC)
    case user_data_importer::TYPE_SAFARI:
      return "safari";
#endif
#if BUILDFLAG(IS_WIN)
    case user_data_importer::TYPE_EDGE:
      return "edge";
#endif
    default:
      return nullptr;
  }
}

// Result of unpacking a Safari export ZIP: the Bookmarks.html inside it.
struct SafariArchive {
  std::unique_ptr<base::ScopedTempDir> dir;
  base::FilePath bookmarks_html;
};

SafariArchive UnpackSafariZip(const base::FilePath& zip) {
  SafariArchive result;
  result.dir = std::make_unique<base::ScopedTempDir>();
  if (!result.dir->CreateUniqueTempDir() ||
      !zip::Unzip(zip, result.dir->GetPath())) {
    return result;
  }
  base::FileEnumerator files(result.dir->GetPath(), true,
                             base::FileEnumerator::FILES,
                             FILE_PATH_LITERAL("Bookmarks.html"));
  result.bookmarks_html = files.Next();
  return result;
}

class AsideImportDataHandler : public content::WebUIMessageHandler,
                               public importer::ImporterProgressObserver,
                               public ui::SelectFileDialog::Listener {
 public:
  AsideImportDataHandler() = default;
  ~AsideImportDataHandler() override {
    if (select_file_dialog_) {
      select_file_dialog_->ListenerDestroyed();
    }
  }

  // content::WebUIMessageHandler:
  void RegisterMessages() override {
    web_ui()->RegisterMessageCallback(
        "importFirefoxData",
        base::BindRepeating(&AsideImportDataHandler::HandleImportFirefox,
                            base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "showProfilePicker",
        base::BindRepeating(&AsideImportDataHandler::HandleShowProfilePicker,
                            base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "selectSafariExportZipFile",
        base::BindRepeating(&AsideImportDataHandler::HandleSelectSafariZip,
                            base::Unretained(this)));
  }

  void DetectSources(base::OnceClosure done) {
    importer_list_ = std::make_unique<ImporterList>();
    importer_list_->DetectSourceProfiles(
        g_browser_process->GetApplicationLocale(),
        /*include_interactive_profiles=*/false, std::move(done));
  }

  const ImporterList* importer_list() const { return importer_list_.get(); }

 private:
  Profile* profile() { return Profile::FromWebUI(web_ui()); }

  void HandleImportFirefox(const base::ListValue& args) {
    AllowJavascript();
    StartImportOfType(user_data_importer::TYPE_FIREFOX, "firefox");
  }

  void HandleShowProfilePicker(const base::ListValue& args) {
    AllowJavascript();
    const std::string id =
        !args.empty() && args[0].is_string() ? args[0].GetString() : "chrome";
    // Chromium-family sources are only detected on macOS / Windows.
    user_data_importer::ImporterType type = user_data_importer::TYPE_UNKNOWN;
#if BUILDFLAG(IS_WIN)
    if (id == "edge") {
      type = user_data_importer::TYPE_EDGE;
    }
#endif
    if (type == user_data_importer::TYPE_UNKNOWN) {
      FireWebUIListener("browser-import-failed", base::Value(id),
                        base::Value(kChromiumImportFailed));
      return;
    }
    StartImportOfType(type, id);
  }

  void HandleSelectSafariZip(const base::ListValue& args) {
    AllowJavascript();
    if (select_file_dialog_) {
      return;
    }
    select_file_dialog_ = ui::SelectFileDialog::Create(
        this, std::make_unique<ChromeSelectFilePolicy>(
                  web_ui()->GetWebContents()));
    ui::SelectFileDialog::FileTypeInfo types;
    types.extensions = {{FILE_PATH_LITERAL("zip")}};
    select_file_dialog_->SelectFile(
        ui::SelectFileDialog::SELECT_OPEN_FILE, std::u16string(),
        base::FilePath(), &types, 0, FILE_PATH_LITERAL("zip"),
        web_ui()->GetWebContents()->GetTopLevelNativeWindow());
  }

  // ui::SelectFileDialog::Listener:
  void FileSelected(const ui::SelectedFileInfo& file, int index) override {
    select_file_dialog_.reset();
    base::ThreadPool::PostTaskAndReplyWithResult(
        FROM_HERE, {base::MayBlock()},
        base::BindOnce(&UnpackSafariZip, file.path()),
        base::BindOnce(&AsideImportDataHandler::OnSafariZipUnpacked,
                       weak_factory_.GetWeakPtr()));
  }
  void FileSelectionCanceled() override { select_file_dialog_.reset(); }

  void OnSafariZipUnpacked(SafariArchive archive) {
    if (archive.bookmarks_html.empty()) {
      FireWebUIListener("safari-import-invalid-file",
                        base::Value(kSafariInvalidZip));
      return;
    }
    safari_archive_ = std::move(archive);
    user_data_importer::SourceProfile source;
    source.importer_type = user_data_importer::TYPE_BOOKMARKS_FILE;
    source.source_path = safari_archive_.bookmarks_html;
    StartImport(source, user_data_importer::FAVORITES, "safari");
  }

  void StartImportOfType(user_data_importer::ImporterType type,
                         const std::string& id) {
    if (!importer_list_) {
      FireWebUIListener("browser-import-failed", base::Value(id),
                        base::Value(kChromiumImportFailed));
      return;
    }
    for (size_t i = 0; i < importer_list_->count(); ++i) {
      const user_data_importer::SourceProfile& source =
          importer_list_->GetSourceProfileAt(i);
      if (source.importer_type == type) {
        StartImport(source,
                    source.services_supported &
                        (user_data_importer::HISTORY |
                         user_data_importer::FAVORITES |
                         user_data_importer::PASSWORDS |
                         user_data_importer::SEARCH_ENGINES |
                         user_data_importer::AUTOFILL_FORM_DATA),
                    id);
        return;
      }
    }
    FireWebUIListener("browser-import-failed", base::Value(id),
                      base::Value("No profile found for " + id));
  }

  void StartImport(const user_data_importer::SourceProfile& source,
                   uint16_t items,
                   const std::string& id) {
    if (importing_) {
      return;
    }
    importing_ = true;
    current_id_ = id;
    FireWebUIListener("browser-import-started", base::Value(id));
    // ExternalProcessImporterHost deletes itself when the import ends.
    ExternalProcessImporterHost* host = new ExternalProcessImporterHost();
    host->set_observer(this);
    host->StartImportSettings(source, profile(), items,
                              new ProfileWriter(profile()));
  }

  // importer::ImporterProgressObserver:
  void ImportStarted() override {}
  void ImportItemStarted(user_data_importer::ImportItem item) override {}
  void ImportItemEnded(user_data_importer::ImportItem item) override {}
  void ImportEnded() override {
    importing_ = false;
    FireWebUIListener("browser-import-succeeded", base::Value(current_id_));
    safari_archive_ = SafariArchive();
  }

  std::unique_ptr<ImporterList> importer_list_;
  scoped_refptr<ui::SelectFileDialog> select_file_dialog_;
  SafariArchive safari_archive_;
  bool importing_ = false;
  std::string current_id_;
  base::WeakPtrFactory<AsideImportDataHandler> weak_factory_{this};
};

}  // namespace

AsideImportDataUI::AsideImportDataUI(content::WebUI* web_ui)
    : content::WebUIController(web_ui) {
  Profile* profile = Profile::FromWebUI(web_ui);
  content::WebUIDataSource* source = content::WebUIDataSource::CreateAndAdd(
      profile, kChromeUIAsideImportDataHost);
  source->UseStringsJs();
  source->DisableTrustedTypesCSP();
  source->SetRequestFilter(base::BindRepeating(&ShouldServe),
                           base::BindRepeating(&ServeResource));

  auto handler = std::make_unique<AsideImportDataHandler>();
  AsideImportDataHandler* raw = handler.get();
  web_ui->AddMessageHandler(std::move(handler));
  // installedBrowsers is read synchronously by the page; detection is async,
  // so the page is served after detection through the data source's strings.
  raw->DetectSources(base::BindOnce(
      [](base::WeakPtr<content::WebUIDataSource> unused,
         AsideImportDataHandler* handler, content::WebUIDataSource* source) {
        base::ListValue ids;
        const ImporterList* list = handler->importer_list();
        for (size_t i = 0; list && i < list->count(); ++i) {
          if (const char* id =
                  BrowserIdForType(list->GetSourceProfileAt(i).importer_type)) {
            ids.Append(id);
          }
        }
        std::string json;
        base::JSONWriter::Write(ids, &json);
        source->AddString("installedBrowsers", json);
      },
      base::WeakPtr<content::WebUIDataSource>(), raw, source));
}

AsideImportDataUI::~AsideImportDataUI() = default;
