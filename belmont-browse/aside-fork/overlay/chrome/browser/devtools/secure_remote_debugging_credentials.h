// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_DEVTOOLS_SECURE_REMOTE_DEBUGGING_CREDENTIALS_H_
#define CHROME_BROWSER_DEVTOOLS_SECURE_REMOTE_DEBUGGING_CREDENTIALS_H_

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "base/containers/span.h"
#include "base/files/file_path.h"
#include "base/no_destructor.h"

// The installation identity used by Aside's secure remote debugging handshake
// (RE: chrome/browser/devtools/secure_remote_debugging_credentials_mac.mm —
// keychain items aside.install.meta / aside.install.sig, scheme p256_v1;
// pq_v1 is macOS-26 ML-DSA and is reported as unsupported here).
//
// This portable implementation keeps the P-256 key in a PKCS#8 DER file:
// $ASIDE_INSTALLATION_KEY, else <user data dir>/AsideInstallationKey, else
// <user data dir>/Default/AsideInstallationKey (the same file the
// asideAccount.signDaemonAuthChallenge API reads for the default profile).
class SecureRemoteDebuggingCredentials {
 public:
  static SecureRemoteDebuggingCredentials* GetInstance();

  SecureRemoteDebuggingCredentials(const SecureRemoteDebuggingCredentials&) =
      delete;
  SecureRemoteDebuggingCredentials& operator=(
      const SecureRemoteDebuggingCredentials&) = delete;

  // "p256_v1" (or "pq_v1" once supported).
  std::string scheme() const { return "p256_v1"; }

  // True once the installation key could be loaded.
  bool IsInitialized();

  // Verifies an ECDSA P-256/SHA-256 signature over `challenge`. Accepts the
  // 64-byte raw r||s form (CryptoKit rawRepresentation, what the daemon's
  // native helper produces) as well as DER.
  bool Verify(base::span<const uint8_t> challenge,
              base::span<const uint8_t> signature);

  // Signs `data` with the installation private key (DER signature).
  std::optional<std::vector<uint8_t>> Sign(base::span<const uint8_t> data);

  // SubjectPublicKeyInfo of the installation verification key.
  std::optional<std::vector<uint8_t>> ExportPublicKey();

  // Last load error ("Installation security is not initialized." etc.).
  const std::string& error() const { return error_; }

 private:
  friend class base::NoDestructor<SecureRemoteDebuggingCredentials>;

  SecureRemoteDebuggingCredentials();
  ~SecureRemoteDebuggingCredentials();

  bool EnsureLoaded();
  std::optional<base::FilePath> ResolveKeyPath() const;

  bool load_attempted_ = false;
  std::optional<std::vector<uint8_t>> private_key_der_;
  std::string error_;
};

#endif  // CHROME_BROWSER_DEVTOOLS_SECURE_REMOTE_DEBUGGING_CREDENTIALS_H_
