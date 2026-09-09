// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_VERTICAL_TAB_STRIP_ADDITIONS_H_
#define CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_VERTICAL_TAB_STRIP_ADDITIONS_H_

#include <memory>
#include <optional>
#include <string>

#include <map>
#include <set>

#include "base/memory/raw_ptr.h"
#include "base/values.h"
#include "chrome/browser/ui/aside/aside_tasks_client.h"
#include "ui/menus/simple_menu_model.h"
#include "ui/views/controls/menu/menu_runner.h"
#include "ui/views/context_menu_controller.h"
#include "base/memory/weak_ptr.h"
#include "base/timer/timer.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/views/view.h"

class Browser;

namespace network {
class SimpleURLLoader;
}

namespace views {
class Label;
class MdTextButton;
}  // namespace views

// The Aside-specific rows that the original inserts into the vertical tab
// strip between the top button container and the tab list (RE of
// vertical_tab_strip_region_view.cc, Aside 1.0.825.1, builder @0x365e800):
//   [AsideNewChatTabButtonContainer] -> [AsideNewChatTabButton]
//   [TabsHeaderActionButton] ... [AsideIconButton "Tidy"][AsideIconButton "Organizer"]
//   [AsideSectionDivider]
//   [AsideSectionView "Tab Groups"] / [AsideSectionView "Recent Chats & Threads"]
// Class names, icons (kAsideEditThinStrokeIcon, kAsideSparklesTwo2solidIcon,
// kAsideArrowDownStrokeIcon) and strings (IDS 11728-11731) are the original's.
class AsideVerticalTabStripAdditions : public views::View,
                                       public TabStripModelObserver,
                                       public views::ContextMenuController,
                                       public ui::SimpleMenuModel::Delegate {
  METADATA_HEADER(AsideVerticalTabStripAdditions, views::View)

 public:
  explicit AsideVerticalTabStripAdditions(Browser* browser);
  AsideVerticalTabStripAdditions(const AsideVerticalTabStripAdditions&) = delete;
  AsideVerticalTabStripAdditions& operator=(
      const AsideVerticalTabStripAdditions&) = delete;
  ~AsideVerticalTabStripAdditions() override;

  // TabStripModelObserver:
  void OnTabStripModelChanged(TabStripModel* tab_strip_model,
                              const TabStripModelChange& change,
                              const TabStripSelectionChange& selection) override;
  void OnTabGroupChanged(const TabGroupChange& change) override;

  bool organizer_visible() const { return organizer_visible_; }
  // The organizer sections ("Tab Groups", "Recent Chats & Threads") are a
  // separate view so the region can place them below the tab list (original
  // builder order: header row -> divider -> tab list -> sections).
  std::unique_ptr<views::View> TakeOrganizerView();

 private:
  void OnNewChatPressed();
  void OnTidyPressed();
  void OnOrganizerToggled();
  void RebuildTabGroupsSection();
  // "Recent Chats & Threads": the original fetches the daemon's
  // GET http://127.0.0.1:21420/session/for-chrome/recents (a public loopback
  // route) and lists {id,title,status,unread,...}.
  void FetchRecents();
  void OnRecentsFetched(std::optional<std::string> body);
  views::View* MakeTaskRow(views::View* parent, const base::DictValue& item);
  void MaybeShowPopover(views::View* row, const base::DictValue& item);
  void OnPopoverAction(const std::string& session_id,
                       const std::string& popover_id,
                       const std::string& action_id);
  void OnPopoverActionResolved(std::optional<std::string> body);
  void ShowRowMenu(const std::string& session_id,
                   const std::string& title,
                   bool unread,
                   const gfx::Point& point);
  void OnRenameSubmitted(const std::string& session_id,
                         const std::u16string& title);
  void ShowStripMenu(const gfx::Point& point);

  // views::ContextMenuController:
  void ShowContextMenuForViewImpl(
      views::View* source,
      const gfx::Point& point,
      ui::mojom::MenuSourceType source_type) override;

  // ui::SimpleMenuModel::Delegate:
  bool IsCommandIdChecked(int command_id) const override;
  bool IsCommandIdEnabled(int command_id) const override;
  void ExecuteCommand(int command_id, int event_flags) override;
  void RunTaskCommand(const std::string& path, std::string body);
  void OnTaskCommandDone(std::optional<std::string> body);
  void OpenSession(const std::string& session_id);
  void OpenRecentsList();

  raw_ptr<Browser> browser_;
  bool organizer_visible_ = true;
  raw_ptr<views::View> organizer_ = nullptr;
  std::unique_ptr<views::View> detached_organizer_;
  raw_ptr<views::View> tab_groups_rows_ = nullptr;
  raw_ptr<views::MdTextButton> organizer_button_ = nullptr;
  raw_ptr<views::View> recents_rows_ = nullptr;
  raw_ptr<views::View> tasks_section_ = nullptr;
  raw_ptr<views::View> tasks_rows_ = nullptr;
  std::unique_ptr<aside::TasksClient> tasks_client_;
  std::set<std::string> shown_popovers_;
  std::unique_ptr<ui::SimpleMenuModel> menu_model_;
  std::unique_ptr<views::MenuRunner> menu_runner_;
  bool recents_in_flight_ = false;
  struct RowInfo {
    std::string session_id;
    std::string title;
    bool unread = false;
  };
  std::map<views::View*, RowInfo> row_menus_;
  RowInfo pending_menu_;
  base::RepeatingTimer recents_timer_;
  base::WeakPtrFactory<AsideVerticalTabStripAdditions> weak_factory_{this};
};

#endif  // CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_VERTICAL_TAB_STRIP_ADDITIONS_H_
