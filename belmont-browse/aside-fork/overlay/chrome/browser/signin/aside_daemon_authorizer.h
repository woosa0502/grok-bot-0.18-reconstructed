// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_SIGNIN_ASIDE_DAEMON_AUTHORIZER_H_
#define CHROME_BROWSER_SIGNIN_ASIDE_DAEMON_AUTHORIZER_H_

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "base/functional/callback.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/time/time.h"

namespace network {
class SharedURLLoaderFactory;
class SimpleURLLoader;
}  // namespace network

// Obtains a daemon session token for the browser (clientKind=chromium):
// GET <daemon>/auth/daemon/challenge?clientKind=chromium ->
// sign "Aside Daemon Auth v1\0" || challenge with the installation key ->
// POST <daemon>/auth/daemon/session {challengeId, signedChallenge} ->
// {token_type:"AsideDaemonSessionToken", access_token, expiresInSeconds}.
// RE: original chrome/browser/signin/aside_daemon_authorizer.cc.
class AsideDaemonAuthorizer {
 public:
  using TokenCallback =
      base::OnceCallback<void(std::optional<std::string> authorization)>;

  static AsideDaemonAuthorizer* GetInstance();
  static std::string DaemonBaseUrl();

  // Runs `callback` with "AsideDaemonSessionToken <token>" (cached until
  // shortly before expiry) or nullopt on failure.
  void GetAuthorization(
      scoped_refptr<network::SharedURLLoaderFactory> loader_factory,
      TokenCallback callback);

  // Performs an authorized POST of `json_body` to <daemon><path>; the
  // callback receives the response body (nullopt on transport failure).
  void PostJsonWithAuthorization(
      scoped_refptr<network::SharedURLLoaderFactory> loader_factory,
      const std::string& path,
      std::string json_body,
      base::OnceCallback<void(std::optional<std::string>)> callback);

 private:
  AsideDaemonAuthorizer();
  ~AsideDaemonAuthorizer();
  friend class base::NoDestructor<AsideDaemonAuthorizer>;

  void OnChallengeFetched(
      scoped_refptr<network::SharedURLLoaderFactory> loader_factory,
      TokenCallback callback,
      std::unique_ptr<network::SimpleURLLoader> loader,
      std::optional<std::string> body);
  void OnSessionFetched(TokenCallback callback,
                        std::unique_ptr<network::SimpleURLLoader> loader,
                        std::optional<std::string> body);
  void OnPostDone(base::OnceCallback<void(std::optional<std::string>)> callback,
                  std::unique_ptr<network::SimpleURLLoader> loader,
                  std::optional<std::string> body);
  void DoPost(scoped_refptr<network::SharedURLLoaderFactory> loader_factory,
              const std::string& path,
              std::string json_body,
              base::OnceCallback<void(std::optional<std::string>)> callback,
              std::optional<std::string> authorization);

  std::string cached_authorization_;
  base::TimeTicks cached_expiry_;
  base::WeakPtrFactory<AsideDaemonAuthorizer> weak_factory_{this};
};

#endif  // CHROME_BROWSER_SIGNIN_ASIDE_DAEMON_AUTHORIZER_H_
