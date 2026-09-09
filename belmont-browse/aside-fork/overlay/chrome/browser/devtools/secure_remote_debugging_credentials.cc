// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/devtools/secure_remote_debugging_credentials.h"

#include <memory>
#include <utility>

#include "base/environment.h"
#include "base/files/file_util.h"
#include "base/no_destructor.h"
#include "base/path_service.h"
#include "chrome/common/chrome_paths.h"
#include "crypto/keypair.h"
#include "crypto/sign.h"

namespace {

// Encodes one big-endian unsigned integer as a DER INTEGER.
void AppendDerInteger(base::span<const uint8_t> value,
                      std::vector<uint8_t>* out) {
  size_t start = 0;
  while (start + 1 < value.size() && value[start] == 0) {
    ++start;
  }
  const bool needs_pad = value[start] & 0x80;
  const size_t len = value.size() - start + (needs_pad ? 1 : 0);
  out->push_back(0x02);
  out->push_back(static_cast<uint8_t>(len));
  if (needs_pad) {
    out->push_back(0x00);
  }
  out->insert(out->end(), value.begin() + start, value.end());
}

// Converts a 64-byte raw ECDSA (r || s) signature into DER.
std::vector<uint8_t> RawEcdsaToDer(base::span<const uint8_t, 64> raw) {
  std::vector<uint8_t> body;
  AppendDerInteger(raw.first<32>(), &body);
  AppendDerInteger(raw.last<32>(), &body);
  std::vector<uint8_t> der;
  der.push_back(0x30);
  der.push_back(static_cast<uint8_t>(body.size()));
  der.insert(der.end(), body.begin(), body.end());
  return der;
}

}  // namespace

// static
SecureRemoteDebuggingCredentials* SecureRemoteDebuggingCredentials::GetInstance() {
  static base::NoDestructor<SecureRemoteDebuggingCredentials> instance;
  return instance.get();
}

SecureRemoteDebuggingCredentials::SecureRemoteDebuggingCredentials() = default;
SecureRemoteDebuggingCredentials::~SecureRemoteDebuggingCredentials() = default;

std::optional<base::FilePath> SecureRemoteDebuggingCredentials::ResolveKeyPath()
    const {
  std::unique_ptr<base::Environment> env = base::Environment::Create();
  std::optional<std::string> env_path = env->GetVar("ASIDE_INSTALLATION_KEY");
  if (env_path && !env_path->empty()) {
    return base::FilePath::FromUTF8Unsafe(*env_path);
  }
  base::FilePath user_data_dir;
  if (!base::PathService::Get(chrome::DIR_USER_DATA, &user_data_dir)) {
    return std::nullopt;
  }
  const base::FilePath candidates[] = {
      user_data_dir.Append(FILE_PATH_LITERAL("AsideInstallationKey")),
      user_data_dir.Append(FILE_PATH_LITERAL("Default"))
          .Append(FILE_PATH_LITERAL("AsideInstallationKey")),
  };
  for (const base::FilePath& path : candidates) {
    if (base::PathExists(path)) {
      return path;
    }
  }
  return std::nullopt;
}

bool SecureRemoteDebuggingCredentials::EnsureLoaded() {
  if (load_attempted_) {
    return private_key_der_.has_value();
  }
  load_attempted_ = true;
  std::optional<base::FilePath> path = ResolveKeyPath();
  if (!path) {
    error_ = "Installation security is not initialized.";
    return false;
  }
  std::string contents;
  if (!base::ReadFileToString(*path, &contents)) {
    error_ = "Unable to load installation private key: " +
             path->AsUTF8Unsafe();
    return false;
  }
  std::vector<uint8_t> der(contents.begin(), contents.end());
  if (!crypto::keypair::PrivateKey::FromPrivateKeyInfo(der)) {
    error_ = "Unable to load installation signing key: " + path->AsUTF8Unsafe();
    return false;
  }
  private_key_der_ = std::move(der);
  return true;
}

bool SecureRemoteDebuggingCredentials::IsInitialized() {
  return EnsureLoaded();
}

bool SecureRemoteDebuggingCredentials::Verify(
    base::span<const uint8_t> challenge,
    base::span<const uint8_t> signature) {
  if (!EnsureLoaded()) {
    return false;
  }
  std::optional<crypto::keypair::PrivateKey> key =
      crypto::keypair::PrivateKey::FromPrivateKeyInfo(*private_key_der_);
  if (!key) {
    return false;
  }
  crypto::keypair::PublicKey public_key =
      crypto::keypair::PublicKey::FromPrivateKey(*key);
  std::vector<uint8_t> der_signature;
  if (signature.size() == 64) {
    der_signature = RawEcdsaToDer(signature.first<64>());
    signature = der_signature;
  }
  return crypto::sign::Verify(crypto::sign::ECDSA_SHA256, public_key, challenge,
                              signature);
}

std::optional<std::vector<uint8_t>> SecureRemoteDebuggingCredentials::Sign(
    base::span<const uint8_t> data) {
  if (!EnsureLoaded()) {
    return std::nullopt;
  }
  std::optional<crypto::keypair::PrivateKey> key =
      crypto::keypair::PrivateKey::FromPrivateKeyInfo(*private_key_der_);
  if (!key) {
    return std::nullopt;
  }
  return crypto::sign::Sign(crypto::sign::ECDSA_SHA256, *key, data);
}

std::optional<std::vector<uint8_t>>
SecureRemoteDebuggingCredentials::ExportPublicKey() {
  if (!EnsureLoaded()) {
    return std::nullopt;
  }
  std::optional<crypto::keypair::PrivateKey> key =
      crypto::keypair::PrivateKey::FromPrivateKeyInfo(*private_key_der_);
  if (!key) {
    error_ = "Failed to export installation public key.";
    return std::nullopt;
  }
  return crypto::keypair::PublicKey::FromPrivateKey(*key)
      .ToSubjectPublicKeyInfo();
}
