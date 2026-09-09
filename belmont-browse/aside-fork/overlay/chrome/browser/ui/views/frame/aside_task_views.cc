// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/views/frame/aside_task_views.h"

#include <memory>
#include <utility>

#include "base/functional/bind.h"
#include "base/strings/utf_string_conversions.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/mojom/dialog_button.mojom.h"
#include "ui/color/color_id.h"
#include "ui/color/color_provider.h"
#include "ui/gfx/canvas.h"
#include "ui/gfx/geometry/insets.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/views/bubble/bubble_border.h"
#include "ui/views/bubble/bubble_dialog_delegate_view.h"
#include "ui/views/controls/button/md_text_button.h"
#include "ui/views/controls/label.h"
#include "ui/views/controls/textfield/textfield.h"
#include "ui/views/controls/textfield/textfield_controller.h"
#include "ui/events/event.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "base/memory/raw_ptr.h"
#include "ui/views/layout/box_layout.h"
#include "ui/views/layout/box_layout_view.h"
#include "ui/views/widget/widget.h"

namespace {

constexpr int kDotSize = 8;

class PopoverController {
 public:
  PopoverController(views::View* anchor,
                    const base::DictValue& popover,
                    base::RepeatingCallback<void(const std::string&)> on_action)
      : on_action_(std::move(on_action)) {
    delegate_ = std::make_unique<views::BubbleDialogDelegate>(
        anchor, views::BubbleBorder::LEFT_TOP);
    delegate_->SetButtons(static_cast<int>(ui::mojom::DialogButton::kNone));
    delegate_->SetShowCloseButton(true);
    delegate_->SetShowTitle(false);
    delegate_->set_margins(gfx::Insets(12));

    auto contents = std::make_unique<views::BoxLayoutView>();
    contents->SetOrientation(views::BoxLayout::Orientation::kVertical);
    contents->SetBetweenChildSpacing(8);
    const std::string* title = popover.FindString("title");
    const std::string* body = popover.FindString("body");
    auto* title_label = contents->AddChildView(std::make_unique<views::Label>(
        base::UTF8ToUTF16(title ? *title : std::string()),
        views::style::CONTEXT_DIALOG_TITLE, views::style::STYLE_PRIMARY));
    title_label->SetHorizontalAlignment(gfx::ALIGN_LEFT);
    title_label->SetMultiLine(true);
    title_label->SetMaximumWidth(280);
    auto* body_label = contents->AddChildView(std::make_unique<views::Label>(
        base::UTF8ToUTF16(body ? *body : std::string()),
        views::style::CONTEXT_LABEL, views::style::STYLE_SECONDARY));
    body_label->SetHorizontalAlignment(gfx::ALIGN_LEFT);
    body_label->SetMultiLine(true);
    body_label->SetMaximumWidth(280);
    auto* actions = contents->AddChildView(std::make_unique<views::BoxLayoutView>());
    actions->SetOrientation(views::BoxLayout::Orientation::kHorizontal);
    actions->SetMainAxisAlignment(views::LayoutAlignment::kEnd);
    actions->SetBetweenChildSpacing(8);
    if (const base::ListValue* list = popover.FindList("actions")) {
      for (const base::Value& action : *list) {
        const base::DictValue* d = action.GetIfDict();
        if (!d) {
          continue;
        }
        const std::string* id = d->FindString("id");
        const std::string* label = d->FindString("label");
        if (!id || !label) {
          continue;
        }
        auto* button = actions->AddChildView(std::make_unique<views::MdTextButton>(
            base::BindRepeating(&PopoverController::OnAction,
                                base::Unretained(this), *id),
            base::UTF8ToUTF16(*label)));
        button->SetStyle(d->FindBool("primary").value_or(false)
                             ? ui::ButtonStyle::kProminent
                             : ui::ButtonStyle::kTonal);
      }
    }
    delegate_->SetContentsView(std::move(contents));
    widget_ = views::BubbleDialogDelegate::CreateBubble(
        delegate_.get(), base::BindOnce(&PopoverController::OnClosed,
                                        base::Unretained(this)));
    widget_->Show();
  }

 private:
  void OnAction(const std::string& action_id) {
    on_action_.Run(action_id);
    if (widget_) {
      widget_->Close();
    }
  }
  void OnClosed(views::Widget::ClosedReason) { delete this; }

  base::RepeatingCallback<void(const std::string&)> on_action_;
  std::unique_ptr<views::BubbleDialogDelegate> delegate_;
  std::unique_ptr<views::Widget> widget_;
};

}  // namespace

