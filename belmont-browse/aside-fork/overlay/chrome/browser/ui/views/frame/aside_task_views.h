// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_TASK_VIEWS_H_
#define CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_TASK_VIEWS_H_

#include <string>

#include "base/functional/callback.h"
#include "base/values.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/views/view.h"

namespace views {
class View;
}

// Small status dot for a task row (RE: AsideTaskStatusDotView; colours by
// status: awaiting-approval / awaiting-answer / error / finished-unread).
class AsideTaskStatusDotView : public views::View {
  METADATA_HEADER(AsideTaskStatusDotView, views::View)

 public:
  explicit AsideTaskStatusDotView(const std::string& status);
  ~AsideTaskStatusDotView() override;

  void OnPaint(gfx::Canvas* canvas) override;

 private:
  std::string status_;
};

// Task popover (RE: AsideTaskPopoverContentController /
// MaybeShowNewAsideTaskPopover): title, body and action buttons from the
// daemon's `popover` {id, kind, title, body, actions:[{id,label,primary}]}.
// `on_action` receives the chosen actionId.
// Rename dialog for a chat row ("nameChat"): a textfield prefilled with the
// current title; Enter/OK submits.
void ShowAsideTaskRenameBubble(
    views::View* anchor,
    const std::u16string& initial_title,
    base::OnceCallback<void(const std::u16string&)> on_submit);

void ShowAsideTaskPopover(views::View* anchor,
                          const base::DictValue& popover,
                          base::RepeatingCallback<void(const std::string&)> on_action);

#endif  // CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_TASK_VIEWS_H_
