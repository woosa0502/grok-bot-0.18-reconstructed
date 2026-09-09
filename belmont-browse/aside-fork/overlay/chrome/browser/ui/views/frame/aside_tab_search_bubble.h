// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_TAB_SEARCH_BUBBLE_H_
#define CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_TAB_SEARCH_BUBBLE_H_

#include "base/memory/raw_ptr.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/views/controls/webview/webview.h"
#include "ui/views/view.h"

class Profile;

// The original replaces Chromium's WebUI tab search bubble with a bubble that
// hosts the Aside extension's tabsearch.html (RE:
// chrome/browser/ui/views/frame/aside_tab_search_bubble.cc — classes
// AsideTabSearchWebView / AsideTabSearchBubbleContentsView, extension id
// fjdhphbdlfjogobdofoaagnlnkoibdge, "web_contents", "ReloadForNextShow").
class AsideTabSearchWebView : public views::WebView {
  METADATA_HEADER(AsideTabSearchWebView, views::WebView)

 public:
  explicit AsideTabSearchWebView(Profile* profile);
  ~AsideTabSearchWebView() override;
};

class AsideTabSearchBubbleContentsView : public views::View {
  METADATA_HEADER(AsideTabSearchBubbleContentsView, views::View)

 public:
  explicit AsideTabSearchBubbleContentsView(Profile* profile);
  ~AsideTabSearchBubbleContentsView() override;

  // Shows the bubble anchored at |anchor| if the Aside extension is installed;
  // returns false when the caller should fall back to Chromium's tab search.
  static bool MaybeShow(views::View* anchor, Profile* profile);

  views::View* web_view() { return web_view_; }

 private:
  raw_ptr<AsideTabSearchWebView> web_view_ = nullptr;
};

#endif  // CHROME_BROWSER_UI_VIEWS_FRAME_ASIDE_TAB_SEARCH_BUBBLE_H_
