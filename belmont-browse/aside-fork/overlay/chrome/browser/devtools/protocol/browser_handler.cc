// Copyright 2017 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/devtools/protocol/browser_handler.h"

#include <set>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/ref_counted_memory.h"
#include "chrome/app/chrome_command_ids.h"
#include "chrome/browser/devtools/chrome_devtools_manager_delegate.h"
#include "chrome/browser/devtools/devtools_dock_tile.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_attributes_entry.h"
#include "chrome/browser/ui/browser_window/public/profile_browser_collection.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/profiles/profile_attributes_storage.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/profiles/profile_window.h"
#include "chrome/browser/ui/aside/aside_ai_tabs_metadata.h"
#include "chrome/browser/ui/navigator/browser_navigator.h"
#include "chrome/browser/ui/navigator/browser_navigator_params.h"
#include "chrome/browser/browser_process.h"
#include "base/strings/stringprintf.h"
#include "content/public/browser/web_contents.h"
#include "ui/base/page_transition_types.h"
#include "ui/base/window_open_disposition.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/browser_window.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface_iterator.h"
#include "chrome/browser/ui/exclusive_access/exclusive_access_context.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/privacy_sandbox/privacy_sandbox_attestations/privacy_sandbox_attestations.h"
#include "content/public/browser/browser_task_traits.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/devtools_agent_host.h"
#include "ui/display/types/display_constants.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"
#include "ui/gfx/image/image.h"
#include "ui/gfx/image/image_png_rep.h"

using protocol::Response;

namespace {

BrowserWindow* GetBrowserWindow(int window_id) {
  BrowserWindow* result = nullptr;
  ForEachCurrentBrowserWindowInterfaceOrderedByActivation(
      [window_id, &result](BrowserWindowInterface* browser_window_interface) {
        if (browser_window_interface->GetSessionID().id() == window_id) {
          result = BrowserWindow::FromBrowser(browser_window_interface);
          return false;
        }
        return true;
      });
  return result;
}

std::unique_ptr<protocol::Browser::Bounds> GetBrowserWindowBounds(
    ui::BaseWindow* window) {
  std::string window_state = "normal";
  if (window->IsMinimized())
    window_state = "minimized";
  if (window->IsMaximized())
    window_state = "maximized";
  if (window->IsFullscreen())
    window_state = "fullscreen";

  gfx::Rect bounds;
  if (window->IsMinimized())
    bounds = window->GetRestoredBounds();
  else
    bounds = window->GetBounds();
  return protocol::Browser::Bounds::Create()
      .SetLeft(bounds.x())
      .SetTop(bounds.y())
      .SetWidth(bounds.width())
      .SetHeight(bounds.height())
      .SetWindowState(window_state)
      .Build();
}

}  // namespace

BrowserHandler::BrowserHandler(protocol::UberDispatcher* dispatcher,
                               const std::string& target_id,
                               bool secure_session)
    : target_id_(target_id), secure_session_(secure_session) {
  // Dispatcher can be null in tests.
  if (dispatcher)
    protocol::Browser::Dispatcher::wire(dispatcher, this);
}

BrowserHandler::~BrowserHandler() = default;

