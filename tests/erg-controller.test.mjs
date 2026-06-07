import assert from "node:assert/strict";
import test from "node:test";
import { concertProfiles } from "../src/concert-profile.js";
import { ErgWorkoutController, formatTime, targetMaintained } from "../src/erg-controller.js";
import { estimatePlannedWorkout, summarizeCompliance, summarizeRideSamples } from "../src/workout-analysis.js";

const profile = {
  title: "test",
  duration_s: 120,
  cues: [
    { t: 0, label: "easy", bpm: 90, ftp_pct: 0.5, cadence_rpm: 80, ramp_s: 10 },
    { t: 30, label: "hard", bpm: 130, ftp_pct: 1.0, cadence_rpm: 100, ramp_s: 20 },
    { t: 90, label: "cool", bpm: 85, ftp_pct: 0.4, cadence_rpm: 75, ramp_s: 30 },
  ],
};

test("target lookup uses FTP and cue data", () => {
  const controller = new ErgWorkoutController(profile, { ftp: 250, weightKg: 75 });
  const target = controller.targetAt(10);

  assert.equal(target.watts, 125);
  assert.equal(target.cadenceRpm, 80);
  assert.equal(target.label, "easy");
  assert.equal(Math.round(target.wkg * 100), 167);
});

test("large changes ramp instead of jumping immediately", () => {
  const controller = new ErgWorkoutController(profile, { ftp: 250 });

  assert.equal(controller.targetAt(30).watts, 125);
  assert.equal(controller.targetAt(40).watts, 188);
  assert.equal(controller.targetAt(50).watts, 250);
});

test("raw feel can drive target power from selected derived intensity curve", () => {
  const controller = new ErgWorkoutController({
    ...profile,
    derived_intensity_curve: {
      model_version: "audio-test-v1",
      points: [
        { t: 0, intensity: 0.45 },
        { t: 30, intensity: 0.80 },
        { t: 60, intensity: 0.60 },
      ],
    },
  }, { ftp: 250, intensitySource: "derived" });

  const target = controller.targetAt(35);

  assert.equal(target.watts, 200);
  assert.equal(target.ftpPct, 0.8);
  assert.equal(target.cadenceRpm, 100);
  assert.equal(target.label, "hard");
  assert.equal(target.intensitySource, "derived");
});

test("raw feel can blend authored cue intensity and selected derived intensity curve", () => {
  const controller = new ErgWorkoutController({
    ...profile,
    derived_intensity_curve: {
      model_version: "audio-test-v1",
      points: [
        { t: 0, intensity: 0.40 },
        { t: 30, intensity: 0.80 },
      ],
    },
  }, { ftp: 250, intensitySource: "blended", intensityBlend: 0.5 });

  const target = controller.targetAt(35);

  assert.equal(target.watts, 172);
  assert.equal(Math.round(target.ftpPct * 1000), 689);
  assert.equal(target.intensitySource, "blended");
});

test("authored cue source preserves existing ramp behavior", () => {
  const controller = new ErgWorkoutController({
    ...profile,
    derived_intensity_curve: {
      model_version: "audio-test-v1",
      points: [
        { t: 0, intensity: 0.50 },
        { t: 30, intensity: 1.00 },
      ],
    },
  }, { ftp: 250, intensitySource: "cues" });

  assert.equal(controller.targetAt(40).watts, 188);
  assert.equal(controller.targetAt(40).intensitySource, "cues");
});

test("raw feel can use sampled terrain intensity for target power", () => {
  const controller = new ErgWorkoutController({
    ...profile,
    derived_intensity_curve: {
      model_version: "audio-test-v1",
      points: [
        { t: 0, intensity: 0.40 },
        { t: 30, intensity: 0.80 },
      ],
    },
  }, {
    ftp: 250,
    intensitySource: "derived",
    intensitySeries: [
      { t: 0, intensity: 0.50 },
      { t: 20, intensity: 0.60 },
      { t: 40, intensity: 0.70 },
    ],
  });

  assert.equal(controller.targetAt(35).watts, 150);
  assert.equal(controller.targetAt(35).ftpPct, 0.60);
  assert.equal(controller.targetAt(45).watts, 175);
});

