import test from "node:test";
import assert from "node:assert/strict";

import { concertProfiles } from "../src/concert-profile.js";

test("concert profile exposes selectable video and curve options", () => {
  assert.equal(concertProfiles.length, 1);
  const profile = concertProfiles[0];

  assert.equal(profile.video_id, "bnnIdWzGSYI");
  assert.equal(profile.youtube_url, "https://www.youtube.com/watch?v=bnnIdWzGSYI");
  assert.ok(Array.isArray(profile.available_intensity_curves));
  assert.deepEqual(
    profile.available_intensity_curves.map((curve) => curve.id),
    ["manual-seed", "manual-seed-v0.2", "audio-v0.3", "audio-v0.4-subjective"],
  );
  assert.equal(profile.derived_intensity_curve.model_version, "manual-seed-v0.1");
});