// RE: original BrowserHandler::EnsureProfile (chrome/browser/devtools/
// protocol/browser_handler.cc, strings "Profile windows are only supported
// from secure remote debugging sessions", "Profile index must be
// non-negative", "Profile %d does not exist", "Profile %d is locked", "URL must
// be valid", "Failed to load profile", "Failed to open profile window",
// "Failed to open URL"). The daemon calls it as
// Browser.ensureProfile {profileIndex, url?, shouldFocus?}.
void BrowserHandler::EnsureProfile(
    int profile_index,
    std::optional<std::string> url,
    std::optional<bool> should_focus,
    std::unique_ptr<EnsureProfileCallback> callback) {
  if (!secure_session_) {
    callback->sendFailure(protocol::Response::ServerError(
        "Profile windows are only supported from secure remote debugging "
        "sessions"));
    return;
  }
  if (profile_index < 0) {
    callback->sendFailure(
        protocol::Response::InvalidParams("Profile index must be non-negative"));
    return;
  }
  ProfileManager* profile_manager = g_browser_process->profile_manager();
  std::vector<ProfileAttributesEntry*> entries;
  if (profile_manager) {
    entries =
        profile_manager->GetProfileAttributesStorage().GetAllProfilesAttributes();
  }
  if (static_cast<size_t>(profile_index) >= entries.size()) {
    callback->sendFailure(protocol::Response::InvalidParams(
        base::StringPrintf("Profile %d does not exist", profile_index)));
    return;
  }
  ProfileAttributesEntry* entry = entries[profile_index];
  if (entry->IsSigninRequired()) {
    callback->sendFailure(protocol::Response::ServerError(
        base::StringPrintf("Profile %d is locked", profile_index)));
    return;
  }
  GURL target_url;
  if (url && !url->empty()) {
    target_url = GURL(*url);
    if (!target_url.is_valid()) {
      callback->sendFailure(
          protocol::Response::InvalidParams("URL must be valid"));
      return;
    }
  }
  profiles::LoadProfileAsync(
      entry->GetPath(),
      base::BindOnce(&BrowserHandler::OnProfileLoadedForEnsureProfile,
                     weak_factory_.GetWeakPtr(), target_url,
                     should_focus.value_or(true), std::move(callback)));
}

void BrowserHandler::OnProfileLoadedForEnsureProfile(
    GURL url,
    bool should_focus,
    std::unique_ptr<EnsureProfileCallback> callback,
    Profile* profile) {
  if (!profile) {
    callback->sendFailure(
        protocol::Response::ServerError("Failed to load profile"));
    return;
  }
  if (BrowserWindowInterface* existing =
          ProfileBrowserCollection::GetForProfile(profile)
              ->FindTabbedBrowser()) {
    OnBrowserReadyForEnsureProfile(url, should_focus, std::move(callback),
                                   existing->GetBrowserForMigrationOnly());
    return;
  }
  profiles::OpenBrowserWindowForProfile(
      base::BindOnce(&BrowserHandler::OnBrowserReadyForEnsureProfile,
                     weak_factory_.GetWeakPtr(), url, should_focus,
                     std::move(callback)),
      /*always_create=*/false, /*is_new_profile=*/false,
      /*open_command_line_urls=*/false, profile);
}

void BrowserHandler::OnBrowserReadyForEnsureProfile(
    GURL url,
    bool should_focus,
    std::unique_ptr<EnsureProfileCallback> callback,
    Browser* browser) {
  if (!browser) {
    callback->sendFailure(
        protocol::Response::ServerError("Failed to open profile window"));
    return;
  }
  if (url.is_valid()) {
    NavigateParams params(browser, url, ui::PAGE_TRANSITION_AUTO_TOPLEVEL);
    params.disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
    Navigate(&params);
    if (!params.navigated_or_inserted_contents) {
      callback->sendFailure(
          protocol::Response::ServerError("Failed to open URL"));
      return;
    }
  }
  if (should_focus && browser->window()) {
    browser->window()->Show();
    browser->window()->Activate();
  }
  callback->sendSuccess(browser->session_id().id());
}

// RE: original BrowserHandler::SetAiTabsMetadata (strings "AI Tabs metadata
// is only supported from secure remote debugging sessions", "No target with
// given id", "No web contents in the target", "Browser window not found",
// "Target is not in the current tab strip", "Target is not in a tab group";
// params badgeLabel / initialOrigin).
protocol::Response BrowserHandler::SetAiTabsMetadata(
    const std::string& target_id,
    std::optional<std::string> badge_label,
    std::optional<std::string> initial_origin) {
  if (!secure_session_) {
    return protocol::Response::ServerError(
        "AI Tabs metadata is only supported from secure remote debugging "
        "sessions");
  }
  scoped_refptr<content::DevToolsAgentHost> host =
      content::DevToolsAgentHost::GetForId(target_id);
  if (!host) {
    return protocol::Response::InvalidParams("No target with given id");
  }
  content::WebContents* web_contents = host->GetWebContents();
  if (!web_contents) {
    return protocol::Response::ServerError("No web contents in the target");
  }
  BrowserWindowInterface* browser_interface =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(web_contents);
  Browser* browser =
      browser_interface ? browser_interface->GetBrowserForMigrationOnly()
                        : nullptr;
  if (!browser) {
    return protocol::Response::ServerError("Browser window not found");
  }
  TabStripModel* model = browser->tab_strip_model();
  const int index = model->GetIndexOfWebContents(web_contents);
  if (index == TabStripModel::kNoTab) {
    return protocol::Response::ServerError(
        "Target is not in the current tab strip");
  }
  std::optional<tab_groups::TabGroupId> group = model->GetTabGroupForTab(index);
  if (!group) {
    return protocol::Response::ServerError("Target is not in a tab group");
  }
  aside::SetAiTabsMetadata(
      *group, aside::AiTabsMetadata{badge_label.value_or(std::string()),
                                    initial_origin.value_or(std::string())});
  return protocol::Response::Success();
}

