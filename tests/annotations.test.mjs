import assert from "node:assert/strict";
import test from "node:test";
import {
  ANNOTATION_LIMITS,
  CLIENT_ID,
  TAG_PRESETS,
  annotationRangeFromContext,
  buildAnnotateCommand,
  buildContextSnapshot,
  normalizeAnnotationRange,
  presetForHotkey,
} from "../src/annotations.js";

test("CLIENT_ID is gizzERG", () => {
  // Repo identity is gizzERG — annotations should report that, not the old
  // working-directory name.
  assert.equal(CLIENT_ID, "gizzERG");
});

test("buildAnnotateCommand minimal payload", () => {
  const payload = buildAnnotateCommand({ tag: "too-hard" });
  assert.deepEqual(payload, { type: "annotate", tag: "too-hard", client_id: CLIENT_ID });
});

test("buildAnnotateCommand includes note when provided", () => {
  const payload = buildAnnotateCommand({ tag: "bug", note: "UI froze for 2s" });
  assert.equal(payload.type, "annotate");
  assert.equal(payload.tag, "bug");
  assert.equal(payload.note, "UI froze for 2s");
  assert.equal(payload.client_id, CLIENT_ID);
});

test("buildAnnotateCommand includes client_time_s when provided", () => {
  const payload = buildAnnotateCommand({ tag: "marker", clientTimeS: 2412.5 });
  assert.equal(payload.client_time_s, 2412.5);
});

test("buildAnnotateCommand includes context when non-empty", () => {
  const ctx = { mode: "terrain_erg", grade: 5.5, target_watts: 228 };
  const payload = buildAnnotateCommand({ tag: "too-hard", context: ctx });
  assert.deepEqual(payload.context, ctx);
});

test("buildAnnotateCommand omits empty optional fields", () => {
  const payload = buildAnnotateCommand({ tag: "marker", note: "", context: {} });
  assert.equal("note" in payload, false);
  assert.equal("context" in payload, false);
  assert.equal("client_time_s" in payload, false);
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

test("buildAnnotateCommand rejects negative client_time_s", () => {
  assert.throws(
    () => buildAnnotateCommand({ tag: "marker", clientTimeS: -1 }),
    /non-negative/,
  );
});

test("buildAnnotateCommand rejects non-object context", () => {
  assert.throws(() => buildAnnotateCommand({ tag: "marker", context: "nope" }), /object/);
  assert.throws(() => buildAnnotateCommand({ tag: "marker", context: [1, 2] }), /object/);
});

test("TAG_PRESETS uses unique hotkeys and unique tags", () => {
  const keys = TAG_PRESETS.map((p) => p.key);
  const tags = TAG_PRESETS.map((p) => p.tag);
  assert.equal(new Set(keys).size, keys.length, "hotkeys must be unique");
  assert.equal(new Set(tags).size, tags.length, "tags must be unique");
});

test("TAG_PRESETS biases toward the tuning-feedback vocabulary", () => {
  // The model-training feedback loop (per engine concert-mode-exploration.md)
  // wants too-hard / too-easy / bad-sync as the most-reached annotations.
  // If these slip out of the preset slots, the rider's mid-ride flow gets
  // worse and the schema-doc vocabulary drifts from the actual UX.
  const tags = TAG_PRESETS.map((p) => p.tag);
  for (const expected of ["too-hard", "too-easy", "bad-sync", "bug", "marker"]) {
    assert.ok(tags.includes(expected), `expected preset for tag "${expected}"`);
  }
});

test("presetForHotkey looks up by digit", () => {
  assert.equal(presetForHotkey("1")?.tag, "too-hard");
  assert.equal(presetForHotkey("5")?.tag, "marker");
  assert.equal(presetForHotkey("9"), null);
  assert.equal(presetForHotkey(""), null);
});

test("normalizeAnnotationRange orders endpoints and records duration", () => {
  assert.deepEqual(normalizeAnnotationRange(240, 120), {
    start_s: 120,
    end_s: 240,
    duration_s: 120,
  });
});

test("normalizeAnnotationRange rejects tiny or malformed ranges", () => {
  assert.equal(normalizeAnnotationRange(120, 120.5), null);
  assert.equal(normalizeAnnotationRange(Number.NaN, 130), null);
  assert.equal(normalizeAnnotationRange(120, Number.POSITIVE_INFINITY), null);
});

test("annotationRangeFromContext reads echoed range metadata", () => {
  const context = {
    annotation_range_start_s: 1777,
    annotation_range_end_s: 1795,
    annotation_range_duration_s: 18,
  };
  assert.deepEqual(annotationRangeFromContext(context), {
    start_s: 1777,
    end_s: 1795,
    duration_s: 18,
  });
});

test("annotationRangeFromContext ignores missing range metadata", () => {
  assert.equal(annotationRangeFromContext({ mode: "raw-feel" }), null);
  assert.equal(annotationRangeFromContext(null), null);
});

test("buildContextSnapshot drops undefined and non-finite values", () => {
  const snap = buildContextSnapshot({
    mode: "terrain_erg",
    grade: 5.5,
    speed_kph: undefined,
    distance_m: null,
    wkg: NaN,
    target_watts: 228,
  });
  assert.deepEqual(snap, { mode: "terrain_erg", grade: 5.5, target_watts: 228 });
});

test("buildContextSnapshot returns null for empty snapshots", () => {
  assert.equal(buildContextSnapshot({}), null);
  assert.equal(buildContextSnapshot(null), null);
  assert.equal(buildContextSnapshot({ a: undefined, b: null }), null);
});
