// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/extensions/api/aside_omnibox/aside_omnibox_service.h"

#include <utility>

#include "base/rand_util.h"
#include "base/strings/stringprintf.h"
#include "chrome/browser/extensions/api/aside_omnibox/aside_omnibox_service_factory.h"
#include "chrome/browser/extensions/api/aside_omnibox/aside_omnibox_session.h"
#include "chrome/browser/profiles/profile.h"

namespace extensions {

AsideOmniboxService::AsideOmniboxService(Profile* profile)
    : profile_(profile) {}

AsideOmniboxService::~AsideOmniboxService() = default;

// static
AsideOmniboxService* AsideOmniboxService::Get(
    content::BrowserContext* browser_context) {
  return AsideOmniboxServiceFactory::GetForBrowserContext(browser_context);
}

std::string AsideOmniboxService::CreateSession(
    content::BrowserContext* browser_context,
    const std::string& extension_id) {
  // RE 0x4059b54: session ids are two random 64-bit words as "%016llX%016llX".
  std::string session_id = base::StringPrintf(
      "%016llX%016llX", static_cast<unsigned long long>(base::RandUint64()),
      static_cast<unsigned long long>(base::RandUint64()));
  sessions_[session_id] = std::make_unique<AsideOmniboxSession>(
      profile_, browser_context, session_id, extension_id);
  return session_id;
}

void AsideOmniboxService::DestroySession(const std::string& session_id) {
  sessions_.erase(session_id);
}

void AsideOmniboxService::Query(const std::string& session_id,
                                const std::string& input) {
  auto it = sessions_.find(session_id);
  if (it != sessions_.end()) {
    it->second->Query(input);
  }
}

void AsideOmniboxService::Stop(const std::string& session_id,
                               bool clear_result) {
  auto it = sessions_.find(session_id);
  if (it != sessions_.end()) {
    it->second->Stop(clear_result);
  }
}

AsideOmniboxSession* AsideOmniboxService::GetSession(
    const std::string& session_id) {
  auto it = sessions_.find(session_id);
  return it != sessions_.end() ? it->second.get() : nullptr;
}

AsideOmniboxSession* AsideOmniboxService::GetSessionForExtension(
    const std::string& session_id,
    const std::string& extension_id) {
  AsideOmniboxSession* session = GetSession(session_id);
  if (!session || session->extension_id() != extension_id) {
    return nullptr;
  }
  return session;
}

void AsideOmniboxService::Shutdown() {
  sessions_.clear();
}

}  // namespace extensions
