import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
mkdirSync(resolve(root, ".build"), { recursive: true });
const temp = mkdtempSync(resolve(root, ".build/personal-sidebar-empty-"));
test.after(() => rmSync(temp, { recursive: true, force: true }));
const output = resolve(temp, "sidebar.mjs");
await build({ entryPoints: [resolve(root, "frontend/src/recovered/features/conversation/workspace/sidebar.tsx")],
  bundle: true, packages: "external", platform: "node", format: "esm", jsx: "automatic", outfile: output, logLevel: "silent" });
const { ConversationSidebar } = await import(pathToFileURL(output).href);

test("empty sections show ordinary bot rows while configured sections retain their membership", () => {
  const agents = [{ id: "a", name: "Visible bot A", updatedAt: 1700000000000 }, { id: "b", name: "Visible bot B", updatedAt: 1700000000000 }];
  const render = (sections) => renderToStaticMarkup(React.createElement(ConversationSidebar, {
    agents, sections, activeAgentId: "a", onNewChat() {}, onOpenAgent() {}, isPreviewEnabled: false,
  }));
  const ordinary = render(undefined);
  const empty = render([]);
  for (const markup of [ordinary, empty]) {
    assert.match(markup, /aria-label="Visible bot A"/);
    assert.match(markup, /aria-label="Visible bot B"/);
    assert.equal((markup.match(/class="sand-agent-item"/g) ?? []).length, 2);
  }
  const configured = render([{ id: "section-a", name: "Custom section", isSynthetic: false, isCollapsed: false, agents: [agents[0]] }]);
  assert.match(configured, /data-section-id="section-a"/);
  assert.match(configured, /aria-label="Visible bot A"/);
  assert.doesNotMatch(configured, /aria-label="Visible bot B"/);
});
