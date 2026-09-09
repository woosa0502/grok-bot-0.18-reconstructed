// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/views/frame/aside_vertical_tab_strip_additions.h"

#include <memory>
#include <utility>

#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/profiles/profile.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/storage_partition.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/cpp/shared_url_loader_factory.h"
#include "services/network/public/cpp/simple_url_loader.h"
#include "components/prefs/pref_service.h"
#include "ui/base/window_open_disposition.h"
#include "url/gurl.h"
#include "chrome/browser/ui/aside/aside_extension_bridge.h"
#include "chrome/browser/ui/aside/aside_fonts.h"
#include "chrome/browser/ui/views/aside/aside_text_button.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/app/chrome_command_ids.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/tabs/tab_strip_prefs.h"
#include "chrome/common/pref_names.h"
#include "chrome/browser/ui/tabs/tab_group_model.h"
#include "chrome/browser/ui/tabs/tab_group_theme.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/views/aside/icons/vector_icons.h"
#include "chrome/browser/ui/views/frame/aside_bookmarks_section_view.h"
#include "chrome/browser/ui/views/frame/aside_task_views.h"
#include "ui/views/controls/throbber.h"
#include "ui/views/controls/menu/menu_runner.h"
#include "ui/menus/simple_menu_model.h"
#include "base/json/json_writer.h"
#include "chrome/browser/ui/views/tabs/aside_agent_tabs_button.h"
#include "chrome/browser/ui/views/tabs/aside_update_badge_button.h"
#include "components/tab_groups/tab_group_visual_data.h"
#include "components/tabs/public/tab_group.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/models/image_model.h"
#include "ui/base/mojom/ui_base_types.mojom.h"
#include "ui/color/color_id.h"
#include "ui/gfx/font_list.h"
#include "ui/gfx/geometry/insets.h"
#include "ui/views/background.h"
#include "ui/views/controls/button/md_text_button.h"
#include "ui/views/controls/label.h"
#include "ui/views/controls/separator.h"
#include "ui/views/layout/box_layout_view.h"
#include "ui/views/layout/flex_layout.h"
#include "ui/views/layout/flex_layout_view.h"
#include "ui/views/layout/flex_layout_types.h"
#include "ui/views/layout/layout_types.h"
#include "ui/views/view_class_properties.h"

namespace {

// Original strings (Aside 1.0.825.1 locale pak; ids in comments).
constexpr char16_t kViewOrganizer[] = u"View Organizer";   // IDS 11728
constexpr char16_t kHideOrganizer[] = u"Hide Organizer";   // IDS 11729
constexpr char16_t kTabGroups[] = u"Tab Groups";           // IDS 11730
constexpr char16_t kRecentChats[] = u"Recent Chats & Threads";  // IDS 11731
constexpr char16_t kAsideTasks[] = u"Aside Tasks";  // UTF-16 literal 0xcf648d6
// Row context menu (RE: commands nameChat / mark-read / mark-all-read /
// archive-all-chats / open-folder; IDS 11383 "Mark as Read", 11398 "Mark as
// Unread"; other labels are approximations).
enum TaskMenuCommand {
  kTaskMenuRename = 1,
  kTaskMenuMarkRead,
  kTaskMenuMarkAllRead,
  kTaskMenuArchiveAll,
  kTaskMenuOpenFolder,
  // Strip (empty area) context menu — RE IDS 277/9443/176/12245/9449/294/
  // 11699/11710 loaded by vertical_tab_strip_region_view.cc (0x43a8xxx).
  kStripMenuNewTab = 100,
  kStripMenuReopenClosedTab,
  kStripMenuBookmarkAllTabs,
  kStripMenuGroupAllTabs,
  kStripMenuNameWindow,
  kStripMenuCreateSplitView,
  kStripMenuTaskManager,
  kStripMenuShowTabsHorizontally,
};
// Literals the original builds inline (RE 0x365ff84 "Tidy", 0x36600d0
// "Organizer").
constexpr char16_t kTidy[] = u"Tidy";
constexpr char16_t kOrganizer[] = u"Organizer";
constexpr char16_t kNewChat[] = u"New Chat";

constexpr int kIconSize = 16;
constexpr base::TimeDelta kRecentsRefresh = base::Seconds(30);
// RE 0xd739f90 / 0xd739f70: margins used around the header row and dividers.
constexpr gfx::Insets kHeaderMargins = gfx::Insets::TLBR(4, 7, 0, 7);
constexpr gfx::Insets kDividerMargins = gfx::Insets::TLBR(0, 0, 0, 4);

std::unique_ptr<views::MdTextButton> MakeIconTextButton(
    views::Button::PressedCallback callback,
    const std::u16string& text,
    const gfx::VectorIcon& icon) {
  auto button =
      std::make_unique<AsideTextButton>(std::move(callback), text);
  button->SetStyle(ui::ButtonStyle::kText);
  button->SetImageModel(
      views::Button::STATE_NORMAL,
      ui::ImageModel::FromVectorIcon(icon, ui::kColorIcon, kIconSize));
  button->SetLabelFontList(
      aside::UiFontList(13, gfx::Font::Weight::MEDIUM));
  return button;
}

// RE: AsideSectionHeaderButton — a text button carrying the section title.
std::unique_ptr<views::View> MakeSectionHeader(
    const std::u16string& title,
    views::Button::PressedCallback callback) {
  auto button = std::make_unique<AsideTextButton>(
      std::move(callback), title, views::style::CONTEXT_BUTTON_MD);
  button->SetStyle(ui::ButtonStyle::kText);
  button->SetCustomPadding(gfx::Insets::VH(4, 8));
  button->SetHorizontalAlignment(gfx::ALIGN_LEFT);
  button->SetTooltipText(title);
  button->SetLabelStyle(views::style::STYLE_BODY_4_BOLD);
  button->SetLabelFontList(
      aside::UiFontList(12, gfx::Font::Weight::SEMIBOLD));
  return button;
}

}  // namespace

