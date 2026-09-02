import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentKind, projectBelmontTranscriptPage } from "../belmont-adapter.mjs";

test("bot attachments project to opaque session refs, never host paths", () => {
  const registered = [];
  const page = { entries: [
    { kind: "send-message", id: "t1", timestampMs: 1, message: { type: "attachment", url: "file:///home/x/sand/agents/a/attachments/abc.png", file_name: "shot.png", width: 640, height: 480 } },
    { kind: "send-message", id: "t2", timestampMs: 2, message: { type: "attachment", url: "file:///home/x/sand/agents/a/attachments/def.md" } },
    { kind: "send-message", id: "t3", timestampMs: 3, message: { type: "attachment", url: "https://example.com/report", alt: "외부 보고서" } },
  ] };
  const projected = projectBelmontTranscriptPage(page, { agentId: "a", registerAttachment: (path, name) => { registered.push({ path, name }); return `ref-${registered.length}`; } });
  assert.equal(projected.messages.length, 3);
  const [image, doc, link] = projected.messages;
  assert.equal(image.kind, "attachment");
  assert.deepEqual(image.attachment, { ref: "ref-1", name: "shot.png", mime: "image/png", kind: "image", width: 640, height: 480 });
  assert.equal(doc.attachment.name, "def.md");
  assert.equal(doc.attachment.kind, "text");
  assert.equal(link.attachment.kind, "link");
  assert.equal(link.attachment.href, "https://example.com/report");
  assert.deepEqual(registered.map((item) => item.path), ["/home/x/sand/agents/a/attachments/abc.png", "/home/x/sand/agents/a/attachments/def.md"]);
  assert.ok(!JSON.stringify(projected).includes("/home/x/sand"), "host paths must not leak to the phone");
});

test("attachment kinds follow the file extension", () => {
  assert.equal(attachmentKind("a.PNG").kind, "image");
  assert.equal(attachmentKind("report.md").kind, "text");
  assert.equal(attachmentKind("page.html").kind, "html");
  assert.equal(attachmentKind("doc.pdf").kind, "pdf");
  assert.equal(attachmentKind("clip.mp4").kind, "video");
  assert.equal(attachmentKind("archive.zip").kind, "file");
  assert.equal(attachmentKind("archive.zip").mime, "application/octet-stream");
});
