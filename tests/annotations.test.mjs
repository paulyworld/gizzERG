import assert from "node:assert/strict";
import test from "node:test";
import {
  ANNOTATION_LIMITS,
  CLIENT_ID,
  TAG_PRESETS,
  buildAnnotateCommand,
  presetForHotkey,
} from "../src/annotations.js";

test("buildAnnotateCommand minimal payload", () => {
  const payload = buildAnnotateCommand({ tag: "ui-pause" });
  assert.deepEqual(payload, { type: "annotate", tag: "ui-pause", client_id: CLIENT_ID });
});

test("buildAnnotateCommand includes note when provided", () => {
  const payload = buildAnnotateCommand({ tag: "bug", note: "UI froze for 2s" });
  assert.equal(payload.type, "annotate");
  assert.equal(payload.tag, "bug");
  assert.equal(payload.note, "UI froze for 2s");
  assert.equal(payload.client_id, CLIENT_ID);
});

test("buildAnnotateCommand omits empty optional fields", () => {
  const payload = buildAnnotateCommand({ tag: "marker", note: "" });
  assert.equal("note" in payload, false);
  assert.equal(payload.client_id, CLIENT_ID);
});

test("buildAnnotateCommand allows overriding client_id", () => {
  const payload = buildAnnotateCommand({ tag: "marker", clientId: "smoke-test" });
  assert.equal(payload.client_id, "smoke-test");
});

test("buildAnnotateCommand rejects empty tag", () => {
  assert.throws(() => buildAnnotateCommand({ tag: "" }), /required/);
});

test("buildAnnotateCommand rejects oversize tag", () => {
  const tooLong = "x".repeat(ANNOTATION_LIMITS.MAX_TAG_LEN + 1);
  assert.throws(() => buildAnnotateCommand({ tag: tooLong }), /exceeds/);
});

test("buildAnnotateCommand rejects oversize note", () => {
  const tooLong = "x".repeat(ANNOTATION_LIMITS.MAX_NOTE_LEN + 1);
  assert.throws(() => buildAnnotateCommand({ tag: "bug", note: tooLong }), /exceeds/);
});

test("TAG_PRESETS uses unique hotkeys and unique tags", () => {
  const keys = TAG_PRESETS.map((p) => p.key);
  const tags = TAG_PRESETS.map((p) => p.tag);
  assert.equal(new Set(keys).size, keys.length, "hotkeys must be unique");
  assert.equal(new Set(tags).size, tags.length, "tags must be unique");
});

test("TAG_PRESETS covers the recommended vocabulary", () => {
  // The sidecar schema doc recommends ui-pause, walk-away, bug, unfair, marker.
  // If concert-mvp ever diverges from the vocabulary, the recording analyzer
  // gets harder to write — this test pins the contract.
  const tags = TAG_PRESETS.map((p) => p.tag);
  for (const expected of ["ui-pause", "walk-away", "bug", "unfair", "marker"]) {
    assert.ok(tags.includes(expected), `expected preset for tag "${expected}"`);
  }
});

test("presetForHotkey looks up by digit", () => {
  assert.equal(presetForHotkey("1")?.tag, "ui-pause");
  assert.equal(presetForHotkey("5")?.tag, "marker");
  assert.equal(presetForHotkey("9"), null);
  assert.equal(presetForHotkey(""), null);
});
