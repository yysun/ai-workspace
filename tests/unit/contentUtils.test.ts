import assert from "node:assert/strict";
import test from "node:test";
import { prepareWriteContentInput, resolveContentDescriptor } from "../../src/storage/utils/content.js";

test("resolveContentDescriptor infers common binary and text output types", () => {
  assert.deepEqual(
    resolveContentDescriptor({ workspacePath: "outputs/presentations/2026/05/17/deck.pptx" }),
    {
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      contentEncoding: "base64"
    }
  );

  assert.deepEqual(
    resolveContentDescriptor({ workspacePath: "outputs/scratch/brief.md" }),
    {
      contentType: "text/markdown",
      contentEncoding: "utf8"
    }
  );
});

test("prepareWriteContentInput converts binary bytes to base64 for common binary outputs", () => {
  const pdfBytes = Buffer.from("%PDF-1.7\nhello\u0000", "utf8");
  const prepared = prepareWriteContentInput({
    path: "outputs/presentations/2026/05/17/summary.pdf",
    content: pdfBytes,
    metadata: { title: "Summary PDF" }
  });

  assert.equal(prepared.content, pdfBytes.toString("base64"));
  assert.equal(prepared.contentType, "application/pdf");
  assert.equal(prepared.contentEncoding, "base64");
  assert.deepEqual(prepared.metadata, { title: "Summary PDF" });
});

test("prepareWriteContentInput keeps text outputs as utf8 strings", () => {
  const prepared = prepareWriteContentInput({
    path: "outputs/scratch/report.json",
    content: Buffer.from('{"ok":true}', "utf8")
  });

  assert.equal(prepared.content, '{"ok":true}');
  assert.equal(prepared.contentType, "application/json");
  assert.equal(prepared.contentEncoding, "utf8");
});

test("prepareWriteContentInput respects explicit encoding overrides", () => {
  const prepared = prepareWriteContentInput({
    path: "outputs/scratch/raw.bin",
    content: Buffer.from("plain text", "utf8"),
    contentEncoding: "utf8",
    contentType: "text/plain"
  });

  assert.equal(prepared.content, "plain text");
  assert.equal(prepared.contentType, "text/plain");
  assert.equal(prepared.contentEncoding, "utf8");
});