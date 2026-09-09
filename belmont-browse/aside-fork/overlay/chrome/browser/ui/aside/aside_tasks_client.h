// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_ASIDE_ASIDE_TASKS_CLIENT_H_
#define CHROME_BROWSER_UI_ASIDE_ASIDE_TASKS_CLIENT_H_

#include <list>
#include <memory>
#include <optional>
#include <string>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"

class Profile;

namespace network {
class SimpleURLLoader;
}

namespace aside {

// Loopback client for the daemon's chrome-sidebar routes
// (/session/for-chrome/*). These routes are public on loopback; the account
// is selected with ?accountId=<aside.account_id>. RE: original
// vertical_tab_strip_region_view.cc (ScheduleAsideTasksPoll, commands
// nameChat / mark-read / mark-all-read / archive-all-chats / open-folder,
// resolve-popover-action {popoverId, actionId} -> {clientAction, url}).
class TasksClient {
 public:
  using BodyCallback = base::OnceCallback<void(std::optional<std::string>)>;

  explicit TasksClient(Profile* profile);
  ~TasksClient();

  // "/session/for-chrome/recents" etc. relative to the daemon base URL; the
  // accountId query is appended automatically.
  void Get(const std::string& path, BodyCallback callback);
  void PostJson(const std::string& path,
                std::string json_body,
                BodyCallback callback);

  std::string AccountQuery() const;
  int account_id() const;

 private:
  void Send(const std::string& path,
            const std::string& method,
            std::optional<std::string> body,
            BodyCallback callback);
  void OnDone(std::list<std::unique_ptr<network::SimpleURLLoader>>::iterator it,
              BodyCallback callback,
              std::optional<std::string> body);

  raw_ptr<Profile> profile_;
  std::list<std::unique_ptr<network::SimpleURLLoader>> loaders_;
  base::WeakPtrFactory<TasksClient> weak_factory_{this};
};

}  // namespace aside

#endif  // CHROME_BROWSER_UI_ASIDE_ASIDE_TASKS_CLIENT_H_
