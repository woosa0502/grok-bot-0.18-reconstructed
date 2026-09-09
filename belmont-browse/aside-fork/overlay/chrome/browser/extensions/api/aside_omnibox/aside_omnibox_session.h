// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_EXTENSIONS_API_ASIDE_OMNIBOX_ASIDE_OMNIBOX_SESSION_H_
#define CHROME_BROWSER_EXTENSIONS_API_ASIDE_OMNIBOX_ASIDE_OMNIBOX_SESSION_H_

#include <memory>
#include <set>
#include <string>

#include "base/memory/raw_ptr.h"
#include "components/omnibox/browser/autocomplete_controller.h"

class Profile;

namespace content {
class BrowserContext;
}

namespace extensions {

// One omnibox autocomplete session: owns an AutocompleteController, drives it,
// and forwards results to the extension as asideOmnibox.onAutocompleteResultChanged.
class AsideOmniboxSession : public AutocompleteController::Observer {
 public:
  AsideOmniboxSession(Profile* profile,
                      content::BrowserContext* browser_context,
                      std::string session_id,
                      std::string extension_id);
  AsideOmniboxSession(const AsideOmniboxSession&) = delete;
  AsideOmniboxSession& operator=(const AsideOmniboxSession&) = delete;
  ~AsideOmniboxSession() override;

  void Query(const std::string& input_text);
  void Stop(bool clear_result);
  void DeleteMatch(size_t line);
  void SetToolMode(std::string mode);
  void SetModelMode(std::string mode);
  void SetSelection(std::string selection);

  const std::string& last_input() const { return last_input_; }
  const std::string& extension_id() const { return extension_id_; }
  const std::string& session_id() const { return session_id_; }
  int target_tab_id() const { return target_tab_id_; }
  void set_target_tab_id(int tab_id) { target_tab_id_ = tab_id; }
  // Context tokens handed out by addTabContext/addFileContext (RE: deleteContext
  // rejects unknown tokens with "Invalid contextToken").
  std::string AddContextToken();
  bool RemoveContextToken(const std::string& token);
  void ClearContextTokens();
  const AutocompleteResult& result() const;
  const std::string& tool_mode() const { return tool_mode_; }
  const std::string& model_mode() const { return model_mode_; }

  // AutocompleteController::Observer:
  void OnResultChanged(AutocompleteController* controller,
                       bool default_match_changed) override;

 private:
  raw_ptr<Profile> profile_;
  raw_ptr<content::BrowserContext> browser_context_;
  std::string session_id_;
  std::string extension_id_;
  std::unique_ptr<AutocompleteController> controller_;
  std::string last_input_;
  std::string tool_mode_;
  std::string model_mode_;
  std::string selection_;
  int target_tab_id_ = -1;
  std::set<std::string> context_tokens_;
};

}  // namespace extensions

#endif  // CHROME_BROWSER_EXTENSIONS_API_ASIDE_OMNIBOX_ASIDE_OMNIBOX_SESSION_H_
