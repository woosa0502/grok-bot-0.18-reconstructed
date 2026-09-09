// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/aside/aside_tasks_client.h"

#include <utility>

#include "base/functional/bind.h"
#include "base/strings/string_number_conversions.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/signin/aside_daemon_authorizer.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/storage_partition.h"
#include "net/base/load_flags.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/cpp/shared_url_loader_factory.h"
#include "services/network/public/cpp/simple_url_loader.h"
#include "url/gurl.h"

namespace aside {

namespace {

constexpr net::NetworkTrafficAnnotationTag kAnnotation =
    net::DefineNetworkTrafficAnnotation("aside_daemon_tasks", R"(
        semantics {
          sender: "Aside vertical tab strip"
          description: "Reads and updates the local Aside daemon's tasks."
          trigger: "Sidebar refresh or user action on a task row."
          data: "Session ids and titles."
          destination: LOCAL
        }
        policy {
          cookies_allowed: NO
          setting: "Not user controllable."
          policy_exception_justification: "Loopback only."
        })");

}  // namespace

TasksClient::TasksClient(Profile* profile) : profile_(profile) {}
TasksClient::~TasksClient() = default;

int TasksClient::account_id() const {
  return profile_ ? profile_->GetPrefs()->GetInteger("aside.account_id") : -1;
}

std::string TasksClient::AccountQuery() const {
  const int id = account_id();
  return id >= 0 ? "?accountId=" + base::NumberToString(id) : std::string();
}

void TasksClient::Get(const std::string& path, BodyCallback callback) {
  Send(path, "GET", std::nullopt, std::move(callback));
}

void TasksClient::PostJson(const std::string& path,
                           std::string json_body,
                           BodyCallback callback) {
  Send(path, "POST", std::move(json_body), std::move(callback));
}

void TasksClient::Send(const std::string& path,
                       const std::string& method,
                       std::optional<std::string> body,
                       BodyCallback callback) {
  if (!profile_) {
    std::move(callback).Run(std::nullopt);
    return;
  }
  auto request = std::make_unique<network::ResourceRequest>();
  request->url =
      GURL(AsideDaemonAuthorizer::DaemonBaseUrl() + path + AccountQuery());
  request->method = method;
  request->load_flags = net::LOAD_DISABLE_CACHE | net::LOAD_BYPASS_CACHE;
  request->credentials_mode = network::mojom::CredentialsMode::kOmit;
  auto loader = network::SimpleURLLoader::Create(std::move(request), kAnnotation);
  loader->SetTimeoutDuration(base::Seconds(8));
  loader->SetAllowHttpErrorResults(true);
  if (body) {
    loader->AttachStringForUpload(*body, "application/json");
  }
  loaders_.push_back(std::move(loader));
  auto it = std::prev(loaders_.end());
  (*it)->DownloadToString(
      profile_->GetDefaultStoragePartition()
          ->GetURLLoaderFactoryForBrowserProcess()
          .get(),
      base::BindOnce(&TasksClient::OnDone, weak_factory_.GetWeakPtr(), it,
                     std::move(callback)),
      512 * 1024);
}

void TasksClient::OnDone(
    std::list<std::unique_ptr<network::SimpleURLLoader>>::iterator it,
    BodyCallback callback,
    std::optional<std::string> body) {
  loaders_.erase(it);
  std::move(callback).Run(std::move(body));
}

}  // namespace aside