test("targets clamp to configured maximum", () => {
  const controller = new ErgWorkoutController(profile, { ftp: 400, maxWatts: 300 });

  assert.equal(controller.targetAt(60).watts, 300);
});

test("paused playback does not send target writes", () => {
  const controller = new ErgWorkoutController(profile, { ftp: 250 });
  const decision = controller.shouldSendTarget(30, 1000, { playing: false, force: true });

  assert.equal(decision.send, false);
  assert.equal(decision.reason, "paused");
});

test("pause target drops immediately to easy spin intensity", () => {
  const controller = new ErgWorkoutController(profile, { ftp: 250, weightKg: 75 });
  const target = controller.pauseTarget(60);

  assert.equal(target.watts, 113);
  assert.equal(target.cadenceRpm, 75);
  assert.equal(target.label, "Paused / easy spin");
});

test("seeking causes an immediate send decision while playing", () => {
  const controller = new ErgWorkoutController(profile, { ftp: 250 });
  let decision = controller.shouldSendTarget(1, 1000, { playing: true });
  assert.equal(decision.send, true);
  controller.markSent(decision.target.watts, 1000);

  decision = controller.shouldSendTarget(95, 1500, { playing: true });
  assert.equal(decision.send, true);
  assert.equal(decision.reason, "seek");
});

test("formatTime uses m:ss", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(65.9), "1:05");
});

test("targetMaintained requires power and cadence near target", () => {
  const target = { watts: 200, cadenceRpm: 90 };

  assert.deepEqual(targetMaintained(191, 85, target), {
    powerOk: true,
    cadenceOk: true,
    maintained: true,
  });
  assert.deepEqual(targetMaintained(180, 90, target), {
    powerOk: false,
    cadenceOk: true,
    maintained: false,
  });
  assert.deepEqual(targetMaintained(200, 84, target), {
    powerOk: true,
    cadenceOk: false,
    maintained: false,
  });
});

test("concert profile has workout cues through the full Bandcamp tracklist", () => {
  const concert = concertProfiles[0];
  const controller = new ErgWorkoutController(concert, { ftp: 250 });
  const afterIronLung = controller.targetAt(5000);
  const nearFinale = controller.targetAt(8600);

  assert.ok(concert.cues.at(-1).t > 8600);
  assert.notEqual(afterIronLung.label, "Easy spin");
  assert.ok(afterIronLung.ftpPct >= 0.75);
  assert.ok(nearFinale.ftpPct >= 0.85);
});

test("concert profile accounts for video intro before Bandcamp tracklist", () => {
  const concert = concertProfiles[0];
  const controller = new ErgWorkoutController(concert, { ftp: 250 });
  const warmup = controller.targetAt(600);
  const gila = controller.targetAt(833);
  const motorSpirit = controller.targetAt(1119);
  const fastPeak = controller.targetAt(1995);

  assert.equal(concert.tracklist_intro_offset_s, 833);
  assert.equal(warmup.label, "Warmup endurance");
  assert.equal(gila.label, "Gila Monster");
  assert.equal(motorSpirit.label, "Motor Spirit");
  assert.equal(fastPeak.musicBpm, 206);
  assert.equal(fastPeak.cadenceRpm, 103);
});

test("concert profile duration includes intro plus Bandcamp track durations", () => {
  const concert = concertProfiles[0];
  const trackDuration = concert.tracks.reduce((sum, track) => sum + track.duration_s, 0);

  assert.equal(concert.duration_s, concert.tracklist_intro_offset_s + trackDuration);
});

test("structured workout mode uses sports warmup instead of raw feel", () => {
  const concert = concertProfiles[0];
  const controller = new ErgWorkoutController(concert, {
    ftp: 250,
    modeId: "aerobic_builder",
    warmupMinutes: 20,
  });
  const warmup = controller.targetAt(600);
  const postWarmup = controller.targetAt(1800);

  assert.equal(warmup.label, "Sports warmup");
  assert.equal(warmup.modeLabel, "Aerobic Builder");
  assert.ok(warmup.ftpPct > 0.45 && warmup.ftpPct < 0.70);
  assert.notEqual(postWarmup.label, "Mind Fuzz medley");
  assert.ok(postWarmup.ftpPct >= 0.58 && postWarmup.ftpPct <= 0.88);
});

