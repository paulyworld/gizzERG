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