AsideVerticalTabStripAdditions::AsideVerticalTabStripAdditions(Browser* browser)
    : browser_(browser) {
  SetLayoutManager(std::make_unique<views::FlexLayout>())
      ->SetOrientation(views::LayoutOrientation::kVertical)
      .SetCrossAxisAlignment(views::LayoutAlignment::kStretch)
      .SetCollapseMargins(true);

  // AsideNewChatTabButtonContainer / AsideNewChatTabButton: one full-width
  // row of fixed height; the region's vertical FlexLayout keeps it at its
  // preferred size (the original's container is a plain View with the button
  // stretched across it).
  auto* new_chat_container = AddChildView(std::make_unique<views::BoxLayoutView>());
  new_chat_container->SetOrientation(views::BoxLayout::Orientation::kHorizontal);
  new_chat_container->SetProperty(views::kMarginsKey, kHeaderMargins);
  auto* new_chat = new_chat_container->AddChildView(MakeIconTextButton(
      base::BindRepeating(&AsideVerticalTabStripAdditions::OnNewChatPressed,
                          base::Unretained(this)),
      kNewChat, kAsideEditThinStrokeIcon));
  new_chat->SetHorizontalAlignment(gfx::ALIGN_LEFT);
  new_chat->SetCustomPadding(gfx::Insets::VH(6, 10));
  new_chat_container->SetFlexForView(new_chat, 1);

  // TabsHeaderActionButton row: "Tidy" (sparkles) + "Organizer" (arrow-down).
  // Header actions row. FlexLayout lets the text buttons shrink (elide)
  // instead of dropping out when the strip is narrow.
  auto* header_row = AddChildView(std::make_unique<views::FlexLayoutView>());
  header_row->SetOrientation(views::LayoutOrientation::kHorizontal);
  header_row->SetProperty(views::kMarginsKey, kHeaderMargins);
  header_row->SetMainAxisAlignment(views::LayoutAlignment::kEnd);
  header_row->SetCrossAxisAlignment(views::LayoutAlignment::kCenter);
  header_row->SetDefault(views::kMarginsKey, gfx::Insets::TLBR(0, 0, 0, 2));
  header_row->SetDefault(
      views::kFlexBehaviorKey,
      views::FlexSpecification(views::MinimumFlexSizeRule::kScaleToMinimum,
                               views::MaximumFlexSizeRule::kPreferred));
  auto* tidy = header_row->AddChildView(MakeIconTextButton(
      base::BindRepeating(&AsideVerticalTabStripAdditions::OnTidyPressed,
                          base::Unretained(this)),
      kTidy, kAsideSparklesTwo2solidIcon));
  tidy->SetCustomPadding(gfx::Insets::VH(4, 6));
  tidy->SetImageLabelSpacing(4);
  organizer_button_ = header_row->AddChildView(MakeIconTextButton(
      base::BindRepeating(&AsideVerticalTabStripAdditions::OnOrganizerToggled,
                          base::Unretained(this)),
      kOrganizer, kAsideArrowDownStrokeIcon));
  organizer_button_->SetCustomPadding(gfx::Insets::VH(4, 6));
  organizer_button_->SetImageLabelSpacing(4);
  organizer_button_->SetTooltipText(kHideOrganizer);

  // AsideUpdateBadgeButton (hidden until an update is ready).
  header_row->AddChildView(std::make_unique<AsideUpdateBadgeButton>(browser_));
  // AsideAgentTabsButton (hidden until the "Agent Tabs" group exists).
  header_row->AddChildView(std::make_unique<AsideAgentTabsButton>(browser_));

  // AsideSectionDivider.
  auto* divider = AddChildView(std::make_unique<views::Separator>());
  divider->SetProperty(views::kMarginsKey, kDividerMargins);

  // Organizer: sections.
  auto organizer = std::make_unique<views::BoxLayoutView>();
  organizer->SetOrientation(views::BoxLayout::Orientation::kVertical);
  organizer->SetCrossAxisAlignment(views::LayoutAlignment::kStretch);
  organizer_ = organizer.get();
  detached_organizer_ = std::move(organizer);
  organizer_->AddChildView(
      MakeSectionHeader(kTabGroups, views::Button::PressedCallback()));
  auto tab_groups_rows = std::make_unique<views::BoxLayoutView>();
  tab_groups_rows->SetOrientation(views::BoxLayout::Orientation::kVertical);
  tab_groups_rows->SetCrossAxisAlignment(views::LayoutAlignment::kStretch);
  tab_groups_rows_ = organizer_->AddChildView(std::move(tab_groups_rows));
  // Bookmarks section (pref-gated).
  organizer_->AddChildView(std::make_unique<AsideBookmarksSectionView>(browser_));

  // "Aside Tasks": sessions needing attention (running / awaiting / error).
  {
    auto section = std::make_unique<views::BoxLayoutView>();
    section->SetOrientation(views::BoxLayout::Orientation::kVertical);
    section->SetCrossAxisAlignment(views::LayoutAlignment::kStretch);
    section->AddChildView(
        MakeSectionHeader(kAsideTasks, views::Button::PressedCallback()));
    auto rows = std::make_unique<views::BoxLayoutView>();
    rows->SetOrientation(views::BoxLayout::Orientation::kVertical);
    rows->SetCrossAxisAlignment(views::LayoutAlignment::kStretch);
    tasks_rows_ = section->AddChildView(std::move(rows));
    tasks_section_ = organizer_->AddChildView(std::move(section));
    tasks_section_->SetVisible(false);
  }
  organizer_->AddChildView(MakeSectionHeader(
      kRecentChats,
      base::BindRepeating(&AsideVerticalTabStripAdditions::OpenRecentsList,
                          base::Unretained(this))));
  auto recents_rows = std::make_unique<views::BoxLayoutView>();
  recents_rows->SetOrientation(views::BoxLayout::Orientation::kVertical);
  recents_rows->SetCrossAxisAlignment(views::LayoutAlignment::kStretch);
  recents_rows_ = organizer_->AddChildView(std::move(recents_rows));

  if (browser_) {
    browser_->tab_strip_model()->AddObserver(this);
  }
  RebuildTabGroupsSection();
  FetchRecents();
  recents_timer_.Start(FROM_HERE, kRecentsRefresh, this,
                       &AsideVerticalTabStripAdditions::FetchRecents);
}

