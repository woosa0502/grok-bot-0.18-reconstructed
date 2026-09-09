// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_ASIDE_ASIDE_EXTENSION_BRIDGE_H_
#define CHROME_BROWSER_UI_ASIDE_ASIDE_EXTENSION_BRIDGE_H_

#include <string_view>

#include "base/values.h"
#include "url/gurl.h"

class Browser;
class Profile;

namespace aside {

// The bundled Aside extension (AsideAgentManager). Same id as the original.
inline constexpr char kAsideExtensionId[] = "fjdhphbdlfjogobdofoaagnlnkoibdge";

// True when the Aside extension is installed and enabled for `profile`.
bool IsExtensionEnabled(Profile* profile);

// Builds "chrome-extension://<id>/<page>#/u/<uid><route>" where <uid> is the
// signed-in Aside account id (aside.account_id) or 0 when signed out.
// RE: original 0x430d5c0 (strings "chrome-extension://", "#/u/").
GURL ExtensionPageUrl(Profile* profile,
                      std::string_view page,
                      std::string_view route);

// Activates an existing tab in `browser` showing `url`, or opens it in a new
// foreground tab.
void ShowExtensionPage(Browser* browser, const GURL& url);

// Sends `payload` (with "type" set to `type`) to the Aside extension as an
// external runtime message (chrome.runtime.onMessageExternal), opened from a
// native-host channel endpoint.  RE: original 0x43d2b7c — the Tidy button
// builds {source, action, tab_count, active_tab_index, active_tab_url,
// active_tab_title, type:"aside.verticalTabsTidy"} and opens a kSendMessage
// channel through MessageService::OpenChannelToExtension.
void SendExternalMessage(Profile* profile,
                         std::string_view type,
                         base::DictValue payload);

}  // namespace aside

#endif  // CHROME_BROWSER_UI_ASIDE_ASIDE_EXTENSION_BRIDGE_H_
