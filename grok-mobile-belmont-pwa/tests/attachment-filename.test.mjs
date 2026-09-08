import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createMobileServer } from "../server.mjs";

test("attachment HTTP content preserves Unicode download names and valid headers", async context => {
  const bytes = Buffer.from("%PDF-test");
  const { server } = createMobileServer({
    skipPairing: true, sessionFile: null, sendLedgerFile: null, pushFile: null,
    gateway: { async call(method) {
      assert.equal(method, "readAttachmentChunk");
      return { bytesBase64: bytes.toString("base64"), totalSize: bytes.length, mime: "application/pdf" };
    } },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise(resolve => server.close(resolve)));
  for (const name of ["report.pdf", "보고서.pdf", "검토 📝 (O'Brien).pdf"]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/attachments/content?agentId=test&path=%2Ffixture.pdf&name=${encodeURIComponent(name)}`);
    assert.equal(response.status, 200, name);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    const disposition = response.headers.get("content-disposition");
    assert.match(disposition, /^inline; filename="[\x20-\x7e]*"; filename\*=UTF-8''/u);
    assert.equal(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]), name);
  }
});