AsideVerticalTabStripAdditions::~AsideVerticalTabStripAdditions() {
  if (browser_) {
    browser_->tab_strip_model()->RemoveObserver(this);
  }
}

void AsideVerticalTabStripAdditions::OnTabStripModelChanged(
    TabStripModel* tab_strip_model,
    const TabStripModelChange& change,
    const TabStripSelectionChange& selection) {
  RebuildTabGroupsSection();
}

void AsideVerticalTabStripAdditions::OnTabGroupChanged(
    const TabGroupChange& change) {
  RebuildTabGroupsSection();
}

std::unique_ptr<views::View> AsideVerticalTabStripAdditions::TakeOrganizerView() {
  return std::move(detached_organizer_);
}

void AsideVerticalTabStripAdditions::OnNewChatPressed() {
  if (!browser_) {
    return;
  }
  // RE 0x43ee0e0: "main.html" + "/tasks/new" through the account-scoped
  // extension URL builder.
  aside::ShowExtensionPage(
      browser_, aside::ExtensionPageUrl(browser_->profile(), "main.html",
                                        "/tasks/new"));
}

void AsideVerticalTabStripAdditions::OnTidyPressed() {
  if (!browser_) {
    return;
  }
  // RE 0x43d2b7c: the Tidy button posts an external runtime message to the
  // extension, which runs its AI tab-tidy planner and replies {success,...}.
  TabStripModel* model = browser_->tab_strip_model();
  base::DictValue payload;
  payload.Set("source", "vertical_tabs_sidebar");
  payload.Set("action", "tidy");
  payload.Set("tab_count", model ? model->count() : 0);
  payload.Set("active_tab_index", model ? model->active_index() : -1);
  if (content::WebContents* active =
          model ? model->GetActiveWebContents() : nullptr) {
    payload.Set("active_tab_url", active->GetVisibleURL().spec());
    payload.Set("active_tab_title", base::UTF16ToUTF8(active->GetTitle()));
  }
  aside::SendExternalMessage(browser_->profile(), "aside.verticalTabsTidy",
                             std::move(payload));
}

