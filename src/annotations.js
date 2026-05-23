// Annotation primitive: a rider hits F2 mid-ride, picks a tag (and optionally
// types a note), and the app sends a typed `annotate` command to the sidecar.
// The sidecar republishes it as a `rider_annotation` envelope on the bus, so
// it lands in the same JSONL recording alongside telemetry.
//
// Wire contract is owned by the sidecar (see repos/sidecar/docs/event-schema.md).
// This module owns the *client* side: tag presets, hotkeys, payload shape.

export const CLIENT_ID = "concert-mvp";

// Tag presets and their hotkeys. Hotkey is the digit pressed while the overlay
// is open; tag is sent immediately with no note. The order matters — the
// first five are the always-visible buttons. Vocabulary is the recommended
// set from the sidecar schema doc; concert-mvp emphasises ui-pause and
// walk-away because the 2026-05-22 ride debugging turned on exactly that
// distinction.
export const TAG_PRESETS = [
  { key: "1", tag: "ui-pause", label: "UI pause", hint: "concert pause / between-rounds" },
  { key: "2", tag: "walk-away", label: "Walk-away", hint: "I stopped pedalling on purpose" },
  { key: "3", tag: "bug", label: "Bug", hint: "something visibly broke" },
  { key: "4", tag: "unfair", label: "Unfair", hint: "section felt too hard/easy" },
  { key: "5", tag: "marker", label: "Marker", hint: "generic timestamp" },
];

const MAX_TAG_LEN = 64;
const MAX_NOTE_LEN = 280;
const MAX_CLIENT_ID_LEN = 64;

/**
 * Build the wire payload for an `annotate` command. Returns the object —
 * caller is responsible for JSON.stringify + WS send. Throws if the inputs
 * fail the sidecar's schema bounds; this catches mistakes at the call site
 * rather than discovering them as a silent WS-side rejection.
 */
export function buildAnnotateCommand({ tag, note = null, clientId = CLIENT_ID } = {}) {
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
  const payload = { type: "annotate", tag };
  if (note !== null && note !== undefined && note !== "") {
    payload.note = note;
  }
  if (clientId !== null && clientId !== undefined && clientId !== "") {
    payload.client_id = clientId;
  }
  return payload;
}

/** Look up a preset by its hotkey. Returns null if the key isn't bound. */
export function presetForHotkey(key) {
  return TAG_PRESETS.find((p) => p.key === key) ?? null;
}

export const ANNOTATION_LIMITS = Object.freeze({
  MAX_TAG_LEN,
  MAX_NOTE_LEN,
  MAX_CLIENT_ID_LEN,
});
