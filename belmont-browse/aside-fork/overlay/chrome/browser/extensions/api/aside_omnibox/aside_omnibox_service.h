// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_EXTENSIONS_API_ASIDE_OMNIBOX_ASIDE_OMNIBOX_SERVICE_H_
#define CHROME_BROWSER_EXTENSIONS_API_ASIDE_OMNIBOX_ASIDE_OMNIBOX_SERVICE_H_

#include <map>
#include <memory>
#include <string>

#include "base/memory/raw_ptr.h"
#include "components/keyed_service/core/keyed_service.h"

class Profile;

namespace content {
class BrowserContext;
}

namespace extensions {

class AsideOmniboxSession;

// Per-profile owner of omnibox autocomplete sessions.
class AsideOmniboxService : public KeyedService {
 public:
  explicit AsideOmniboxService(Profile* profile);
  AsideOmniboxService(const AsideOmniboxService&) = delete;
  AsideOmniboxService& operator=(const AsideOmniboxService&) = delete;
  ~AsideOmniboxService() override;

  static AsideOmniboxService* Get(content::BrowserContext* browser_context);

  std::string CreateSession(content::BrowserContext* browser_context,
                            const std::string& extension_id);
  void DestroySession(const std::string& session_id);
  void Query(const std::string& session_id, const std::string& input);
  void Stop(const std::string& session_id, bool clear_result);
  AsideOmniboxSession* GetSession(const std::string& session_id);
  // RE 0x40594e0: a session is only visible to the extension that created it.
  AsideOmniboxSession* GetSessionForExtension(const std::string& session_id,
                                              const std::string& extension_id);

  void Shutdown() override;

 private:
  raw_ptr<Profile> profile_;
  std::map<std::string, std::unique_ptr<AsideOmniboxSession>> sessions_;
};

}  // namespace extensions

#endif  // CHROME_BROWSER_EXTENSIONS_API_ASIDE_OMNIBOX_ASIDE_OMNIBOX_SERVICE_H_