Response BrowserHandler::GetWindowForTarget(
    std::optional<std::string> target_id,
    int* out_window_id,
    std::unique_ptr<protocol::Browser::Bounds>* out_bounds) {
  auto host =
      content::DevToolsAgentHost::GetForId(target_id.value_or(target_id_));
  if (!host)
    return Response::ServerError("No target with given id");
  content::WebContents* web_contents = host->GetWebContents();
  if (!web_contents) {
    return Response::ServerError("No web contents in the target");
  }

  BrowserWindowInterface* found_browser = nullptr;
  ForEachCurrentBrowserWindowInterfaceOrderedByActivation(
      [web_contents,
       &found_browser](BrowserWindowInterface* browser_window_interface) {
        int tab_index =
            browser_window_interface->GetTabStripModel()->GetIndexOfWebContents(
                web_contents);
        if (tab_index != TabStripModel::kNoTab) {
          found_browser = browser_window_interface;
          return false;
        }
        return true;
      });
  if (!found_browser) {
    return Response::ServerError("Browser window not found");
  }

  ui::BaseWindow* window = found_browser->GetWindow();
  *out_window_id = found_browser->GetSessionID().id();
  *out_bounds = GetBrowserWindowBounds(window);
  return Response::Success();
}

Response BrowserHandler::GetWindowBounds(
    int window_id,
    std::unique_ptr<protocol::Browser::Bounds>* out_bounds) {
  BrowserWindow* window = GetBrowserWindow(window_id);
  if (!window)
    return Response::ServerError("Browser window not found");

  *out_bounds = GetBrowserWindowBounds(window);
  return Response::Success();
}

Response BrowserHandler::Close() {
  ChromeDevToolsManagerDelegate::CloseBrowserSoon();
  return Response::Success();
}

Response BrowserHandler::SetWindowBounds(
    int window_id,
    std::unique_ptr<protocol::Browser::Bounds> window_bounds) {
  BrowserWindow* window = GetBrowserWindow(window_id);
  if (!window)
    return Response::ServerError("Browser window not found");
  gfx::Rect bounds = window->GetBounds();
  const bool set_bounds = window_bounds->HasLeft() || window_bounds->HasTop() ||
                          window_bounds->HasWidth() ||
                          window_bounds->HasHeight();
  if (set_bounds) {
    bounds.set_x(window_bounds->GetLeft(bounds.x()));
    bounds.set_y(window_bounds->GetTop(bounds.y()));
    bounds.set_width(window_bounds->GetWidth(bounds.width()));
    bounds.set_height(window_bounds->GetHeight(bounds.height()));
  }

  const std::string window_state = window_bounds->GetWindowState("normal");
  if (set_bounds && window_state != "normal") {
    return Response::InvalidParams(
        "The 'minimized', 'maximized' and 'fullscreen' states cannot be "
        "combined with 'left', 'top', 'width' or 'height'");
  }

  if (window_state == "fullscreen") {
    if (window->IsMinimized()) {
      return Response::ServerError(
          "To make minimized window fullscreen, "
          "restore it to normal state first.");
    }
    window->GetExclusiveAccessContext()->EnterFullscreen(
        url::Origin(), EXCLUSIVE_ACCESS_BUBBLE_TYPE_NONE,
        FullscreenTabParams());
  } else if (window_state == "maximized") {
    if (window->IsMinimized() || window->IsFullscreen()) {
      return Response::ServerError(
          "To maximize a minimized or fullscreen "
          "window, restore it to normal state first.");
    }
    window->Maximize();
  } else if (window_state == "minimized") {
    if (window->IsFullscreen()) {
      return Response::ServerError(
          "To minimize a fullscreen window, restore it to normal "
          "state first.");
    }
    window->Minimize();
  } else if (window_state == "normal") {
    if (window->IsFullscreen()) {
      window->GetExclusiveAccessContext()->ExitFullscreen();
    } else if (window->IsMinimized() || window->IsMaximized()) {
      window->Restore();
    } else if (set_bounds) {
      window->SetBounds(bounds);
    }
  } else {
    NOTREACHED();
  }

  return Response::Success();
}