AsideTaskStatusDotView::AsideTaskStatusDotView(const std::string& status)
    : status_(status) {
  SetPreferredSize(gfx::Size(kDotSize + 4, kDotSize + 4));
}

AsideTaskStatusDotView::~AsideTaskStatusDotView() = default;

void AsideTaskStatusDotView::OnPaint(gfx::Canvas* canvas) {
  const ui::ColorProvider* provider = GetColorProvider();
  SkColor color = provider->GetColor(ui::kColorSysPrimary);
  if (status_ == "error") {
    color = provider->GetColor(ui::kColorAlertHighSeverity);
  } else if (status_ == "awaiting-approval" || status_ == "awaiting-answer") {
    color = provider->GetColor(ui::kColorAlertMediumSeverityIcon);
  } else if (status_ == "finished-unread") {
    color = provider->GetColor(ui::kColorSysPrimary);
  }
  cc::PaintFlags flags;
  flags.setAntiAlias(true);
  flags.setColor(color);
  gfx::RectF bounds(GetLocalBounds());
  bounds.Inset(2);
  canvas->DrawCircle(bounds.CenterPoint(), kDotSize / 2.0f, flags);
}

BEGIN_METADATA(AsideTaskStatusDotView)
END_METADATA

namespace {

class RenameController : public views::TextfieldController {
 public:
  RenameController(views::View* anchor,
                   const std::u16string& initial_title,
                   base::OnceCallback<void(const std::u16string&)> on_submit)
      : on_submit_(std::move(on_submit)) {
    delegate_ = std::make_unique<views::BubbleDialogDelegate>(
        anchor, views::BubbleBorder::LEFT_TOP);
    delegate_->SetButtons(static_cast<int>(ui::mojom::DialogButton::kOk) |
                          static_cast<int>(ui::mojom::DialogButton::kCancel));
    delegate_->SetShowTitle(false);
    delegate_->set_margins(gfx::Insets(12));
    delegate_->SetAcceptCallback(base::BindOnce(&RenameController::Submit,
                                                base::Unretained(this)));
    auto contents = std::make_unique<views::BoxLayoutView>();
    contents->SetOrientation(views::BoxLayout::Orientation::kVertical);
    contents->SetBetweenChildSpacing(8);
    auto* label = contents->AddChildView(std::make_unique<views::Label>(
        u"Rename Chat", views::style::CONTEXT_DIALOG_TITLE,
        views::style::STYLE_PRIMARY));
    label->SetHorizontalAlignment(gfx::ALIGN_LEFT);
    auto textfield = std::make_unique<views::Textfield>();
    textfield->SetText(initial_title);
    textfield->SetDefaultWidthInChars(32);
    textfield->set_controller(this);
    textfield_ = contents->AddChildView(std::move(textfield));
    delegate_->SetInitiallyFocusedView(textfield_);
    delegate_->SetContentsView(std::move(contents));
    widget_ = views::BubbleDialogDelegate::CreateBubble(
        delegate_.get(), base::BindOnce(&RenameController::OnClosed,
                                        base::Unretained(this)));
    widget_->Show();
  }

  bool HandleKeyEvent(views::Textfield* sender,
                      const ui::KeyEvent& key_event) override {
    if (key_event.type() == ui::EventType::kKeyPressed &&
        key_event.key_code() == ui::VKEY_RETURN) {
      Submit();
      if (widget_) {
        widget_->Close();
      }
      return true;
    }
    return false;
  }

 private:
  void Submit() {
    if (on_submit_ && textfield_) {
      std::move(on_submit_).Run(std::u16string(textfield_->GetText()));
    }
  }
  void OnClosed(views::Widget::ClosedReason) { delete this; }

  base::OnceCallback<void(const std::u16string&)> on_submit_;
  std::unique_ptr<views::BubbleDialogDelegate> delegate_;
  std::unique_ptr<views::Widget> widget_;
  raw_ptr<views::Textfield> textfield_ = nullptr;
};

}  // namespace

void ShowAsideTaskRenameBubble(
    views::View* anchor,
    const std::u16string& initial_title,
    base::OnceCallback<void(const std::u16string&)> on_submit) {
  if (!anchor) {
    return;
  }
  new RenameController(anchor, initial_title, std::move(on_submit));
}

void ShowAsideTaskPopover(
    views::View* anchor,
    const base::DictValue& popover,
    base::RepeatingCallback<void(const std::string&)> on_action) {
  if (!anchor) {
    return;
  }
  new PopoverController(anchor, popover, std::move(on_action));  // self-owned
}