void AsideVerticalTabStripAdditions::OnOrganizerToggled() {
  organizer_visible_ = !organizer_visible_;
  organizer_->SetVisible(organizer_visible_);
  organizer_button_->SetTooltipText(organizer_visible_ ? kHideOrganizer
                                                       : kViewOrganizer);
  InvalidateLayout();
}

void AsideVerticalTabStripAdditions::RebuildTabGroupsSection() {
  if (!tab_groups_rows_ || !browser_) {
    return;
  }
  tab_groups_rows_->RemoveAllChildViews();
  TabStripModel* model = browser_->tab_strip_model();
  TabGroupModel* groups = model->group_model();
  if (!groups) {
    return;
  }
  for (const tab_groups::TabGroupId& id : groups->ListTabGroups()) {
    const TabGroup* group = groups->GetTabGroup(id);
    if (!group) {
      continue;
    }
    const tab_groups::TabGroupVisualData* visual = group->visual_data();
    std::u16string title = visual ? visual->title() : std::u16string();
    if (title.empty()) {
      title = u"Unnamed group";
    }
    const gfx::Range tabs = group->ListTabs();
    auto* row = tab_groups_rows_->AddChildView(
        std::make_unique<views::MdTextButton>(
            base::BindRepeating(
                [](TabStripModel* m, size_t index) {
                  if (index < static_cast<size_t>(m->count())) {
                    m->ActivateTabAt(static_cast<int>(index));
                  }
                },
                base::Unretained(model), static_cast<size_t>(tabs.start())),
            title));
    row->SetStyle(ui::ButtonStyle::kText);
    row->SetHorizontalAlignment(gfx::ALIGN_LEFT);
    row->SetCustomPadding(gfx::Insets::VH(4, 10));
    if (visual) {
      row->SetImageModel(
          views::Button::STATE_NORMAL,
          ui::ImageModel::FromVectorIcon(
              kAsideCircleXSolidIcon,
              GetTabGroupTabStripColorId(visual->color(),
                                         /*active_frame=*/true),
              10));
    }
  }
  InvalidateLayout();
}

void AsideVerticalTabStripAdditions::FetchRecents() {
  if (!browser_ || recents_in_flight_) {
    return;
  }
  if (!tasks_client_) {
    tasks_client_ = std::make_unique<aside::TasksClient>(browser_->profile());
  }
  recents_in_flight_ = true;
  tasks_client_->Get(
      "/session/for-chrome/recents",
      base::BindOnce(&AsideVerticalTabStripAdditions::OnRecentsFetched,
                     weak_factory_.GetWeakPtr()));
}

