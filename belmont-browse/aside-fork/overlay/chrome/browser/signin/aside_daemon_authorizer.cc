// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/signin/aside_daemon_authorizer.h"

#include <utility>

#include "base/base64.h"
#include "base/environment.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/strings/stringprintf.h"
#include "base/values.h"
#include "chrome/browser/devtools/secure_remote_debugging_credentials.h"
#include "net/base/load_flags.h"
#include "net/http/http_request_headers.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/cpp/shared_url_loader_factory.h"
#include "services/network/public/cpp/simple_url_loader.h"
#include "url/gurl.h"

namespace {

constexpr char kDefaultDaemonBaseUrl[] = "http://127.0.0.1:21420";
constexpr char kTokenType[] = "AsideDaemonSessionToken";
// Signing input prefix shared with asideAccount.signDaemonAuthChallenge.
constexpr char kDaemonAuthPrefix[] = "Aside Daemon Auth v1";
constexpr base::TimeDelta kExpiryMargin = base::Seconds(30);
constexpr size_t kMaxBody = 1024 * 1024;

constexpr net::NetworkTrafficAnnotationTag kTrafficAnnotation =
    net::DefineNetworkTrafficAnnotation("aside_daemon_authorizer", R"(
        semantics {
          sender: "Aside daemon authorizer"
          description: "Authenticates the browser with the local Aside daemon."
          trigger: "Profile/account state synchronisation."
          data: "Installation-signed challenge."
          destination: LOCAL
        }
        policy {
          cookies_allowed: NO
          setting: "Not user controllable."
          policy_exception_justification: "Loopback only."
        })");

std::unique_ptr<network::SimpleURLLoader> MakeLoader(
    const std::string& url,
    const std::string& method,
    const std::optional<std::string>& body,
    const std::optional<std::string>& authorization) {
  auto request = std::make_unique<network::ResourceRequest>();
  request->url = GURL(url);
  request->method = method;
  request->load_flags = net::LOAD_DISABLE_CACHE | net::LOAD_BYPASS_CACHE;
  request->credentials_mode = network::mojom::CredentialsMode::kOmit;
  if (authorization) {
    request->headers.SetHeader(net::HttpRequestHeaders::kAuthorization,
                               *authorization);
  }
  auto loader =
      network::SimpleURLLoader::Create(std::move(request), kTrafficAnnotation);
  loader->SetAllowHttpErrorResults(true);
  if (body) {
    loader->AttachStringForUpload(*body, "application/json");
  }
  return loader;
}

}  // namespace

// static
AsideDaemonAuthorizer* AsideDaemonAuthorizer::GetInstance() {
  static base::NoDestructor<AsideDaemonAuthorizer> instance;
  return instance.get();
}

// static
std::string AsideDaemonAuthorizer::DaemonBaseUrl() {
  std::unique_ptr<base::Environment> env = base::Environment::Create();
  std::optional<std::string> override = env->GetVar("ASIDE_DAEMON_BASE_URL");
  if (override && !override->empty()) {
    return *override;
  }
  return kDefaultDaemonBaseUrl;
}

AsideDaemonAuthorizer::AsideDaemonAuthorizer() = default;
AsideDaemonAuthorizer::~AsideDaemonAuthorizer() = default;

void AsideDaemonAuthorizer::GetAuthorization(
    scoped_refptr<network::SharedURLLoaderFactory> loader_factory,
    TokenCallback callback) {
  if (!cached_authorization_.empty() &&
      base::TimeTicks::Now() + kExpiryMargin < cached_expiry_) {
    std::move(callback).Run(cached_authorization_);
    return;
  }
  // RE: "%s/auth/daemon/challenge?clientKind=chromium".
  auto loader = MakeLoader(
      base::StringPrintf("%s/auth/daemon/challenge?clientKind=chromium",
                         DaemonBaseUrl().c_str()),
      "GET", std::nullopt, std::nullopt);
  network::SimpleURLLoader* raw = loader.get();
  raw->DownloadToString(
      loader_factory.get(),
      base::BindOnce(&AsideDaemonAuthorizer::OnChallengeFetched,
                     weak_factory_.GetWeakPtr(), loader_factory,
                     std::move(callback), std::move(loader)),
      kMaxBody);
}

