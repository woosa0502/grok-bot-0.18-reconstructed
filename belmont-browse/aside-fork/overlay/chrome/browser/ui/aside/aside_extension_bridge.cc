// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/aside/aside_extension_bridge.h"

#include <memory>
#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "base/json/json_writer.h"
#include "base/task/sequenced_task_runner.h"
#include "base/logging.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/unguessable_token.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/navigator/browser_navigator.h"
#include "chrome/browser/ui/navigator/browser_navigator_params.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/api/messaging/channel_endpoint.h"
#include "extensions/browser/api/messaging/message_port.h"
#include "extensions/browser/api/messaging/message_service.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/common/api/messaging/message.h"
#include "extensions/common/api/messaging/messaging_endpoint.h"
#include "extensions/common/api/messaging/port_id.h"
#include "extensions/common/mojom/message_port.mojom-shared.h"
#include "ui/base/page_transition_types.h"
#include "ui/base/window_open_disposition.h"

namespace aside {

namespace {

constexpr char kAccountIdPref[] = "aside.account_id";

// Opener port for a browser-originated message.  It only needs to accept the
// extension's reply (sendResponse) and then let the channel close.
class NativeMessagePort : public extensions::MessagePort {
 public:
  NativeMessagePort(
      base::WeakPtr<extensions::MessagePort::ChannelDelegate> delegate,
      const extensions::PortId& port_id)
      : extensions::MessagePort(std::move(delegate), port_id) {}
  ~NativeMessagePort() override = default;

  bool IsValidPort() override { return true; }
  void DispatchOnMessage(extensions::Message message) override {
    if (message.format() == extensions::mojom::SerializationFormat::kJson) {
      DVLOG(1) << "aside: extension replied " << message.data();
    }
    // One-shot request/response.  The receiver normally closes the channel
    // after sendResponse(); make sure it goes away even if it does not.  The
    // close must not run inside this dispatch (it destroys this port).
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(&extensions::MessagePort::ChannelDelegate::CloseChannel,
                       weak_channel_delegate_, port_id_, std::string()));
  }
};

}  // namespace

bool IsExtensionEnabled(Profile* profile) {
  if (!profile) {
    return false;
  }
  extensions::ExtensionRegistry* registry =
      extensions::ExtensionRegistry::Get(profile);
  return registry &&
         registry->enabled_extensions().GetByID(kAsideExtensionId) != nullptr;
}

GURL ExtensionPageUrl(Profile* profile,
                      std::string_view page,
                      std::string_view route) {
  int account_id = 0;
  if (profile) {
    PrefService* prefs = profile->GetOriginalProfile()->GetPrefs();
    if (prefs && prefs->FindPreference(kAccountIdPref)) {
      account_id = prefs->GetInteger(kAccountIdPref);
    }
  }
  if (account_id < 0) {
    account_id = 0;
  }
  return GURL(base::StrCat({"chrome-extension://", kAsideExtensionId, "/", page,
                            "#/u/", base::NumberToString(account_id), route}));
}

void ShowExtensionPage(Browser* browser, const GURL& url) {
  if (!browser || !url.is_valid()) {
    return;
  }
  TabStripModel* model = browser->tab_strip_model();
  for (int i = 0; i < model->count(); ++i) {
    content::WebContents* contents = model->GetWebContentsAt(i);
    if (contents && contents->GetVisibleURL() == url) {
      model->ActivateTabAt(i);
      return;
    }
  }
  NavigateParams params(browser, url, ui::PAGE_TRANSITION_AUTO_TOPLEVEL);
  params.disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
  Navigate(&params);
}

void SendExternalMessage(Profile* profile,
                         std::string_view type,
                         base::DictValue payload) {
  if (!IsExtensionEnabled(profile)) {
    return;
  }
  extensions::MessageService* service =
      extensions::MessageService::Get(profile);
  if (!service) {
    return;
  }
  payload.Set("type", type);
  std::string json;
  if (!base::JSONWriter::Write(payload, &json)) {
    return;
  }
  const extensions::PortId port_id(base::UnguessableToken::Create(),
                                   /*port_number=*/1, /*is_opener=*/true,
                                   extensions::mojom::SerializationFormat::kJson);
  auto port = std::make_unique<NativeMessagePort>(
      service->GetChannelDelegate(), port_id);
  extensions::ChannelEndpoint source(profile);
  const std::string channel_name(type);
  service->OpenChannelToExtension(
      source, port_id,
      extensions::MessagingEndpoint::ForNativeApp(channel_name),
      std::move(port), kAsideExtensionId, GURL(),
      extensions::mojom::ChannelType::kSendMessage, channel_name);
  service->PostMessage(port_id,
                       extensions::Message(json, /*user_gesture=*/true));
}

}  // namespace aside