views::View* AsideVerticalTabStripAdditions::MakeTaskRow(
    views::View* parent,
    const base::DictValue& item) {
  const std::string id = *item.FindString("id");
  const std::string title = *item.FindString("title");
  const bool unread = item.FindBool("unread").value_or(false);
  const std::string* status_ptr = item.FindString("status");
  const std::string status = status_ptr ? *status_ptr : "idle";

  auto* row = parent->AddChildView(std::make_unique<views::BoxLayoutView>());
  row->SetOrientation(views::BoxLayout::Orientation::kHorizontal);
  row->SetCrossAxisAlignment(views::LayoutAlignment::kCenter);
  row->SetBetweenChildSpacing(2);
  if (status == "running") {
    auto* throbber = row->AddChildView(std::make_unique<views::Throbber>());
    throbber->SetPreferredSize(gfx::Size(12, 12));
    throbber->Start();
  } else if (status != "idle") {
    row->AddChildView(std::make_unique<AsideTaskStatusDotView>(status));
  }
  auto* button = row->AddChildView(std::make_unique<AsideTextButton>(
      base::BindRepeating(&AsideVerticalTabStripAdditions::OpenSession,
                          base::Unretained(this), id),
      base::UTF8ToUTF16(title)));
  button->SetStyle(ui::ButtonStyle::kText);
  button->SetHorizontalAlignment(gfx::ALIGN_LEFT);
  button->SetCustomPadding(gfx::Insets::VH(4, 8));
  button->SetTooltipText(base::UTF8ToUTF16(title));
  button->SetLabelFontList(aside::UiFontList(13));
  if (unread) {
    button->SetImageModel(views::Button::STATE_NORMAL,
                          ui::ImageModel::FromVectorIcon(
                              kAsideBell2SolidIcon, ui::kColorIcon, 10));
  }
  row->SetFlexForView(button, 1);
  // Right click: task commands.
  button->set_context_menu_controller(this);
  row_menus_[button] = RowInfo{id, title, unread};
  return row;
}

void AsideVerticalTabStripAdditions::OnRecentsFetched(
    std::optional<std::string> body) {
  recents_in_flight_ = false;
  if (!recents_rows_ || !body) {
    return;
  }
  std::optional<base::Value> parsed =
      base::JSONReader::Read(*body, base::JSON_PARSE_RFC);
  if (!parsed || !parsed->is_list()) {
    return;
  }
  recents_rows_->RemoveAllChildViews();
  tasks_rows_->RemoveAllChildViews();
  row_menus_.clear();
  int shown = 0;
  bool attention = false;
  for (const base::Value& entry : parsed->GetList()) {
    const base::DictValue* item = entry.GetIfDict();
    if (!item || !item->FindString("id") || !item->FindString("title")) {
      continue;
    }
    const std::string* status = item->FindString("status");
    const bool needs_attention =
        status && (*status == "running" || *status == "awaiting-approval" ||
                   *status == "awaiting-answer" || *status == "error");
    if (needs_attention) {
      views::View* row = MakeTaskRow(tasks_rows_, *item);
      attention = true;
      MaybeShowPopover(row, *item);
      continue;
    }
    if (shown < 8) {
      MakeTaskRow(recents_rows_, *item);
      ++shown;
    }
  }
  tasks_section_->SetVisible(attention);
  if (attention && !organizer_visible_) {
    // RE: MaybeExpandTasksSectionForAttention.
    OnOrganizerToggled();
  }
  InvalidateLayout();
}

void AsideVerticalTabStripAdditions::MaybeShowPopover(
    views::View* row,
    const base::DictValue& item) {
  const base::DictValue* popover = item.FindDict("popover");
  if (!popover) {
    return;
  }
  const std::string* popover_id = popover->FindString("id");
  const std::string* session_id = item.FindString("id");
  if (!popover_id || !session_id || shown_popovers_.contains(*popover_id)) {
    return;
  }
  shown_popovers_.insert(*popover_id);
  ShowAsideTaskPopover(
      row, *popover,
      base::BindRepeating(&AsideVerticalTabStripAdditions::OnPopoverAction,
                          weak_factory_.GetWeakPtr(), *session_id,
                          *popover_id));
}

void AsideVerticalTabStripAdditions::OnPopoverAction(
    const std::string& session_id,
    const std::string& popover_id,
    const std::string& action_id) {
  if (!tasks_client_) {
    return;
  }
  base::DictValue body;
  body.Set("accountId", std::max(tasks_client_->account_id(), 0));
  body.Set("sessionId", session_id);
  body.Set("popoverId", popover_id);
  body.Set("actionId", action_id);
  std::string json;
  base::JSONWriter::Write(body, &json);
  tasks_client_->PostJson(
      "/session/for-chrome/resolve-popover-action", std::move(json),
      base::BindOnce(&AsideVerticalTabStripAdditions::OnPopoverActionResolved,
                     weak_factory_.GetWeakPtr()));
}