test("planned workout analysis estimates TSS and IF", () => {
  const concert = concertProfiles[0];
  const controller = new ErgWorkoutController(concert, { ftp: 250 });
  const summary = estimatePlannedWorkout(concert, controller, 60);

  assert.ok(summary.tss > 100);
  assert.ok(summary.intensityFactor > 0.5);
  assert.ok(summary.weightedPower >= summary.avgPower);
});

test("actual ride analysis summarizes TSS and compliance", () => {
  const samples = [
    { time: 0, power: 190, cadence: 90, targetPower: 200, targetCadence: 90, maintained: true },
    { time: 1, power: 180, cadence: 84, targetPower: 200, targetCadence: 90, maintained: false },
    { time: 2, power: 210, cadence: 91, targetPower: 200, targetCadence: 90, maintained: true },
  ];
  const summary = summarizeRideSamples(samples, 250, 3);
  const compliance = summarizeCompliance(samples);

  assert.ok(summary.tss > 0);
  assert.equal(Math.round(compliance.maintainedPct * 100), 67);
  assert.equal(Math.round(compliance.powerMaintainedPct * 100), 67);
  assert.equal(Math.round(compliance.cadenceMaintainedPct * 100), 67);
});

// --- music-end break-gap detection -----------------------------------------

const breakGapProfile = {
  title: "break gap test",
  duration_s: 600,
  tracklist_intro_offset_s: 0,
  tracks: [
    { title: "Song A", duration_s: 200 },                            // 0-200, no gap (segue)
    { title: "Song B", duration_s: 200, music_end_offset_s: 180 },   // 200-400, music ends at 380
    { title: "Song C", duration_s: 200 },                            // 400-600, no gap
  ],
  cues: [
    { t: 0, label: "Song A", bpm: 120, ftp_pct: 0.80, cadence_rpm: 90, ramp_s: 5 },
    { t: 200, label: "Song B", bpm: 130, ftp_pct: 0.90, cadence_rpm: 95, ramp_s: 5 },
    { t: 400, label: "Song C", bpm: 110, ftp_pct: 0.70, cadence_rpm: 85, ramp_s: 5 },
  ],
};

test("targetAt holds normal target inside a song with no gap", () => {
  const controller = new ErgWorkoutController(breakGapProfile, { ftp: 250 });
  const target = controller.targetAt(100); // mid Song A — no music_end_offset_s
  assert.equal(target.inBreakGap, undefined);
  assert.equal(target.label, "Song A");
  assert.ok(target.watts > 150); // ~200W expected at 0.80 FTP
});

test("targetAt drops to pause floor and flags inBreakGap during a music-end gap", () => {
  const controller = new ErgWorkoutController(breakGapProfile, { ftp: 250 });
  const target = controller.targetAt(390); // inside Song B's break gap (380-400)
  assert.equal(target.inBreakGap, true);
  assert.ok(target.label.endsWith("→ break"));
  assert.equal(target.intensitySource, "break-gap");
  // pauseFtpPct defaults to 0.45; floor target should be lower than the
  // mid-song 0.90 target Song B would produce here.
  assert.ok(target.watts < 130);
  assert.deepEqual(target.breakGap, {
    from: 380,
    to: 400,
    trackTitle: "Song B",
  });
});

test("targetAt resumes normal target on the next song after a break gap", () => {
  const controller = new ErgWorkoutController(breakGapProfile, { ftp: 250 });
  const target = controller.targetAt(410); // start of Song C, after the gap
  assert.equal(target.inBreakGap, undefined);
  assert.equal(target.label, "Song C");
});

test("targetAt ignores tracks without music_end_offset_s (continuous segue)", () => {
  const controller = new ErgWorkoutController(breakGapProfile, { ftp: 250 });
  // Right at Song A's authored end, before Song B's ramp finishes. Should
  // still be a normal target — Song A has no music_end_offset_s.
  const target = controller.targetAt(199);
  assert.equal(target.inBreakGap, undefined);
});