protocol::Response BrowserHandler::SetContentsSize(int window_id,
                                                   std::optional<int> width,
                                                   std::optional<int> height) {
  BrowserWindow* window = GetBrowserWindow(window_id);
  if (!window) {
    return Response::ServerError("Browser window not found");
  }

  gfx::Size contents_size = window->GetContentsSize();
  if (contents_size.IsEmpty()) {
    return Response::ServerError("Active contents not found");
  }

  if (window->IsMinimized() || window->IsMaximized() ||
      window->IsFullscreen()) {
    return Response::ServerError(
        "Restore window to normal state before setting content size");
  }

  if (!width && !height) {
    return Response::InvalidParams(
        "At least one of 'width' or 'height' must be specified");
  }

  if (width && width.value() <= 0) {
    return Response::InvalidParams("Contents 'width' must be a positive value");
  }

  if (height && height.value() <= 0) {
    return Response::InvalidParams(
        "Contents 'height' must be a positive value");
  }

  // We cannot just call BrowserView::SetContentsSize() here because it will
  // constrain the browser window to the current screen work area which is not
  // desirable.
  const int width_diff = width ? width.value() - contents_size.width() : 0;
  const int height_diff = height ? height.value() - contents_size.height() : 0;
  if (width_diff || height_diff) {
    gfx::Rect bounds = window->GetBounds();
    bounds.set_width(bounds.width() + width_diff);
    bounds.set_height(bounds.height() + height_diff);
    window->SetBounds(bounds);
  }

  return Response::Success();
}

protocol::Response BrowserHandler::SetDockTile(
    std::optional<std::string> label,
    std::optional<protocol::Binary> image) {
  std::vector<gfx::ImagePNGRep> reps;
  if (image.has_value()) {
    reps.emplace_back(image.value().bytes(), 1);
  }
  DevToolsDockTile::Update(label.value_or(std::string()),
                           !reps.empty() ? gfx::Image(reps) : gfx::Image());
  return Response::Success();
}

protocol::Response BrowserHandler::ExecuteBrowserCommand(
    const protocol::Browser::BrowserCommandId& command_id) {
  static auto& command_id_map =
      *new std::map<protocol::Browser::BrowserCommandId, int>{
          {protocol::Browser::BrowserCommandIdEnum::OpenTabSearch,
           IDC_TAB_SEARCH},
          {protocol::Browser::BrowserCommandIdEnum::CloseTabSearch,
           IDC_TAB_SEARCH_CLOSE},
          {protocol::Browser::BrowserCommandIdEnum::OpenGlic, IDC_OPEN_GLIC},
      };
  if (command_id_map.count(command_id) == 0) {
    return Response::InvalidParams("Invalid BrowserCommandId: " + command_id);
  }
  if (!chrome::ExecuteCommand(
          GetLastActiveBrowserWindowInterfaceWithAnyProfile(),
          command_id_map[command_id])) {
    return Response::InvalidRequest(
        "Browser command not supported. BrowserCommandId: " + command_id);
  }
  return Response::Success();
}

protocol::Response BrowserHandler::AddPrivacySandboxEnrollmentOverride(
    const std::string& in_url) {
  auto host = content::DevToolsAgentHost::GetForId(target_id_);
  if (!host) {
    return Response::ServerError("No host found");
  }

  GURL url_to_add = GURL(in_url);

  if (!url_to_add.is_valid()) {
    return Response::InvalidParams("Invalid URL");
  }

  privacy_sandbox::PrivacySandboxAttestations::GetInstance()->AddOverride(
      net::SchemefulSite(url_to_add));
  return Response::Success();
}
