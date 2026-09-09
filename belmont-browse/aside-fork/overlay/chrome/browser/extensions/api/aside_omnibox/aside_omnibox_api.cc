// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/extensions/api/aside_omnibox/aside_omnibox_api.h"

#include <optional>
#include <string>
#include <utility>

#include "base/base64.h"
#include "base/json/json_writer.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "base/values.h"
#include "chrome/browser/extensions/api/aside_omnibox/aside_omnibox_service.h"
#include "chrome/browser/extensions/api/aside_omnibox/aside_omnibox_session.h"
#include "chrome/browser/extensions/extension_tab_util.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/search_engines/template_url_service_factory.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface_iterator.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/common/extensions/api/aside_omnibox.h"
#include "components/contextual_search/pref_names.h"
#include "components/omnibox/browser/autocomplete_match.h"
#include "components/omnibox/browser/autocomplete_result.h"
#include "components/omnibox/browser/omnibox_pref_names.h"
#include "components/prefs/pref_service.h"
#include "components/search_engines/template_url.h"
#include "components/search_engines/template_url_service.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/web_contents.h"
#include "extensions/common/extension.h"
#include "ui/base/window_open_disposition.h"
#include "ui/base/window_open_disposition_utils.h"
#include "url/gurl.h"

namespace extensions {

namespace {

// Error strings are verbatim from the original (RE of every asideOmnibox
// handler, 0x40596d0..0x4063a40).
constexpr char kInvalidArguments[] = "Invalid arguments";
constexpr char kSessionNotFound[] =
    "asideOmnibox session not found or not owned by this extension";
constexpr char kServiceUnavailable[] = "asideOmnibox service is unavailable";
constexpr char kInvalidTabId[] = "Invalid tabId";

// RE 0x40594e0: sessions are looked up by id AND owning extension.
AsideOmniboxSession* FindSession(ExtensionFunction* fn,
                                 const std::string& session_id,
                                 std::string* error) {
  AsideOmniboxService* service = AsideOmniboxService::Get(fn->browser_context());
  if (!service) {
    *error = kServiceUnavailable;
    return nullptr;
  }
  AsideOmniboxSession* session = service->GetSessionForExtension(
      session_id, fn->extension() ? fn->extension()->id() : std::string());
  if (!session) {
    *error = kSessionNotFound;
  }
  return session;
}

BrowserWindowInterface* FindBrowserForProfile(Profile* profile) {
  BrowserWindowInterface* browser = nullptr;
  ForEachCurrentBrowserWindowInterfaceOrderedByActivation(
      [&](BrowserWindowInterface* candidate) {
        if (candidate->GetProfile() == profile) {
          browser = candidate;
          return false;
        }
        return true;
      });
  return browser;
}

// Mouse/modifier fields shared by openAutocompleteMatch / openPopupSelection /
// executeAction / submitQuery (RE: mouseButton, altKey, ctrlKey, metaKey,
// shiftKey) -> Chromium's standard click disposition.
WindowOpenDisposition DispositionFromRequest(const base::DictValue& request) {
  const int mouse_button = request.FindInt("mouseButton").value_or(0);
  return ui::DispositionFromClick(
      /*middle_button=*/mouse_button == 1,
      request.FindBool("altKey").value_or(false),
      request.FindBool("ctrlKey").value_or(false),
      request.FindBool("metaKey").value_or(false),
      request.FindBool("shiftKey").value_or(false));
}

void OpenUrl(Profile* profile, const GURL& url, WindowOpenDisposition disposition) {
  if (!url.is_valid()) {
    return;
  }
  if (BrowserWindowInterface* browser = FindBrowserForProfile(profile)) {
    browser->OpenGURL(url, disposition);
  }
}

// Resolves the match URL for a request: explicit "url" wins, else the match
// at "line" in the session's current result.
GURL MatchUrlFromRequest(AsideOmniboxSession* session,
                         const base::DictValue& request) {
  if (const std::string* url = request.FindString("url")) {
    return GURL(*url);
  }
  const std::optional<int> line = request.FindInt("line");
  const AutocompleteResult& result = session->result();
  if (line && *line >= 0 && static_cast<size_t>(*line) < result.size()) {
    return result.match_at(static_cast<size_t>(*line)).destination_url;
  }
  return GURL();
}

double MillisSinceEpoch(base::Time t) {
  return t.is_null() ? 0.0
                     : static_cast<double>(t.InMillisecondsSinceUnixEpoch());
}

base::ListValue StringList(const std::vector<std::string>& values) {
  base::ListValue list;
  for (const std::string& v : values) {
    list.Append(v);
  }
  return list;
}

}  // namespace

ExtensionFunction::ResponseAction AsideOmniboxCreateSessionFunction::Run() {
  std::optional<api::aside_omnibox::CreateSession::Params> params =
      api::aside_omnibox::CreateSession::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  AsideOmniboxService* service = AsideOmniboxService::Get(browser_context());
  if (!service) {
    return RespondNow(Error(kServiceUnavailable));
  }
  Profile* profile = Profile::FromBrowserContext(browser_context());
  // RE 0x4059740: an explicit options.tabId must resolve to a tab; otherwise
  // the active tab of the most recently active window for this profile.
  content::WebContents* target = nullptr;
  std::optional<int> requested_tab_id;
  if (params->options) {
    requested_tab_id = params->options->additional_properties.FindInt("tabId");
  }
  if (requested_tab_id) {
    if (!ExtensionTabUtil::GetTabById(*requested_tab_id, profile,
                                      include_incognito_information(),
                                      &target) ||
        !target) {
      return RespondNow(Error(kInvalidTabId));
    }
  } else if (BrowserWindowInterface* browser = FindBrowserForProfile(profile)) {
    target = browser->GetTabStripModel()->GetActiveWebContents();
  }
  if (!target) {
    return RespondNow(
        Error("No target tab available for asideOmnibox session"));
  }
  const std::string session_id = service->CreateSession(
      browser_context(), extension() ? extension()->id() : std::string());
  AsideOmniboxSession* session = service->GetSession(session_id);
  if (!session) {
    return RespondNow(Error("Failed to create asideOmnibox session"));
  }
  const int target_tab_id = ExtensionTabUtil::GetTabId(target);
  session->set_target_tab_id(target_tab_id);

  // RE 0x405a41c..0x405a5f0: {sessionId, targetInternalTabId, targetTabId,
  // targetUrl, contentSharingEnabled, aimEligible, canShowAiMode}.
  base::DictValue dict;
  dict.Set("sessionId", session_id);
  if (tabs::TabInterface* tab = tabs::TabInterface::MaybeGetFromContents(target)) {
    dict.Set("targetInternalTabId", tab->GetHandle().raw_value());
  }
  dict.Set("targetTabId", target_tab_id);
  dict.Set("targetUrl", target->GetLastCommittedURL().spec());
  PrefService* prefs = profile->GetPrefs();
  const bool content_sharing_enabled =
      prefs->FindPreference(contextual_search::kSearchContentSharingSettings) &&
      prefs->GetInteger(contextual_search::kSearchContentSharingSettings) == 0;
  dict.Set("contentSharingEnabled", content_sharing_enabled);
  // The original asks the (Google) contextual search service; that service does
  // not exist in this fork, so AI-mode eligibility is reported as false.
  dict.Set("aimEligible", false);
  dict.Set("canShowAiMode",
           prefs->FindPreference(omnibox::kShowAiModeOmniboxButton) &&
               prefs->GetBoolean(omnibox::kShowAiModeOmniboxButton));
  return RespondNow(WithArguments(std::move(dict)));
}

ExtensionFunction::ResponseAction AsideOmniboxDestroySessionFunction::Run() {
  std::optional<api::aside_omnibox::DestroySession::Params> params =
      api::aside_omnibox::DestroySession::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  if (!FindSession(this, params->session_id, &error)) {
    return RespondNow(Error(error));
  }
  AsideOmniboxService::Get(browser_context())->DestroySession(params->session_id);
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideOmniboxGetSearchEnginesFunction::Run() {
  Profile* profile = Profile::FromBrowserContext(browser_context());
  base::DictValue dict;
  base::ListValue engines;
  std::string default_engine_id;
  TemplateURLService* service =
      TemplateURLServiceFactory::GetForProfile(profile);
  const bool loaded = service && service->loaded();
  if (loaded) {
    const TemplateURL* default_provider = service->GetDefaultSearchProvider();
    if (default_provider) {
      default_engine_id = base::NumberToString(default_provider->id());
    }
    // RE 0x405ac80: the full TemplateURLData projection.
    for (TemplateURL* turl : service->GetTemplateURLs()) {
      base::DictValue entry;
      entry.Set("id", base::NumberToString(turl->id()));
      entry.Set("shortName", base::UTF16ToUTF8(turl->short_name()));
      entry.Set("keyword", base::UTF16ToUTF8(turl->keyword()));
      entry.Set("isDefault",
                default_provider && default_provider->id() == turl->id());
      entry.Set("featuredByPolicy", turl->featured_by_policy());
      entry.Set("enforcedByPolicy", turl->enforced_by_policy());
      entry.Set("faviconUrl", turl->favicon_url().spec());
      entry.Set("logoUrl", turl->logo_url().spec());
      entry.Set("doodleUrl", turl->doodle_url().spec());
      entry.Set("originatingUrl", turl->originating_url().spec());
      entry.Set("searchUrlTemplate", turl->url());
      entry.Set("suggestUrlTemplate", turl->suggestions_url());
      entry.Set("imageUrlTemplate", turl->image_url());
      entry.Set("imageTranslateUrlTemplate", turl->image_translate_url());
      entry.Set("newTabUrl", turl->new_tab_url());
      entry.Set("contextualSearchUrl", turl->contextual_search_url());
      entry.Set("alternateUrls", StringList(turl->alternate_urls()));
      entry.Set("inputEncodings", StringList(turl->input_encodings()));
      entry.Set("searchIntentParams", StringList(turl->search_intent_params()));
      entry.Set("prepopulateId", turl->prepopulate_id());
      entry.Set("usageCount", turl->usage_count());
      entry.Set("safeForAutoreplace", turl->safe_for_autoreplace());
      entry.Set("dateCreatedMs", MillisSinceEpoch(turl->date_created()));
      entry.Set("lastModifiedMs", MillisSinceEpoch(turl->last_modified()));
      entry.Set("lastVisitedMs", MillisSinceEpoch(turl->last_visited()));
      engines.Append(std::move(entry));
    }
  } else if (service) {
    service->Load();
  }
  dict.Set("engines", std::move(engines));
  dict.Set("defaultEngineId", default_engine_id);
  dict.Set("loaded", loaded);
  return RespondNow(WithArguments(std::move(dict)));
}

// ---- Session-scoped no-op notifications (the original validates the session
// and acknowledges; the UI side effects live in its searchbox mojo page). ----

#define ASIDE_OMNIBOX_SESSION_ACK(ClassName, ParamsType)                    \
  ExtensionFunction::ResponseAction ClassName::Run() {                       \
    std::optional<api::aside_omnibox::ParamsType::Params> params =           \
        api::aside_omnibox::ParamsType::Params::Create(args());              \
    if (!params) {                                                           \
      return RespondNow(Error(kInvalidArguments));                           \
    }                                                                        \
    std::string error;                                                       \
    if (!FindSession(this, params->session_id, &error)) {                    \
      return RespondNow(Error(error));                                       \
    }                                                                        \
    return RespondNow(NoArguments());                                        \
  }

ASIDE_OMNIBOX_SESSION_ACK(AsideOmniboxOnFocusChangedFunction, OnFocusChanged)
ASIDE_OMNIBOX_SESSION_ACK(AsideOmniboxOnThumbnailRemovedFunction, OnThumbnailRemoved)
ASIDE_OMNIBOX_SESSION_ACK(AsideOmniboxNotifySessionStartedFunction, NotifySessionStarted)
ASIDE_OMNIBOX_SESSION_ACK(AsideOmniboxNotifySessionAbandonedFunction, NotifySessionAbandoned)
ASIDE_OMNIBOX_SESSION_ACK(AsideOmniboxOpenLensSearchFunction, OpenLensSearch)
ASIDE_OMNIBOX_SESSION_ACK(AsideOmniboxActivateMetricsFunnelFunction, ActivateMetricsFunnel)
ASIDE_OMNIBOX_SESSION_ACK(AsideOmniboxOnNavigationLikelyFunction, OnNavigationLikely)
ASIDE_OMNIBOX_SESSION_ACK(AsideOmniboxActivateKeywordFunction, ActivateKeyword)

#undef ASIDE_OMNIBOX_SESSION_ACK

ExtensionFunction::ResponseAction AsideOmniboxQueryAutocompleteFunction::Run() {
  std::optional<api::aside_omnibox::QueryAutocomplete::Params> params =
      api::aside_omnibox::QueryAutocomplete::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  AsideOmniboxSession* session = FindSession(this, params->session_id, &error);
  if (!session) {
    return RespondNow(Error(error));
  }
  session->Query(params->input);
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideOmniboxStopAutocompleteFunction::Run() {
  std::optional<api::aside_omnibox::StopAutocomplete::Params> params =
      api::aside_omnibox::StopAutocomplete::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  AsideOmniboxSession* session = FindSession(this, params->session_id, &error);
  if (!session) {
    return RespondNow(Error(error));
  }
  session->Stop(params->clear_result);
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideOmniboxOpenAutocompleteMatchFunction::Run() {
  std::optional<api::aside_omnibox::OpenAutocompleteMatch::Params> params =
      api::aside_omnibox::OpenAutocompleteMatch::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  AsideOmniboxSession* session = FindSession(this, params->session_id, &error);
  if (!session) {
    return RespondNow(Error(error));
  }
  const base::DictValue& request = params->request.additional_properties;
  OpenUrl(Profile::FromBrowserContext(browser_context()),
          MatchUrlFromRequest(session, request), DispositionFromRequest(request));
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideOmniboxSetPopupSelectionFunction::Run() {
  std::optional<api::aside_omnibox::SetPopupSelection::Params> params =
      api::aside_omnibox::SetPopupSelection::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  AsideOmniboxSession* session = FindSession(this, params->session_id, &error);
  if (!session) {
    return RespondNow(Error(error));
  }
  std::string json;
  base::JSONWriter::Write(params->selection.additional_properties, &json);
  session->SetSelection(json);
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideOmniboxOpenPopupSelectionFunction::Run() {
  std::optional<api::aside_omnibox::OpenPopupSelection::Params> params =
      api::aside_omnibox::OpenPopupSelection::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  AsideOmniboxSession* session = FindSession(this, params->session_id, &error);
  if (!session) {
    return RespondNow(Error(error));
  }
  // RE 0x405ce40: {selection{line,state}, disposition, currentTab,
  // resultSequenceId, actionIndex}.
  const base::DictValue& request = params->request.additional_properties;
  GURL url;
  if (const base::DictValue* selection = request.FindDict("selection")) {
    url = MatchUrlFromRequest(session, *selection);
  }
  if (!url.is_valid()) {
    url = MatchUrlFromRequest(session, request);
  }
  WindowOpenDisposition disposition = WindowOpenDisposition::CURRENT_TAB;
  if (const std::optional<int> d = request.FindInt("disposition")) {
    disposition = static_cast<WindowOpenDisposition>(*d);
  } else if (request.FindBool("currentTab").value_or(true) == false) {
    disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
  }
  OpenUrl(Profile::FromBrowserContext(browser_context()), url, disposition);
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideOmniboxDeleteAutocompleteMatchFunction::Run() {
  std::optional<api::aside_omnibox::DeleteAutocompleteMatch::Params> params =
      api::aside_omnibox::DeleteAutocompleteMatch::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  AsideOmniboxSession* session = FindSession(this, params->session_id, &error);
  if (!session) {
    return RespondNow(Error(error));
  }
  const std::optional<int> line =
      params->request.additional_properties.FindInt("line");
  if (line && *line >= 0) {
    session->DeleteMatch(static_cast<size_t>(*line));
  }
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideOmniboxExecuteActionFunction::Run() {
  std::optional<api::aside_omnibox::ExecuteAction::Params> params =
      api::aside_omnibox::ExecuteAction::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  AsideOmniboxSession* session = FindSession(this, params->session_id, &error);
  if (!session) {
    return RespondNow(Error(error));
  }
  // Fork approximation: an omnibox action is executed by navigating to the
  // match (the original runs OmniboxAction::Execute through its searchbox).
  const base::DictValue& request = params->request.additional_properties;
  OpenUrl(Profile::FromBrowserContext(browser_context()),
          MatchUrlFromRequest(session, request), DispositionFromRequest(request));
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideOmniboxGetPlaceholderConfigFunction::Run() {
  std::optional<api::aside_omnibox::GetPlaceholderConfig::Params> params =
      api::aside_omnibox::GetPlaceholderConfig::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  if (!FindSession(this, params->session_id, &error)) {
    return RespondNow(Error(error));
  }
  base::DictValue dict;
  dict.Set("placeholderText", "Search or type a URL");
  return RespondNow(WithArguments(std::move(dict)));
}

ExtensionFunction::ResponseAction AsideOmniboxGetRecentTabsFunction::Run() {
  std::optional<api::aside_omnibox::GetRecentTabs::Params> params =
      api::aside_omnibox::GetRecentTabs::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  if (!FindSession(this, params->session_id, &error)) {
    return RespondNow(Error(error));
  }
  Profile* profile = Profile::FromBrowserContext(browser_context());
  base::ListValue tabs;
  ForEachCurrentBrowserWindowInterfaceOrderedByActivation(
      [&](BrowserWindowInterface* browser) {
        if (browser->GetProfile() != profile) {
          return true;
        }
        TabStripModel* tab_strip = browser->GetTabStripModel();
        for (int i = 0; i < tab_strip->count(); ++i) {
          content::WebContents* contents = tab_strip->GetWebContentsAt(i);
          if (!contents) {
            continue;
          }
          base::DictValue tab;
          tab.Set("tabId", ExtensionTabUtil::GetTabId(contents));
          tab.Set("title", base::UTF16ToUTF8(contents->GetTitle()));
          tab.Set("url", contents->GetLastCommittedURL().spec());
          tabs.Append(std::move(tab));
        }
        return true;
      });
  base::DictValue dict;
  dict.Set("tabs", std::move(tabs));
  return RespondNow(WithArguments(std::move(dict)));
}

ExtensionFunction::ResponseAction AsideOmniboxGetTabPreviewFunction::Run() {
  std::optional<api::aside_omnibox::GetTabPreview::Params> params =
      api::aside_omnibox::GetTabPreview::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  if (!FindSession(this, params->session_id, &error)) {
    return RespondNow(Error(error));
  }
  content::WebContents* contents = nullptr;
  if (!ExtensionTabUtil::GetTabById(params->tab_id,
                                    Profile::FromBrowserContext(browser_context()),
                                    include_incognito_information(), &contents) ||
      !contents) {
    return RespondNow(Error(kInvalidTabId));
  }
  base::DictValue dict;
  dict.Set("tabId", params->tab_id);
  dict.Set("title", base::UTF16ToUTF8(contents->GetTitle()));
  dict.Set("url", contents->GetLastCommittedURL().spec());
  return RespondNow(WithArguments(std::move(dict)));
}

ExtensionFunction::ResponseAction AsideOmniboxGetInputStateFunction::Run() {
  std::optional<api::aside_omnibox::GetInputState::Params> params =
      api::aside_omnibox::GetInputState::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  AsideOmniboxSession* session = FindSession(this, params->session_id, &error);
  if (!session) {
    return RespondNow(Error(error));
  }
  base::DictValue dict;
  dict.Set("inputText", session->last_input());
  dict.Set("toolMode", session->tool_mode());
  dict.Set("modelMode", session->model_mode());
  return RespondNow(WithArguments(std::move(dict)));
}

ExtensionFunction::ResponseAction AsideOmniboxAddFileContextFunction::Run() {
  std::optional<api::aside_omnibox::AddFileContext::Params> params =
      api::aside_omnibox::AddFileContext::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  AsideOmniboxSession* session = FindSession(this, params->session_id, &error);
  if (!session) {
    return RespondNow(Error(error));
  }
  // RE 0x405ffc0: {fileName, mimeType, bytesBase64, imageDataUrl, isDeletable,
  // selectionTimeMs}; the payload must be valid base64.
  const base::DictValue& request = params->request.additional_properties;
  const std::string* bytes = request.FindString("bytesBase64");
  std::string decoded;
  if (!bytes || !base::Base64Decode(*bytes, &decoded)) {
    return RespondNow(Error("Invalid bytesBase64 payload"));
  }
  base::DictValue dict;
  dict.Set("ok", true);
  dict.Set("contextToken", session->AddContextToken());
  return RespondNow(WithArguments(std::move(dict)));
}

ExtensionFunction::ResponseAction AsideOmniboxAddTabContextFunction::Run() {
  std::optional<api::aside_omnibox::AddTabContext::Params> params =
      api::aside_omnibox::AddTabContext::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  AsideOmniboxSession* session = FindSession(this, params->session_id, &error);
  if (!session) {
    return RespondNow(Error(error));
  }
  content::WebContents* contents = nullptr;
  if (!ExtensionTabUtil::GetTabById(params->tab_id,
                                    Profile::FromBrowserContext(browser_context()),
                                    include_incognito_information(), &contents) ||
      !contents) {
    return RespondNow(Error(kInvalidTabId));
  }
  base::DictValue dict;
  dict.Set("ok", true);
  dict.Set("contextToken", session->AddContextToken());
  return RespondNow(WithArguments(std::move(dict)));
}

ExtensionFunction::ResponseAction AsideOmniboxDeleteContextFunction::Run() {
  std::optional<api::aside_omnibox::DeleteContext::Params> params =
      api::aside_omnibox::DeleteContext::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  AsideOmniboxSession* session = FindSession(this, params->session_id, &error);
  if (!session) {
    return RespondNow(Error(error));
  }
  if (!session->RemoveContextToken(params->context_token)) {
    return RespondNow(Error("Invalid contextToken"));
  }
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideOmniboxClearFilesFunction::Run() {
  std::optional<api::aside_omnibox::ClearFiles::Params> params =
      api::aside_omnibox::ClearFiles::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  AsideOmniboxSession* session = FindSession(this, params->session_id, &error);
  if (!session) {
    return RespondNow(Error(error));
  }
  session->ClearContextTokens();
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideOmniboxSubmitQueryFunction::Run() {
  std::optional<api::aside_omnibox::SubmitQuery::Params> params =
      api::aside_omnibox::SubmitQuery::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  AsideOmniboxSession* session = FindSession(this, params->session_id, &error);
  if (!session) {
    return RespondNow(Error(error));
  }
  // RE 0x4061380: {queryText, mouseButton, altKey, ctrlKey, metaKey, shiftKey,
  // isVoiceSearch} -> a default-search-engine search with the click disposition.
  const base::DictValue& request = params->request.additional_properties;
  const std::string* query = request.FindString("queryText");
  if (!query) {
    return RespondNow(Error(kInvalidArguments));
  }
  Profile* profile = Profile::FromBrowserContext(browser_context());
  TemplateURLService* turl_service =
      TemplateURLServiceFactory::GetForProfile(profile);
  if (turl_service && turl_service->GetDefaultSearchProvider()) {
    const TemplateURL* dse = turl_service->GetDefaultSearchProvider();
    GURL url(dse->url_ref().ReplaceSearchTerms(
        TemplateURLRef::SearchTermsArgs(base::UTF8ToUTF16(*query)),
        turl_service->search_terms_data()));
    OpenUrl(profile, url, DispositionFromRequest(request));
  }
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideOmniboxSetActiveToolModeFunction::Run() {
  std::optional<api::aside_omnibox::SetActiveToolMode::Params> params =
      api::aside_omnibox::SetActiveToolMode::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  AsideOmniboxSession* session = FindSession(this, params->session_id, &error);
  if (!session) {
    return RespondNow(Error(error));
  }
  session->SetToolMode(params->tool_mode);
  return RespondNow(NoArguments());
}

ExtensionFunction::ResponseAction AsideOmniboxSetActiveModelModeFunction::Run() {
  std::optional<api::aside_omnibox::SetActiveModelMode::Params> params =
      api::aside_omnibox::SetActiveModelMode::Params::Create(args());
  if (!params) {
    return RespondNow(Error(kInvalidArguments));
  }
  std::string error;
  AsideOmniboxSession* session = FindSession(this, params->session_id, &error);
  if (!session) {
    return RespondNow(Error(error));
  }
  session->SetModelMode(params->model_mode);
  return RespondNow(NoArguments());
}

}  // namespace extensions
