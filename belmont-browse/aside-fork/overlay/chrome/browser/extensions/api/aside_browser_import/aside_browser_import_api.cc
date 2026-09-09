// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/extensions/api/aside_browser_import/aside_browser_import_api.h"

#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/no_destructor.h"
#include "base/rand_util.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/stringprintf.h"
#include "base/strings/utf_string_conversions.h"
#include "base/values.h"
#include "build/build_config.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/importer/external_process_importer_host.h"
#include "chrome/browser/importer/importer_list.h"
#include "chrome/browser/importer/importer_progress_observer.h"
#include "chrome/browser/importer/profile_writer.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/common/extensions/api/aside_browser_import.h"
#include "components/user_data_importer/common/importer_data_types.h"
#include "components/user_data_importer/common/importer_type.h"
#include "content/public/browser/browser_context.h"
#include "extensions/browser/event_router.h"

namespace extensions {

namespace {

// Source ids are the original's string ids (RE 0x4024704.. WebUI import
// handler: chrome/firefox/safari/edge/brave/arc/dia/comet/atlas).
const char* SourceIdForType(user_data_importer::ImporterType type) {
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
    case user_data_importer::TYPE_IE:
      return "ie";
#endif
    case user_data_importer::TYPE_BOOKMARKS_FILE:
      return "bookmarks-file";
    default:
      return "unknown";
  }
}

const char* KindNameForItem(user_data_importer::ImportItem item) {
  switch (item) {
    case user_data_importer::HISTORY:
      return "history";
    case user_data_importer::FAVORITES:
      return "bookmarks";
    case user_data_importer::PASSWORDS:
      return "passwords";
    case user_data_importer::SEARCH_ENGINES:
      return "search_engines";
    case user_data_importer::HOME_PAGE:
      return "home_page";
    case user_data_importer::AUTOFILL_FORM_DATA:
      return "autofill";
    case user_data_importer::COOKIES:
      return "cookies";
    default:
      return "";
  }
}

uint16_t ItemForKind(const std::string& kind) {
  if (kind == "bookmarks" || kind == "favorites") {
    return user_data_importer::FAVORITES;
  }
  if (kind == "history") {
    return user_data_importer::HISTORY;
  }
  if (kind == "passwords") {
    return user_data_importer::PASSWORDS;
  }
  if (kind == "search_engines" || kind == "searchEngines") {
    return user_data_importer::SEARCH_ENGINES;
  }
  if (kind == "home_page" || kind == "homePage") {
    return user_data_importer::HOME_PAGE;
  }
  if (kind == "autofill" || kind == "autofill_form_data") {
    return user_data_importer::AUTOFILL_FORM_DATA;
  }
  return 0;
}

// RE 0x4051430: {jobId, progress, state, currentDataKind, errorMessage, sourceId}.
struct ImportJob {
  std::string source_id;
  std::string state = "queued";  // queued | importing | succeeded | failed | cancelled
  double progress = 0.0;
  std::string current_data_kind;
  std::string error_message;
  int total_items = 0;
  int finished_items = 0;
};

std::map<std::string, ImportJob>& Jobs() {
  static base::NoDestructor<std::map<std::string, ImportJob>> jobs;
  return *jobs;
}

// Last detected sources (populated by getImportSources) so startImport can
// resolve a source id + profile id back to a SourceProfile.
std::vector<user_data_importer::SourceProfile>& DetectedSources() {
  static base::NoDestructor<std::vector<user_data_importer::SourceProfile>> v;
  return *v;
}

base::DictValue ProgressDict(const std::string& job_id, const ImportJob& job) {
  base::DictValue dict;
  dict.Set("jobId", job_id);
  dict.Set("progress", job.progress);
  dict.Set("state", job.state);
  dict.Set("sourceId", job.source_id);
  if (!job.current_data_kind.empty()) {
    dict.Set("currentDataKind", job.current_data_kind);
  }
  if (!job.error_message.empty()) {
    dict.Set("errorMessage", job.error_message);
  }
  return dict;
}

void FireProgress(content::BrowserContext* context, const std::string& job_id) {
  auto it = Jobs().find(job_id);
  if (it == Jobs().end()) {
    return;
  }
  EventRouter* router = EventRouter::Get(context);
  if (!router) {
    return;
  }
  base::ListValue args;
  args.Append(ProgressDict(job_id, it->second));
  router->BroadcastEvent(std::make_unique<Event>(
      events::ASIDE_BROWSER_IMPORT_ON_IMPORT_PROGRESS,
      api::aside_browser_import::OnImportProgress::kEventName, std::move(args),
      context));
}

// Tracks one ExternalProcessImporterHost run; deletes itself on ImportEnded.
class JobObserver : public importer::ImporterProgressObserver {
 public:
  JobObserver(content::BrowserContext* context, std::string job_id, int total)
      : context_(context), job_id_(std::move(job_id)) {
    auto it = Jobs().find(job_id_);
    if (it != Jobs().end()) {
      it->second.total_items = total;
    }
  }
  ~JobObserver() override = default;