void AsideVerticalTabStripAdditions::OnPopoverActionResolved(
    std::optional<std::string> body) {
  std::optional<base::Value> parsed =
      body ? base::JSONReader::Read(*body, base::JSON_PARSE_RFC)
           : std::nullopt;
  if (parsed && parsed->is_dict()) {
    const std::string* action = parsed->GetDict().FindString("clientAction");
    const std::string* url = parsed->GetDict().FindString("url");
    if (action && *action == "open-url" && url && browser_) {
      aside::ShowExtensionPage(browser_, GURL(*url));
    }
  }
  FetchRecents();
}

void AsideVerticalTabStripAdditions::ShowRowMenu(const std::string& session_id,
                                                 const std::string& title,
                                                 bool unread,
                                                 const gfx::Point& point) {
  menu_model_ = std::make_unique<ui::SimpleMenuModel>(this);
  menu_model_->AddItem(kTaskMenuRename, u"Rename Chat");
  menu_model_->AddItem(kTaskMenuMarkRead,
                       unread ? u"Mark as Read" : u"Mark as Unread");
  menu_model_->AddItem(kTaskMenuMarkAllRead, u"Mark All as Read");
  menu_model_->AddItem(kTaskMenuArchiveAll, u"Archive All Chats");
  menu_model_->AddItem(kTaskMenuOpenFolder, u"Open Folder");
  menu_runner_ = std::make_unique<views::MenuRunner>(
      menu_model_.get(), views::MenuRunner::HAS_MNEMONICS |
                             views::MenuRunner::CONTEXT_MENU);
  pending_menu_ = RowInfo{session_id, title, unread};
  menu_runner_->RunMenuAt(GetWidget(), nullptr, gfx::Rect(point, gfx::Size()),
                          views::MenuAnchorPosition::kTopLeft,
                          ui::mojom::MenuSourceType::kMouse);
}

void AsideVerticalTabStripAdditions::ShowStripMenu(const gfx::Point& point) {
  menu_model_ = std::make_unique<ui::SimpleMenuModel>(this);
  menu_model_->AddItem(kStripMenuNewTab, u"New Tab");
  menu_model_->AddItem(kStripMenuReopenClosedTab, u"Reopen Closed Tab");
  menu_model_->AddSeparator(ui::NORMAL_SEPARATOR);
  menu_model_->AddItem(kStripMenuBookmarkAllTabs, u"Bookmark All Tabs…");
  menu_model_->AddItem(kStripMenuGroupAllTabs, u"Group All Tabs");
  menu_model_->AddItem(kStripMenuNameWindow, u"Name Window…");
  menu_model_->AddItem(kStripMenuCreateSplitView, u"Create split view");
  menu_model_->AddSeparator(ui::NORMAL_SEPARATOR);
  menu_model_->AddItem(kStripMenuTaskManager, u"Task Manager");
  menu_model_->AddItem(kStripMenuShowTabsHorizontally,
                       u"Show Tabs Horizontally");
  menu_runner_ = std::make_unique<views::MenuRunner>(
      menu_model_.get(), views::MenuRunner::HAS_MNEMONICS |
                             views::MenuRunner::CONTEXT_MENU);
  menu_runner_->RunMenuAt(GetWidget(), nullptr, gfx::Rect(point, gfx::Size()),
                          views::MenuAnchorPosition::kTopLeft,
                          ui::mojom::MenuSourceType::kMouse);
}

void AsideVerticalTabStripAdditions::ShowContextMenuForViewImpl(
    views::View* source,
    const gfx::Point& point,
    ui::mojom::MenuSourceType source_type) {
  auto it = row_menus_.find(source);
  if (it == row_menus_.end()) {
    ShowStripMenu(point);
    return;
  }
  ShowRowMenu(it->second.session_id, it->second.title, it->second.unread,
              point);
}

bool AsideVerticalTabStripAdditions::IsCommandIdChecked(int command_id) const {
  return false;
}

