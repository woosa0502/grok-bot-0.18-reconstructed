// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/views/tabs/aside_agent_tabs_button.h"

#include <memory>
#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "base/strings/string_number_conversions.h"
#include "chrome/browser/ui/aside/aside_agent_tabs.h"
#include "chrome/browser/ui/aside/aside_extension_bridge.h"
#include "chrome/browser/ui/aside/aside_fonts.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/tabs/tab_enums.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/views/aside/icons/vector_icons.h"
#include "components/favicon/content/content_favicon_driver.h"
#include "components/vector_icons/vector_icons.h"
#include "content/public/browser/web_contents.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/models/image_model.h"
#include "ui/base/mojom/dialog_button.mojom.h"
#include "ui/base/mojom/ui_base_types.mojom.h"
#include "ui/color/color_id.h"
#include "ui/gfx/geometry/insets.h"
#include "ui/views/bubble/bubble_border.h"
#include "ui/views/bubble/bubble_dialog_delegate_view.h"
#include "ui/views/controls/button/image_button.h"
#include "ui/views/controls/button/image_button_factory.h"
#include "ui/views/controls/button/md_text_button.h"
#include "ui/views/controls/image_view.h"
#include "ui/views/controls/label.h"
#include "ui/views/layout/box_layout.h"
#include "ui/views/layout/box_layout_view.h"
#include "ui/views/widget/widget.h"

namespace {

// UTF-16 literals carried by the original binary (0xcf65f66..0xcf66040).
constexpr char16_t kAgentTabsTitle[] = u"Agent Tabs";
constexpr char16_t kButtonTooltip[] = u"Background tabs Aside opened";
constexpr char16_t kBubbleSubtitle[] = u"Background tabs opened for work";
constexpr char16_t kCloseAll[] = u"Close all";
constexpr char16_t kConfigureAutoClose[] = u"Configure auto close";

// One agent tab: favicon (kAsideGlobeIcon fallback) + title; click activates
// the tab; the trailing kCloseIcon button closes it.
class AgentTabsRowView : public views::BoxLayoutView {
  METADATA_HEADER(AgentTabsRowView, views::BoxLayoutView)

 public:
  AgentTabsRowView(Browser* browser, int index) : browser_(browser) {
    SetOrientation(views::BoxLayout::Orientation::kHorizontal);
    SetBetweenChildSpacing(4);
    TabStripModel* model = browser_->tab_strip_model();
    content::WebContents* contents = model->GetWebContentsAt(index);
    ui::ImageModel favicon = ui::ImageModel::FromVectorIcon(
        kAsideGlobeIcon, ui::kColorIcon, 16);
    if (auto* driver = favicon::ContentFaviconDriver::FromWebContents(contents);
        driver && !driver->GetFavicon().IsEmpty()) {
      favicon = ui::ImageModel::FromImage(driver->GetFavicon());
    }
    auto* activate = AddChildView(std::make_unique<views::MdTextButton>(
        base::BindRepeating(&AgentTabsRowView::Activate,
                            base::Unretained(this)),
        contents->GetTitle()));
    activate->SetStyle(ui::ButtonStyle::kText);
    activate->SetImageModel(views::Button::STATE_NORMAL, favicon);
    activate->SetHorizontalAlignment(gfx::ALIGN_LEFT);
    activate->SetCustomPadding(gfx::Insets::VH(4, 8));
    activate->SetImageLabelSpacing(8);
    activate->SetTooltipText(contents->GetTitle());
    SetFlexForView(activate, 1);
    auto close = views::CreateVectorImageButtonWithNativeTheme(
        base::BindRepeating(&AgentTabsRowView::Close, base::Unretained(this)),
        vector_icons::kCloseIcon, 16);
    close->SetTooltipText(u"Close");
    AddChildView(std::move(close));
    web_contents_ = contents;
  }

 private:
  int IndexOfContents() const {
    return browser_->tab_strip_model()->GetIndexOfWebContents(web_contents_);
  }
  void Activate() {
    const int index = IndexOfContents();
    if (index != TabStripModel::kNoTab) {
      browser_->tab_strip_model()->ActivateTabAt(index);
    }
  }
  void Close() {
    const int index = IndexOfContents();
    if (index != TabStripModel::kNoTab) {
      browser_->tab_strip_model()->CloseWebContentsAt(
          index, TabCloseTypes::CLOSE_USER_GESTURE);
    }
  }