  void ImportStarted() override {
    Update([](ImportJob& job) { job.state = "importing"; });
  }
  void ImportItemStarted(user_data_importer::ImportItem item) override {
    Update([item](ImportJob& job) { job.current_data_kind = KindNameForItem(item); });
  }
  void ImportItemEnded(user_data_importer::ImportItem item) override {
    Update([](ImportJob& job) {
      job.finished_items++;
      if (job.total_items > 0) {
        job.progress = static_cast<double>(job.finished_items) / job.total_items;
      }
    });
  }
  void ImportEnded() override {
    Update([](ImportJob& job) {
      if (job.state != "cancelled") {
        job.state = "succeeded";
        job.progress = 1.0;
      }
      job.current_data_kind.clear();
    });
    delete this;
  }

 private:
  void Update(base::FunctionRef<void(ImportJob&)> fn) {
    auto it = Jobs().find(job_id_);
    if (it != Jobs().end()) {
      fn(it->second);
      FireProgress(context_, job_id_);
    }
  }
  raw_ptr<content::BrowserContext> context_;
  std::string job_id_;
};

std::string NewJobId() {
  return base::StringPrintf(
      "%016llX%016llX", static_cast<unsigned long long>(base::RandUint64()),
      static_cast<unsigned long long>(base::RandUint64()));
}

}  // namespace

ExtensionFunction::ResponseAction AsideBrowserImportGetImportSourcesFunction::Run() {
  importer_list_ = std::make_unique<ImporterList>();
  importer_list_->DetectSourceProfiles(
      g_browser_process->GetApplicationLocale(),
      /*include_interactive_profiles=*/false,
      base::BindOnce(
          &AsideBrowserImportGetImportSourcesFunction::OnSourcesReady, this));
  return RespondLater();
}

