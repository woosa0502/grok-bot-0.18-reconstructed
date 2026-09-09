// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/extensions/api/aside_omnibox/aside_omnibox_session.h"

#include "base/rand_util.h"
#include "base/strings/stringprintf.h"

#include <utility>

#include "base/strings/utf_string_conversions.h"
#include "base/values.h"
#include "chrome/browser/autocomplete/chrome_autocomplete_provider_client.h"
#include "chrome/browser/autocomplete/chrome_autocomplete_scheme_classifier.h"
#include "chrome/browser/profiles/profile.h"
#include "components/omnibox/browser/autocomplete_classifier.h"
#include "components/omnibox/browser/autocomplete_controller_config.h"
#include "components/omnibox/browser/autocomplete_input.h"
#include "components/omnibox/browser/autocomplete_match.h"
#include "components/omnibox/browser/autocomplete_match_type.h"
#include "components/omnibox/browser/autocomplete_result.h"
#include "extensions/browser/event_router.h"
#include "extensions/browser/extension_event_histogram_value.h"
#include "third_party/metrics_proto/omnibox_event.pb.h"

namespace extensions {

namespace {
constexpr char kEventName[] = "asideOmnibox.onAutocompleteResultChanged";
}  // namespace

AsideOmniboxSession::AsideOmniboxSession(
    Profile* profile,
    content::BrowserContext* browser_context,
    std::string session_id,
    std::string extension_id)
    : profile_(profile),
      browser_context_(browser_context),
      session_id_(std::move(session_id)),
      extension_id_(std::move(extension_id)),
      controller_(std::make_unique<AutocompleteController>(
          std::make_unique<ChromeAutocompleteProviderClient>(profile),
          AutocompleteControllerConfig{
              .provider_types =
                  AutocompleteClassifier::DefaultOmniboxProviders()})) {
  controller_->AddObserver(this);
}

AsideOmniboxSession::~AsideOmniboxSession() {
  controller_->RemoveObserver(this);
}

void AsideOmniboxSession::Query(const std::string& input_text) {
  ChromeAutocompleteSchemeClassifier scheme_classifier(profile_);
  last_input_ = input_text;
  AutocompleteInput input(base::UTF8ToUTF16(input_text),
                          metrics::OmniboxEventProto::OTHER, scheme_classifier);
  controller_->Start(input);
}

void AsideOmniboxSession::Stop(bool clear_result) {
  controller_->Stop(clear_result ? AutocompleteStopReason::kClobbered
                                  : AutocompleteStopReason::kInteraction);
}

void AsideOmniboxSession::DeleteMatch(size_t line) {
  const AutocompleteResult& result = controller_->result();
  if (line < result.size()) {
    controller_->DeleteMatch(result.match_at(line));
  }
}

std::string AsideOmniboxSession::AddContextToken() {
  std::string token = base::StringPrintf("%016llX%016llX",
      static_cast<unsigned long long>(base::RandUint64()),
      static_cast<unsigned long long>(base::RandUint64()));
  context_tokens_.insert(token);
  return token;
}

bool AsideOmniboxSession::RemoveContextToken(const std::string& token) {
  return context_tokens_.erase(token) > 0;
}

void AsideOmniboxSession::ClearContextTokens() {
  context_tokens_.clear();
}

const AutocompleteResult& AsideOmniboxSession::result() const {
  return controller_->result();
}

void AsideOmniboxSession::SetToolMode(std::string mode) {
  tool_mode_ = std::move(mode);
}

void AsideOmniboxSession::SetModelMode(std::string mode) {
  model_mode_ = std::move(mode);
}

void AsideOmniboxSession::SetSelection(std::string selection) {
  selection_ = std::move(selection);
}

void AsideOmniboxSession::OnResultChanged(AutocompleteController* controller,
                                          bool default_match_changed) {
  EventRouter* router = EventRouter::Get(browser_context_);
  if (!router || !router->ExtensionHasEventListener(extension_id_, kEventName)) {
    return;
  }
  // Result contract (extension reads .matches[].{contents,destinationUrl,
  // fillIntoEdit,isSearchType}).
  base::ListValue matches;
  for (const AutocompleteMatch& match : controller->result()) {
    base::DictValue m;
    m.Set("contents", base::UTF16ToUTF8(match.contents));
    m.Set("description", base::UTF16ToUTF8(match.description));
    m.Set("destinationUrl", match.destination_url.spec());
    m.Set("fillIntoEdit", base::UTF16ToUTF8(match.fill_into_edit));
    m.Set("isSearchType", AutocompleteMatch::IsSearchType(match.type));
    m.Set("relevance", match.relevance);
    m.Set("type", AutocompleteMatchType::ToString(match.type));
    matches.Append(std::move(m));
  }
  base::DictValue result;
  result.Set("matches", std::move(matches));

  base::ListValue args;
  args.Append(session_id_);
  args.Append(std::move(result));
  auto event = std::make_unique<Event>(
      events::ASIDE_OMNIBOX_ON_AUTOCOMPLETE_RESULT_CHANGED, kEventName,
      std::move(args), profile_);
  router->DispatchEventToExtension(extension_id_, std::move(event));
}

}  // namespace extensions