  raw_ptr<Browser> browser_;
  raw_ptr<content::WebContents> web_contents_ = nullptr;
};

BEGIN_METADATA(AgentTabsRowView)
END_METADATA

// Owns the delegate + widget for one bubble (CLIENT_OWNS_WIDGET).
class AgentTabsBubbleController {
 public:
  AgentTabsBubbleController(views::View* anchor, Browser* browser) {
    delegate_ = std::make_unique<views::BubbleDialogDelegate>(
        anchor, views::BubbleBorder::TOP_LEFT);
    delegate_->SetButtons(static_cast<int>(ui::mojom::DialogButton::kNone));
    delegate_->SetShowCloseButton(false);
    delegate_->SetShowTitle(false);
    delegate_->set_margins(gfx::Insets(12));
    delegate_->SetContentsView(
        std::make_unique<AsideAgentTabsBubbleView>(browser));
    widget_ = views::BubbleDialogDelegate::CreateBubble(
        delegate_.get(),
        base::BindOnce(&AgentTabsBubbleController::OnClosed,
                       base::Unretained(this)));
    widget_->Show();
  }

 private:
  void OnClosed(views::Widget::ClosedReason) { delete this; }

  std::unique_ptr<views::BubbleDialogDelegate> delegate_;
  std::unique_ptr<views::Widget> widget_;
};

}  // namespace

// AsideAgentTabsButton ------------------------------------------------------

AsideAgentTabsButton::AsideAgentTabsButton(Browser* browser)
    : views::LabelButton(
          base::BindRepeating(&AsideAgentTabsButton::OnPressed,
                              base::Unretained(this)),
          std::u16string()),
      browser_(browser) {
  SetImageModel(views::Button::STATE_NORMAL,
                ui::ImageModel::FromVectorIcon(kAsideWindowSparkleStrokeIcon,
                                               ui::kColorIcon, 16));
  SetTooltipText(kButtonTooltip);
  SetImageLabelSpacing(4);
  SetBorder(views::CreateEmptyBorder(gfx::Insets::VH(4, 4)));
  if (browser_) {
    browser_->tab_strip_model()->AddObserver(this);
  }
  UpdateState();
}

AsideAgentTabsButton::~AsideAgentTabsButton() {
  if (browser_) {
    browser_->tab_strip_model()->RemoveObserver(this);
  }
}

void AsideAgentTabsButton::UpdateState() {
  const int count =
      browser_ ? aside::CountAgentTabs(browser_->tab_strip_model()) : 0;
  SetText(count > 0 ? base::NumberToString16(count) : std::u16string());
  SetVisible(count > 0);
  if (parent()) {
    parent()->InvalidateLayout();
  }
}

void AsideAgentTabsButton::OnTabStripModelChanged(
    TabStripModel* tab_strip_model,
    const TabStripModelChange& change,
    const TabStripSelectionChange& selection) {
  UpdateState();
}

void AsideAgentTabsButton::TabGroupedStateChanged(
    TabStripModel* tab_strip_model,
    std::optional<tab_groups::TabGroupId> old_group,
    std::optional<tab_groups::TabGroupId> new_group,
    tabs::TabInterface* tab,
    int index) {
  UpdateState();
}

void AsideAgentTabsButton::OnTabGroupChanged(const TabGroupChange& change) {
  UpdateState();
}

void AsideAgentTabsButton::OnPressed() {
  AsideAgentTabsBubbleView::Show(this, browser_);
}

BEGIN_METADATA(AsideAgentTabsButton)
END_METADATA

// AsideAgentTabsBubbleView --------------------------------------------------