bool AsideVerticalTabStripAdditions::IsCommandIdEnabled(int command_id) const {
  return true;
}

void AsideVerticalTabStripAdditions::ExecuteCommand(int command_id,
                                                    int event_flags) {
  const std::string& id = pending_menu_.session_id;
  switch (command_id) {
    case kTaskMenuRename:
      ShowAsideTaskRenameBubble(
          this, base::UTF8ToUTF16(pending_menu_.title),
          base::BindOnce(&AsideVerticalTabStripAdditions::OnRenameSubmitted,
                         weak_factory_.GetWeakPtr(), id));
      break;
    case kTaskMenuMarkRead:
      RunTaskCommand("/session/for-chrome/" + id + "/mark-read", "{}");
      break;
    case kTaskMenuMarkAllRead:
      RunTaskCommand("/session/for-chrome/mark-all-read", "{}");
      break;
    case kTaskMenuArchiveAll:
      RunTaskCommand("/session/for-chrome/archive-all-chats", "{}");
      break;
    case kTaskMenuOpenFolder:
      RunTaskCommand("/session/for-chrome/" + id + "/open-folder", "{}");
      break;
    case kStripMenuNewTab:
      chrome::ExecuteCommand(browser_, IDC_NEW_TAB);
      break;
    case kStripMenuReopenClosedTab:
      chrome::ExecuteCommand(browser_, IDC_RESTORE_TAB);
      break;
    case kStripMenuBookmarkAllTabs:
      chrome::ExecuteCommand(browser_, IDC_BOOKMARK_ALL_TABS);
      break;
    case kStripMenuGroupAllTabs: {
      TabStripModel* model = browser_->tab_strip_model();
      std::vector<int> indices;
      for (int i = 0; i < model->count(); ++i) {
        if (!model->GetTabGroupForTab(i)) {
          indices.push_back(i);
        }
      }
      if (!indices.empty()) {
        model->AddToNewGroup(indices);
      }
      break;
    }
    case kStripMenuNameWindow:
      chrome::ExecuteCommand(browser_, IDC_NAME_WINDOW);
      break;
    case kStripMenuCreateSplitView:
      chrome::ExecuteCommand(browser_, IDC_NEW_SPLIT_TAB);
      break;
    case kStripMenuTaskManager:
      chrome::ExecuteCommand(browser_, IDC_TASK_MANAGER);
      break;
    case kStripMenuShowTabsHorizontally:
      browser_->profile()->GetPrefs()->SetBoolean(prefs::kVerticalTabsEnabled,
                                                  false);
      break;
    default:
      break;
  }
}

void AsideVerticalTabStripAdditions::OnRenameSubmitted(
    const std::string& session_id,
    const std::u16string& title) {
  base::DictValue body;
  body.Set("title", base::UTF16ToUTF8(title));
  std::string json;
  base::JSONWriter::Write(body, &json);
  RunTaskCommand("/session/for-chrome/" + session_id + "/rename",
                 std::move(json));
}

void AsideVerticalTabStripAdditions::RunTaskCommand(const std::string& path,
                                                    std::string body) {
  if (!tasks_client_) {
    return;
  }
  tasks_client_->PostJson(
      path, std::move(body),
      base::BindOnce(&AsideVerticalTabStripAdditions::OnTaskCommandDone,
                     weak_factory_.GetWeakPtr()));
}

void AsideVerticalTabStripAdditions::OnTaskCommandDone(
    std::optional<std::string> body) {
  FetchRecents();
}

void AsideVerticalTabStripAdditions::OpenSession(const std::string& session_id) {
  if (!browser_) {
    return;
  }
  // RE 0x43d8e40: "main.html" + "/tasks" + "/" + id via the account-scoped
  // extension URL builder ("#/u/<aside.account_id>").
  aside::ShowExtensionPage(
      browser_, aside::ExtensionPageUrl(browser_->profile(), "main.html",
                                        "/tasks/" + session_id));
}

void AsideVerticalTabStripAdditions::OpenRecentsList() {
  if (!browser_) {
    return;
  }
  // RE 0x43d2000: section header opens the full task list.
  aside::ShowExtensionPage(
      browser_,
      aside::ExtensionPageUrl(browser_->profile(), "main.html",
                              "/tasks?view=list&filter=all&order=desc"));
}

BEGIN_METADATA(AsideVerticalTabStripAdditions)
END_METADATA