void AsideDaemonAuthorizer::OnChallengeFetched(
    scoped_refptr<network::SharedURLLoaderFactory> loader_factory,
    TokenCallback callback,
    std::unique_ptr<network::SimpleURLLoader> loader,
    std::optional<std::string> body) {
  std::optional<base::Value> json =
      body ? base::JSONReader::Read(*body, base::JSON_PARSE_RFC)
           : std::nullopt;
  if (!json || !json->is_dict()) {
    VLOG(1) << "aside: daemon challenge response invalid: "
            << body.value_or("<none>");
    std::move(callback).Run(std::nullopt);
    return;
  }
  const std::string* challenge_id = json->GetDict().FindString("challengeId");
  const std::string* challenge = json->GetDict().FindString("challenge");
  std::string challenge_bytes;
  if (!challenge_id || !challenge ||
      !base::Base64Decode(*challenge, &challenge_bytes)) {
    std::move(callback).Run(std::nullopt);
    return;
  }
  std::vector<uint8_t> input;
  std::string_view prefix(kDaemonAuthPrefix);
  input.insert(input.end(), prefix.begin(), prefix.end());
  input.push_back(0);
  input.insert(input.end(), challenge_bytes.begin(), challenge_bytes.end());
  std::optional<std::vector<uint8_t>> signature =
      SecureRemoteDebuggingCredentials::GetInstance()->Sign(input);
  if (!signature) {
    std::move(callback).Run(std::nullopt);
    return;
  }
  base::DictValue request;
  request.Set("challengeId", *challenge_id);
  request.Set("signedChallenge", base::Base64Encode(*signature));
  std::string request_body;
  base::JSONWriter::Write(request, &request_body);
  auto session_loader =
      MakeLoader(DaemonBaseUrl() + "/auth/daemon/session", "POST",
                 request_body, std::nullopt);
  network::SimpleURLLoader* raw = session_loader.get();
  raw->DownloadToString(
      loader_factory.get(),
      base::BindOnce(&AsideDaemonAuthorizer::OnSessionFetched,
                     weak_factory_.GetWeakPtr(), std::move(callback),
                     std::move(session_loader)),
      kMaxBody);
}

void AsideDaemonAuthorizer::OnSessionFetched(
    TokenCallback callback,
    std::unique_ptr<network::SimpleURLLoader> loader,
    std::optional<std::string> body) {
  std::optional<base::Value> json =
      body ? base::JSONReader::Read(*body, base::JSON_PARSE_RFC)
           : std::nullopt;
  if (!json || !json->is_dict()) {
    VLOG(1) << "aside: daemon session response invalid: "
            << body.value_or("<none>");
    std::move(callback).Run(std::nullopt);
    return;
  }
  const std::string* token = json->GetDict().FindString("access_token");
  const std::string* type = json->GetDict().FindString("token_type");
  if (!token || !type || *type != kTokenType) {
    std::move(callback).Run(std::nullopt);
    return;
  }
  const int expires = json->GetDict().FindInt("expiresInSeconds").value_or(300);
  cached_authorization_ = *type + " " + *token;
  cached_expiry_ = base::TimeTicks::Now() + base::Seconds(expires);
  std::move(callback).Run(cached_authorization_);
}

void AsideDaemonAuthorizer::PostJsonWithAuthorization(
    scoped_refptr<network::SharedURLLoaderFactory> loader_factory,
    const std::string& path,
    std::string json_body,
    base::OnceCallback<void(std::optional<std::string>)> callback) {
  GetAuthorization(
      loader_factory,
      base::BindOnce(&AsideDaemonAuthorizer::DoPost, weak_factory_.GetWeakPtr(),
                     loader_factory, path, std::move(json_body),
                     std::move(callback)));
}

void AsideDaemonAuthorizer::DoPost(
    scoped_refptr<network::SharedURLLoaderFactory> loader_factory,
    const std::string& path,
    std::string json_body,
    base::OnceCallback<void(std::optional<std::string>)> callback,
    std::optional<std::string> authorization) {
  if (!authorization) {
    std::move(callback).Run(std::nullopt);
    return;
  }
  auto loader = MakeLoader(DaemonBaseUrl() + path, "POST", json_body,
                           authorization);
  network::SimpleURLLoader* raw = loader.get();
  raw->DownloadToString(
      loader_factory.get(),
      base::BindOnce(&AsideDaemonAuthorizer::OnPostDone,
                     weak_factory_.GetWeakPtr(), std::move(callback),
                     std::move(loader)),
      kMaxBody);
}

void AsideDaemonAuthorizer::OnPostDone(
    base::OnceCallback<void(std::optional<std::string>)> callback,
    std::unique_ptr<network::SimpleURLLoader> loader,
    std::optional<std::string> body) {
  std::move(callback).Run(std::move(body));
}