ExtensionFunction::ResponseAction AsideBrowserImportStartImportFunction::Run() {
  // RE 0x404f988: manual validation of the options dict.
  std::optional<api::aside_browser_import::StartImport::Params> params =
      api::aside_browser_import::StartImport::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid import options"));
  }
  Profile* profile = Profile::FromBrowserContext(browser_context());
  if (!profile) {
    return RespondNow(Error("Browser profile unavailable"));
  }
  const base::DictValue& options = params->options.additional_properties;
  const std::string* source_id = options.FindString("sourceId");
  if (!source_id || source_id->empty()) {
    return RespondNow(Error("Invalid import source"));
  }
  const base::ListValue* kinds = options.FindList("dataKinds");
  if (!kinds) {
    return RespondNow(Error("Invalid import options"));
  }
  const std::string* source_profile_id = options.FindString("sourceProfileId");
  if (*source_id == "safari") {
    const base::DictValue* archive = options.FindDict("safariArchive");
    if (!archive || !archive->Find("data")) {
      return RespondNow(Error("Safari import requires safariArchive.data"));
    }
  }
  if (!GetSenderWebContents()) {
    return RespondNow(Error("Import requires an extension page"));
  }
  // Resolve the source against the last detection.
  const user_data_importer::SourceProfile* source = nullptr;
  int index = 0;
  for (const auto& candidate : DetectedSources()) {
    if (SourceIdForType(candidate.importer_type) == *source_id &&
        (!source_profile_id || source_profile_id->empty() ||
         *source_profile_id == base::NumberToString(index))) {
      source = &candidate;
      break;
    }
    ++index;
  }
  if (!source) {
    return RespondNow(Error("Invalid import source"));
  }
  uint16_t items = 0;
  int total = 0;
  for (const base::Value& kind : *kinds) {
    if (!kind.is_string()) {
      return RespondNow(Error("Invalid import options"));
    }
    const uint16_t item = ItemForKind(kind.GetString());
    if (item && (source->services_supported & item)) {
      items |= item;
      ++total;
    }
  }
  if (!items) {
    return RespondNow(Error("Invalid import options"));
  }
  const std::string job_id = NewJobId();
  ImportJob job;
  job.source_id = *source_id;
  Jobs()[job_id] = job;
  // ExternalProcessImporterHost deletes itself when the import ends.
  ExternalProcessImporterHost* host = new ExternalProcessImporterHost();
  host->set_observer(new JobObserver(browser_context(), job_id, total));
  host->StartImportSettings(*source, profile, items, new ProfileWriter(profile));
  // RE 0x40505e0: {jobId, state:"queued"}.
  base::DictValue dict;
  dict.Set("jobId", job_id);
  dict.Set("state", "queued");
  return RespondNow(WithArguments(std::move(dict)));
}

ExtensionFunction::ResponseAction AsideBrowserImportGetImportProgressFunction::Run() {
  std::optional<api::aside_browser_import::GetImportProgress::Params> params =
      api::aside_browser_import::GetImportProgress::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid import job id"));
  }
  auto it = Jobs().find(params->job_id);
  if (it == Jobs().end()) {
    return RespondNow(Error("Invalid import job id"));
  }
  return RespondNow(WithArguments(ProgressDict(params->job_id, it->second)));
}

ExtensionFunction::ResponseAction AsideBrowserImportCancelImportFunction::Run() {
  std::optional<api::aside_browser_import::CancelImport::Params> params =
      api::aside_browser_import::CancelImport::Params::Create(args());
  if (!params) {
    return RespondNow(Error("Invalid import job id"));
  }
  auto it = Jobs().find(params->job_id);
  if (it == Jobs().end()) {
    return RespondNow(Error("Invalid import job id"));
  }
  if (it->second.state == "queued" || it->second.state == "importing") {
    it->second.state = "cancelled";
    FireProgress(browser_context(), params->job_id);
  }
  return RespondNow(NoArguments());
}

AsideBrowserImportGetImportSourcesFunction::
    AsideBrowserImportGetImportSourcesFunction() = default;

AsideBrowserImportGetImportSourcesFunction::
    ~AsideBrowserImportGetImportSourcesFunction() = default;

void AsideBrowserImportGetImportSourcesFunction::OnSourcesReady() {
  DetectedSources().clear();
  base::ListValue sources;
  for (size_t i = 0; i < importer_list_->count(); ++i) {
    const user_data_importer::SourceProfile& p =
        importer_list_->GetSourceProfileAt(i);
    DetectedSources().push_back(p);
    // Original import-source shape: {id, name, profiles:[{id, name, lastUsedAt?}]}.
    base::DictValue entry;
    entry.Set("id", SourceIdForType(p.importer_type));
    entry.Set("name", base::UTF16ToUTF8(p.importer_name));
    base::ListValue profiles;
    base::DictValue prof;
    prof.Set("id", base::NumberToString(i));
    prof.Set("name", p.profile.empty() ? base::UTF16ToUTF8(p.importer_name)
                                       : base::UTF16ToUTF8(p.profile));
    profiles.Append(std::move(prof));
    entry.Set("profiles", std::move(profiles));
    sources.Append(std::move(entry));
  }
  base::DictValue dict;
  dict.Set("sources", std::move(sources));
  Respond(WithArguments(std::move(dict)));
}

}  // namespace extensions