AsideAgentTabsBubbleView::AsideAgentTabsBubbleView(Browser* browser)
    : browser_(browser) {
  SetLayoutManager(std::make_unique<views::BoxLayout>(
      views::BoxLayout::Orientation::kVertical, gfx::Insets(), 6));
  auto* title = AddChildView(std::make_unique<views::Label>(
      kAgentTabsTitle, views::style::CONTEXT_DIALOG_TITLE,
      views::style::STYLE_PRIMARY));
  title->SetHorizontalAlignment(gfx::ALIGN_LEFT);
  title->SetFontList(aside::UiFontList(15, gfx::Font::Weight::SEMIBOLD));
  auto* subtitle = AddChildView(std::make_unique<views::Label>(
      kBubbleSubtitle, views::style::CONTEXT_LABEL,
      views::style::STYLE_SECONDARY));
  subtitle->SetHorizontalAlignment(gfx::ALIGN_LEFT);
  subtitle->SetFontList(aside::UiFontList(12));

  auto rows = std::make_unique<views::BoxLayoutView>();
  rows->SetOrientation(views::BoxLayout::Orientation::kVertical);
  rows->SetCrossAxisAlignment(views::LayoutAlignment::kStretch);
  rows_ = AddChildView(std::move(rows));

  // AgentTabsCommandRowView.
  auto* command_row = AddChildView(std::make_unique<views::BoxLayoutView>());
  command_row->SetOrientation(views::BoxLayout::Orientation::kHorizontal);
  command_row->SetBetweenChildSpacing(8);
  command_row->SetMainAxisAlignment(views::LayoutAlignment::kEnd);
  auto* configure = command_row->AddChildView(std::make_unique<views::MdTextButton>(
      base::BindRepeating(&AsideAgentTabsBubbleView::OnConfigureAutoClosePressed,
                          base::Unretained(this)),
      kConfigureAutoClose));
  configure->SetStyle(ui::ButtonStyle::kText);
  auto* close_all = command_row->AddChildView(std::make_unique<views::MdTextButton>(
      base::BindRepeating(&AsideAgentTabsBubbleView::OnCloseAllPressed,
                          base::Unretained(this)),
      kCloseAll));
  close_all->SetStyle(ui::ButtonStyle::kTonal);

  SetPreferredSize(gfx::Size(320, 0));
  RebuildRows();
  if (browser_) {
    browser_->tab_strip_model()->AddObserver(this);
  }
}

AsideAgentTabsBubbleView::~AsideAgentTabsBubbleView() {
  if (browser_) {
    browser_->tab_strip_model()->RemoveObserver(this);
  }
}

// static
void AsideAgentTabsBubbleView::Show(views::View* anchor, Browser* browser) {
  if (!anchor || !browser) {
    return;
  }
  new AgentTabsBubbleController(anchor, browser);  // self-deleting
}

void AsideAgentTabsBubbleView::RebuildRows() {
  rows_->RemoveAllChildViews();
  for (int index : aside::GetAgentTabIndices(browser_->tab_strip_model())) {
    rows_->AddChildView(std::make_unique<AgentTabsRowView>(browser_, index));
  }
  SetPreferredSize(std::nullopt);
  PreferredSizeChanged();
  if (GetWidget()) {
    GetWidget()->SetSize(GetWidget()->GetContentsView()->GetPreferredSize());
  }
}

void AsideAgentTabsBubbleView::OnTabStripModelChanged(
    TabStripModel* tab_strip_model,
    const TabStripModelChange& change,
    const TabStripSelectionChange& selection) {
  RebuildRows();
}

void AsideAgentTabsBubbleView::TabGroupedStateChanged(
    TabStripModel* tab_strip_model,
    std::optional<tab_groups::TabGroupId> old_group,
    std::optional<tab_groups::TabGroupId> new_group,
    tabs::TabInterface* tab,
    int index) {
  RebuildRows();
}

void AsideAgentTabsBubbleView::OnCloseAllPressed() {
  aside::CloseAllAgentTabs(browser_->tab_strip_model());
}

void AsideAgentTabsBubbleView::OnConfigureAutoClosePressed() {
  // RE: the button file builds "/newtab.html#/u/<uid>" + "/settings/general".
  aside::ShowExtensionPage(
      browser_, aside::ExtensionPageUrl(browser_->profile(), "newtab.html",
                                        "/settings/general"));
  if (GetWidget()) {
    GetWidget()->Close();
  }
}

BEGIN_METADATA(AsideAgentTabsBubbleView)
END_METADATA
