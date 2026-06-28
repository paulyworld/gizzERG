// Annotation primitive: a rider hits F2 mid-ride, picks a tag (and optionally
// types a note), and the app sends a typed `annotate` command to the sidecar.
// The sidecar republishes it as a `rider_annotation` envelope on the bus, so
// it lands in the same JSONL recording alongside telemetry.
//
// Wire contract is owned by the sidecar (see repos/sidecar/docs/event-schema.md).
// This module owns the *client* side: tag presets, hotkeys, payload shape.

export const CLIENT_ID = "gizzERG";

// Tag presets and their hotkeys. Hotkey is the digit pressed while the overlay
// is open; tag is sent immediately with the current note text. The five preset slots bias
// toward the model-training feedback loop (per `concert-mode-exploration.md`
// in the engine repo) — that's the primary purpose of F2 annotations once
// terrain mode lands. Less-frequent tags (ui-pause, walk-away, false-intensity,
// missed-intensity, cadence-mismatch) are reachable via the typed tag field.
export const TAG_PRESETS = [
  { key: "1", tag: "too-hard", label: "Too hard", hint: "this section felt too hard" },
  { key: "2", tag: "too-easy", label: "Too easy", hint: "this section felt too easy" },
  { key: "3", tag: "bad-sync", label: "Bad sync", hint: "audio/video sync looks wrong" },
  { key: "4", tag: "bug", label: "Bug", hint: "something visibly broke" },
  { key: "5", tag: "marker", label: "Marker", hint: "generic timestamp" },
];

const MAX_TAG_LEN = 64;
const MAX_NOTE_LEN = 280;
const MAX_CLIENT_ID_LEN = 64;
const MIN_RANGE_DURATION_S = 1;

/**
 * Build the wire payload for an `annotate` command. Returns the object —
 * caller is responsible for JSON.stringify + WS send. Throws if the inputs
 * fail the sidecar's schema bounds; this catches mistakes at the call site
 * rather than discovering them as a silent WS-side rejection.
 *
 * - `clientTimeS` is the rider's video/workout position at the keypress.
 *   Distinct from the sidecar wall-clock `ts` — lets analyzers place the
 *   marker on the ride timeline rather than the receipt timeline.
 * - `context` is a free-form object snapshot of client state at the moment
 *   (profile, mode, telemetry, terrain stats). Sidecar treats opaque; the
 *   recommended shape lives in the sidecar event-schema doc.
 */
export function buildAnnotateCommand({
  tag,
  note = null,
  clientId = CLIENT_ID,
  clientTimeS = null,
  context = null,
} = {}) {
  if (typeof tag !== "string" || tag.length < 1) {
    throw new Error("annotation tag is required");
  }
  if (tag.length > MAX_TAG_LEN) {
    throw new Error(`annotation tag exceeds ${MAX_TAG_LEN} chars`);
  }
  if (note !== null && note !== undefined) {
    if (typeof note !== "string") {
      throw new Error("annotation note must be a string or null");
    }
    if (note.length > MAX_NOTE_LEN) {
      throw new Error(`annotation note exceeds ${MAX_NOTE_LEN} chars`);
    }
  }
  if (clientId !== null && clientId !== undefined) {
    if (typeof clientId !== "string") {
      throw new Error("client_id must be a string or null");
    }
    if (clientId.length > MAX_CLIENT_ID_LEN) {
      throw new Error(`client_id exceeds ${MAX_CLIENT_ID_LEN} chars`);
    }
  }
  if (clientTimeS !== null && clientTimeS !== undefined) {
    if (typeof clientTimeS !== "number" || !Number.isFinite(clientTimeS) || clientTimeS < 0) {
      throw new Error("client_time_s must be a non-negative finite number");
    }
  }
  if (context !== null && context !== undefined) {
    if (typeof context !== "object" || Array.isArray(context)) {
      throw new Error("context must be an object");
    }
  }
  const payload = { type: "annotate", tag };
  if (note !== null && note !== undefined && note !== "") {
    payload.note = note;
  }
  if (clientId !== null && clientId !== undefined && clientId !== "") {
    payload.client_id = clientId;
  }
  if (clientTimeS !== null && clientTimeS !== undefined) {
    payload.client_time_s = clientTimeS;
  }
  if (context !== null && context !== undefined && Object.keys(context).length > 0) {
    payload.context = context;
  }
  return payload;
}

/** Look up a preset by its hotkey. Returns null if the key isn't bound. */
export function presetForHotkey(key) {
  return TAG_PRESETS.find((p) => p.key === key) ?? null;
}

/** Normalize a range annotation span. Returns null when the span is not useful. */
export function normalizeAnnotationRange(startS, endS) {
  if (!Number.isFinite(startS) || !Number.isFinite(endS)) {
    return null;
  }
  const start = Math.max(0, Math.min(startS, endS));
  const end = Math.max(0, Math.max(startS, endS));
  if (end - start < MIN_RANGE_DURATION_S) {
    return null;
  }
  return {
    start_s: start,
    end_s: end,
    duration_s: end - start,
  };
}

/** Pull range metadata back out of an echoed rider_annotation context blob. */
export function annotationRangeFromContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return null;
  }
  return normalizeAnnotationRange(
    Number(context.annotation_range_start_s),
    Number(context.annotation_range_end_s),
  );
}

/**
 * Build a recommended context blob from the current ride snapshot. Mirrors
 * the recommended shape in the sidecar event-schema doc. Fields are
 * included only when defined — analyzers shouldn't see explicit nulls for
 * data the client didn't have at the moment.
 *
 * Caller assembles the snapshot dict from whatever ride state is at hand;
 * this helper just drops undefined fields and returns a clean object.
 */
export function buildContextSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }
  const out = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export const ANNOTATION_LIMITS = Object.freeze({
  MAX_TAG_LEN,
  MAX_NOTE_LEN,
  MAX_CLIENT_ID_LEN,
  MIN_RANGE_DURATION_S,
});
