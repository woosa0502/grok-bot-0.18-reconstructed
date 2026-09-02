import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Linear owns the PWA identity while Belmont remains the bot", async () => {
  const [index, manifestText, app, styles, serviceWorker] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("manifest.webmanifest", root), "utf8"),
    readFile(new URL("src/app.js", root), "utf8"),
    readFile(new URL("src/styles.css", root), "utf8"),
    readFile(new URL("sw.js", root), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.name, "Linear");
  assert.equal(manifest.short_name, "Linear");
  assert.match(index, /<title>Linear<\/title>/u);
  assert.match(index, /apple-mobile-web-app-title" content="Linear"/u);
  assert.match(app, /<strong>Linear<\/strong>/u);
  assert.match(app, /bot\?\.name \|\| "Belmont"/u);
  assert.doesNotMatch(app, /profileAvatar\("H"\)/u);
  assert.match(styles, /PPNeueMontreal-Regular\.woff2/u);
  assert.match(styles, /PretendardVariable\.woff2/u);
  assert.match(serviceWorker, /linear-mobile-v15-font-mark/u);

  for (const icon of manifest.icons) {
    assert.match(icon.src, /linear-app-icon/u);
    await access(new URL(icon.src.replace(/^\.\//u, ""), root));
  }
});
