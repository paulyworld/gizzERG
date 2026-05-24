import {
  CLIENT_ID,
  TAG_PRESETS,
  buildAnnotateCommand,
  buildContextSnapshot,
  presetForHotkey,
} from "./annotations.js";
import { concertProfiles } from "./concert-profile.js";
import { ErgWorkoutController, formatTime, targetMaintained } from "./erg-controller.js";
import {
  estimateSpeedMps,
  routePointAt,
  sampleTerrainRoute,
} from "./terrain-model.js";
import { estimatePlannedWorkout, summarizeCompliance, summarizeRideSamples } from "./workout-analysis.js";
import { workoutModes } from "./workout-patterns.js";

const profile = concertProfiles[0];
const controller = new ErgWorkoutController(profile);
const TERRAIN_TUNING_HELP = {
  terrainSourceSelect: "Derived intensity uses profile.derived_intensity_curve when present; authored cues uses the manual FTP cue map.",
  terrainSampleStep: "Default 5s. Lower values sample the route more often, which will matter once audio-derived curves mark fast musical changes.",
  terrainGradeScale: "Default 18. Higher values turn the same intensity change into steeper climbs and deeper descents.",
  terrainBaseline: "Default 0.55. Intensities above this become climbs; intensities below this become descents or flats.",
  terrainMinGrade: "Default -2%. Caps downhill slope so quiet sections recover without becoming unrealistic descents.",
  terrainMaxGrade: "Default 12%. Caps the hardest climb generated from intense song sections.",
  terrainSmoothing: "Default 20s. Higher values delay and soften grade changes so crescendos do not instantly become cliffs.",
  terrainBikeMass: "Default 9 kg. Heavier bikes reduce modeled speed for the same power, especially uphill.",
  terrainRollingResistance: "Default 0.005. Higher values slow the route across all grades, like rougher tires or surface.",
  terrainDragArea: "Default 0.63. Higher values increase aero drag and reduce modeled speed most on fast/flat sections.",
};
const DEFAULT_TERRAIN_TUNING = Object.freeze({
  terrainSourceSelect: "derived",
  terrainSampleStep: 5,
  terrainGradeScale: 18,
  terrainBaseline: 0.55,
  terrainMinGrade: -2,
  terrainMaxGrade: 12,
  terrainSmoothing: 20,
  terrainBikeMass: 9,
  terrainRollingResistance: 0.005,
  terrainDragArea: 0.63,
});

const els = {
  profileTitle: document.querySelector("#profileTitle"),
  playButton: document.querySelector("#playButton"),
  pauseButton: document.querySelector("#pauseButton"),
  seekSlider: document.querySelector("#seekSlider"),
  timeOutput: document.querySelector("#timeOutput"),
  rideChart: document.querySelector("#rideChart"),
  rideChartTooltip: document.querySelector("#rideChartTooltip"),
  timelineSeekToggle: document.querySelector("#timelineSeekToggle"),
  songDivisionsToggle: document.querySelector("#songDivisionsToggle"),
  songStrip: document.querySelector("#songStrip"),
  ftpInput: document.querySelector("#ftpInput"),
  workoutModeSelect: document.querySelector("#workoutModeSelect"),
  weightInput: document.querySelector("#weightInput"),
  warmupDurationInput: document.querySelector("#warmupDurationInput"),
  maxTargetInput: document.querySelector("#maxTargetInput"),
  sidecarUrlInput: document.querySelector("#sidecarUrlInput"),
  trackOffsetInput: document.querySelector("#trackOffsetInput"),
  terrainSourceSelect: document.querySelector("#terrainSourceSelect"),
  terrainSampleStep: document.querySelector("#terrainSampleStep"),
  terrainSampleStepOut: document.querySelector("#terrainSampleStepOut"),
  terrainGradeScale: document.querySelector("#terrainGradeScale"),
  terrainGradeScaleOut: document.querySelector("#terrainGradeScaleOut"),
  terrainBaseline: document.querySelector("#terrainBaseline"),
  terrainBaselineOut: document.querySelector("#terrainBaselineOut"),
  terrainMinGrade: document.querySelector("#terrainMinGrade"),
  terrainMinGradeOut: document.querySelector("#terrainMinGradeOut"),
  terrainMaxGrade: document.querySelector("#terrainMaxGrade"),
  terrainMaxGradeOut: document.querySelector("#terrainMaxGradeOut"),
  terrainSmoothing: document.querySelector("#terrainSmoothing"),
  terrainSmoothingOut: document.querySelector("#terrainSmoothingOut"),
  terrainBikeMass: document.querySelector("#terrainBikeMass"),
  terrainBikeMassOut: document.querySelector("#terrainBikeMassOut"),
  terrainRollingResistance: document.querySelector("#terrainRollingResistance"),
  terrainRollingResistanceOut: document.querySelector("#terrainRollingResistanceOut"),
  terrainDragArea: document.querySelector("#terrainDragArea"),
  terrainDragAreaOut: document.querySelector("#terrainDragAreaOut"),
  resetTerrainTuning: document.querySelector("#resetTerrainTuning"),
  terrainHelpText: document.querySelector("#terrainHelpText"),
  terrainSummary: document.querySelector("#terrainSummary"),
  terrainLiveText: document.querySelector("#terrainLiveText"),
  connectButton: document.querySelector("#connectButton"),
  connectionStatus: document.querySelector("#connectionStatus"),
  powerMetric: document.querySelector("#powerMetric"),
  cadenceMetric: document.querySelector("#cadenceMetric"),
  targetPct: document.querySelector("#targetPct"),
  liveHr: document.querySelector("#liveHr"),
  tssEstimate: document.querySelector("#tssEstimate"),
  ifEstimate: document.querySelector("#ifEstimate"),
  sectionLabel: document.querySelector("#sectionLabel"),
  guidanceText: document.querySelector("#guidanceText"),
  trackLabel: document.querySelector("#trackLabel"),
  trackSourceText: document.querySelector("#trackSourceText"),
  analysisTitle: document.querySelector("#analysisTitle"),
  analysisText: document.querySelector("#analysisText"),
  timeline: document.querySelector("#timeline"),
  eventLog: document.querySelector("#eventLog"),
  annotationOverlay: document.querySelector("#annotationOverlay"),
  annotationPresets: document.querySelector("#annotationPresets"),
  annotationTagInput: document.querySelector("#annotationTagInput"),
  annotationNoteInput: document.querySelector("#annotationNoteInput"),
  annotationError: document.querySelector("#annotationError"),
  annotationSubmit: document.querySelector("#annotationSubmit"),
  annotationCancel: document.querySelector("#annotationCancel"),
};

let player = null;
let sidecar = null;
let playing = false;
let latestVideoTime = 0;
let videoDuration = profile.duration_s;
let seeking = false;
let supportsTargetPower = false;
let controlAcquired = false;
let targetPowerAck = "no target ack yet";
let currentPower = 0;
let currentCadence = 0;
let currentHr = 0;
let lastChartSampleSecond = -1;
let hoverChartTime = null;
let currentSongKey = "";
const rideSamples = [];
// Rider-pressed-F2 annotations as they come back from the sidecar as
// `rider_annotation` envelopes. Held here so the ride chart can mark them
// and so the post-ride analysis can correlate them with the telemetry stream.
const annotations = [];
let annotationFocusRestore = null;
let terrainRoute = buildTerrainRoute();

els.profileTitle.textContent = profile.title;
els.seekSlider.max = String(profile.duration_s);
els.trackOffsetInput.value = formatDurationInput(profile.tracklist_intro_offset_s ?? 0);
els.warmupDurationInput.value = formatDurationInput(profile.tracklist_intro_offset_s ?? 15 * 60);
els.trackSourceText.textContent = `${profile.tracklist_source?.name ?? "Tracklist"} song bands. Adjust offset if the video has an intro.`;
for (const mode of workoutModes) {
  const option = document.createElement("option");
  option.value = mode.id;
  option.textContent = mode.label;
  option.title = mode.description;
  els.workoutModeSelect.append(option);
}
renderTimeline();
renderSongStrip();
renderTarget(controller.targetAt(0));
renderTerrainTuning();
renderTerrainSummary();
updateAnalysis();
drawRideChart();
window.addEventListener("resize", drawRideChart);
els.rideChart.addEventListener("mousemove", onRideChartMouseMove);
els.rideChart.addEventListener("mouseleave", onRideChartMouseLeave);
els.rideChart.addEventListener("click", onRideChartClick);
els.timelineSeekToggle.addEventListener("change", () => {
  els.rideChart.parentElement.classList.toggle("timeline-seek-enabled", els.timelineSeekToggle.checked);
});
els.songDivisionsToggle.addEventListener("change", drawRideChart);
loadYouTubeApi()
  .then(createPlayer)
  .catch((error) => {
    log(`YouTube player failed to load: ${error.message}`);
    document.querySelector("#player").textContent = "YouTube player failed to load.";
  });

els.playButton.addEventListener("click", () => player?.playVideo());
els.pauseButton.addEventListener("click", () => player?.pauseVideo());
els.seekSlider.addEventListener("input", () => {
  seeking = true;
  latestVideoTime = Number(els.seekSlider.value);
  renderTarget(controller.targetAt(latestVideoTime));
  updateClock();
});
els.seekSlider.addEventListener("change", () => {
  const time = Number(els.seekSlider.value);
  player?.seekTo(time, true);
  latestVideoTime = time;
  seeking = false;
  controller.resetWrites();
  tick(true);
});
els.connectButton.addEventListener("click", connectSidecar);

for (const input of [els.ftpInput, els.weightInput, els.maxTargetInput]) {
  input.addEventListener("input", () => {
    controller.setRider({
      ftp: els.ftpInput.value,
      weightKg: els.weightInput.value,
      maxWatts: els.maxTargetInput.value,
    });
    controller.resetWrites();
    clearRideSamples();
    tick(true);
  });
}
for (const input of [els.workoutModeSelect, els.warmupDurationInput]) {
  input.addEventListener("input", () => {
    controller.setMode({
      modeId: els.workoutModeSelect.value,
      warmupMinutes: parseDurationInput(els.warmupDurationInput.value, 15 * 60) / 60,
    });
    controller.resetWrites();
    clearRideSamples();
    drawRideChart();
    updateAnalysis();
    renderTarget(controller.targetAt(latestVideoTime));
    tick(true);
  });
}
els.trackOffsetInput.addEventListener("input", () => {
  renderSongStrip();
  drawRideChart();
  updateAnalysis();
  renderTarget(controller.targetAt(latestVideoTime));
});
for (const input of terrainInputs()) {
  input.addEventListener("input", () => {
    terrainRoute = buildTerrainRoute();
    renderTerrainTuning();
    renderTerrainSummary();
    drawRideChart();
    updateAnalysis();
  });
}
els.resetTerrainTuning.addEventListener("click", resetTerrainTuning);
setupTerrainHelp();

setInterval(() => tick(false), 500);

populateAnnotationPresets();
els.annotationOverlay.addEventListener("keydown", onAnnotationOverlayKeyDown);
els.annotationCancel.addEventListener("click", closeAnnotationOverlay);
els.annotationSubmit.addEventListener("click", () => submitFromOverlayInputs());
document.addEventListener("keydown", onGlobalKeyDown);

function loadYouTubeApi() {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-youtube-iframe-api]");
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.dataset.youtubeIframeApi = "true";
      script.onerror = () => reject(new Error("iframe API script error"));
      document.head.append(script);
    }
    window.setTimeout(() => {
      if (!window.YT?.Player) {
        reject(new Error("iframe API timed out"));
      }
    }, 10000);
  });
}

function createPlayer(YTApi) {
  player = new YTApi.Player("player", {
    videoId: profile.video_id,
    playerVars: {
      modestbranding: 1,
      rel: 0,
      playsinline: 1,
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError,
    },
  });
}

function onPlayerReady() {
  const duration = Math.floor(player.getDuration() || profile.duration_s);
  videoDuration = duration > 0 ? duration : profile.duration_s;
  els.seekSlider.max = String(videoDuration);
  updateClock();
  log("YouTube player ready");
}

function onPlayerError(event) {
  log(`YouTube player error ${event.data}`);
}

function onPlayerStateChange(event) {
  const wasPlaying = playing;
  playing = event.data === YT.PlayerState.PLAYING;
  if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
    playing = false;
  }
  if (wasPlaying && !playing) {
    applySoftPauseTarget();
  }
  tick(true);
}

function connectSidecar() {
  if (sidecar && sidecar.readyState === WebSocket.OPEN) {
    sidecar.close();
    return;
  }
  const url = els.sidecarUrlInput.value.trim() || "ws://localhost:8421";
  sidecar = new WebSocket(url);
  setStatus("connecting", "warn");
  sidecar.addEventListener("open", () => {
    setConnectionStatus();
    els.connectButton.textContent = "Disconnect";
    log(`Connected to ${url}`);
    tick(true);
  });
  sidecar.addEventListener("close", () => {
    supportsTargetPower = false;
    controlAcquired = false;
    targetPowerAck = "no target ack yet";
    setConnectionStatus();
    els.connectButton.textContent = "Connect Sidecar";
    log("Sidecar disconnected");
  });
  sidecar.addEventListener("error", () => {
    setStatus("connection error", "bad");
  });
  sidecar.addEventListener("message", (event) => handleSidecarEvent(event.data));
}

function handleSidecarEvent(text) {
  let event;
  try {
    event = JSON.parse(text);
  } catch {
    return;
  }
  if (event.type === "power") {
    currentPower = Math.round(event.data.watts);
    renderPowerCadenceMetric(controller.targetAt(latestVideoTime));
    renderTerrainSummary();
  } else if (event.type === "cadence") {
    currentCadence = Math.round(event.data.rpm);
    renderPowerCadenceMetric(controller.targetAt(latestVideoTime));
  } else if (event.type === "heart_rate") {
    currentHr = Math.round(event.data.bpm);
    els.liveHr.textContent = `${currentHr} bpm`;
  } else if (event.type === "control_acquired") {
    controlAcquired = true;
    setConnectionStatus();
    log("Trainer control acquired");
    if (!playing) {
      applySoftPauseTarget();
    } else {
      tick(true);
    }
  } else if (event.type === "control_released") {
    controlAcquired = false;
    setConnectionStatus();
    log(`Trainer control released: ${event.data.reason || "unknown"}`);
  } else if (event.type === "device_capabilities") {
    supportsTargetPower = Boolean(event.data?.target_power);
    setConnectionStatus();
    log(supportsTargetPower ? "Target-power capable trainer detected" : "Trainer does not advertise target power");
  } else if (event.type === "target_power_set") {
    const status = event.data.accepted
      ? "accepted"
      : event.data.reason === "bailout-pending"
        ? "queued by cadence bailout"
        : `rejected: ${event.data.reason}`;
    targetPowerAck = `ERG ${status} ${event.data.watts} W`;
    setConnectionStatus();
    log(`ERG ${status} ${event.data.watts} W`);
  } else if (event.type === "cadence_bailout_engaged") {
    log("Cadence bailout engaged");
  } else if (event.type === "cadence_bailout_disengaged") {
    log("Cadence bailout disengaged");
  } else if (event.type === "rider_annotation") {
    // Sidecar echoes back the annotate command as a rider_annotation envelope
    // with its own ts/seq. Pin the *ride-time* (video position) at receipt so
    // chart markers land where the rider actually was, not where the WS RTT
    // says the message arrived.
    const ann = {
      ts: event.ts,
      seq: event.seq,
      videoTime: latestVideoTime,
      tag: event.data?.tag ?? "",
      note: event.data?.note ?? "",
      clientId: event.data?.client_id ?? "",
    };
    annotations.push(ann);
    const noteSuffix = ann.note ? ` — "${ann.note}"` : "";
    log(`Annotation: ${ann.tag}${noteSuffix} at ${formatTime(ann.videoTime)}`);
    drawRideChart();
  }
}

function tick(force) {
  if (player && !seeking && typeof player.getCurrentTime === "function") {
    latestVideoTime = Number(player.getCurrentTime() || 0);
    els.seekSlider.value = String(Math.floor(latestVideoTime));
  }

  const decision = controller.shouldSendTarget(latestVideoTime, performance.now(), { playing, force });
  renderTarget(decision.target);
  updateClock();
  sampleRideChart(decision.target);
  drawRideChart();
  updateAnalysis();

  if (decision.send && sidecar?.readyState === WebSocket.OPEN) {
    sendTargetPower(decision.target.watts, performance.now());
  }
}

function sampleRideChart(target) {
  if (!playing) {
    return;
  }
  const second = Math.floor(latestVideoTime);
  if (second === lastChartSampleSecond) {
    return;
  }
  lastChartSampleSecond = second;
  const status = targetMaintained(currentPower, currentCadence, target);
  rideSamples.push({
    time: latestVideoTime,
    power: currentPower,
    cadence: currentCadence,
    targetPower: target.watts,
    targetCadence: target.cadenceRpm,
    maintained: status.maintained,
  });
  while (rideSamples.length > 7200) {
    rideSamples.shift();
  }
}

function clearRideSamples() {
  rideSamples.length = 0;
  lastChartSampleSecond = -1;
  drawRideChart();
  updateAnalysis();
}

function applySoftPauseTarget() {
  const target = controller.pauseTarget(latestVideoTime);
  renderTarget(target);
  if (sendTargetPower(target.watts, performance.now(), { allowWhilePaused: true })) {
    log(`Video paused; sent soft-pause target ${target.watts} W`);
  }
}

function sendTargetPower(watts, nowMs, { allowWhilePaused = false } = {}) {
  if (!allowWhilePaused && !playing) {
    return false;
  }
  if (sidecar?.readyState !== WebSocket.OPEN) {
    return false;
  }
  if (!supportsTargetPower || !controlAcquired) {
    setConnectionStatus();
    return false;
  }
  sidecar.send(JSON.stringify({ type: "set_target_power", watts }));
  controller.markSent(watts, nowMs);
  return true;
}

function renderTarget(target) {
  renderPowerCadenceMetric(target);
  els.targetPct.textContent = `${Math.round(target.ftpPct * 100)}%`;
  els.sectionLabel.textContent = target.label;
  els.guidanceText.textContent = `${target.modeLabel}: ${target.musicBpm} music BPM, ride ${target.cadenceRpm} rpm, ${target.wkg.toFixed(2)} W/kg target.`;
  renderTerrainSummary();
  const track = trackAt(latestVideoTime);
  els.trackLabel.textContent = track
    ? `${track.index + 1}. ${track.title}`
    : "No aligned song";
  const songKey = track ? `${track.index}:${track.start_s}` : "";
  if (songKey !== currentSongKey) {
    currentSongKey = songKey;
    renderSongStrip();
  }
  for (const cueEl of els.timeline.querySelectorAll(".cue")) {
    cueEl.classList.toggle("active", Number(cueEl.dataset.t) === target.cue.t);
  }
}

function renderPowerCadenceMetric(target) {
  els.powerMetric.textContent = `${currentPower || 0} / ${target.watts} W`;
  els.cadenceMetric.textContent = `${currentCadence || 0} / ${target.cadenceRpm} rpm`;
}

function buildTerrainRoute() {
  return sampleTerrainRoute(profile, terrainOptions());
}

function terrainOptions() {
  return {
    ftp: Number(els.ftpInput?.value) || controller.ftp,
    riderWeightKg: Number(els.weightInput?.value) || controller.weightKg,
    sampleStepS: Number(els.terrainSampleStep?.value) || DEFAULT_TERRAIN_TUNING.terrainSampleStep,
    intensitySource: els.terrainSourceSelect?.value === "cues" ? "cues" : "derived",
    gradeScale: Number(els.terrainGradeScale?.value) || DEFAULT_TERRAIN_TUNING.terrainGradeScale,
    baselineIntensity: Number(els.terrainBaseline?.value) || DEFAULT_TERRAIN_TUNING.terrainBaseline,
    minGrade: Number(els.terrainMinGrade?.value) || DEFAULT_TERRAIN_TUNING.terrainMinGrade,
    maxGrade: Number(els.terrainMaxGrade?.value) || DEFAULT_TERRAIN_TUNING.terrainMaxGrade,
    smoothingWindowS: Number(els.terrainSmoothing?.value) || DEFAULT_TERRAIN_TUNING.terrainSmoothing,
    bikeWeightKg: Number(els.terrainBikeMass?.value) || DEFAULT_TERRAIN_TUNING.terrainBikeMass,
    rollingResistance: Number(els.terrainRollingResistance?.value) || DEFAULT_TERRAIN_TUNING.terrainRollingResistance,
    dragArea: Number(els.terrainDragArea?.value) || DEFAULT_TERRAIN_TUNING.terrainDragArea,
  };
}

function defaultTerrainOptions() {
  return {
    ftp: Number(els.ftpInput?.value) || controller.ftp,
    riderWeightKg: Number(els.weightInput?.value) || controller.weightKg,
    sampleStepS: DEFAULT_TERRAIN_TUNING.terrainSampleStep,
    intensitySource: DEFAULT_TERRAIN_TUNING.terrainSourceSelect,
    gradeScale: DEFAULT_TERRAIN_TUNING.terrainGradeScale,
    baselineIntensity: DEFAULT_TERRAIN_TUNING.terrainBaseline,
    minGrade: DEFAULT_TERRAIN_TUNING.terrainMinGrade,
    maxGrade: DEFAULT_TERRAIN_TUNING.terrainMaxGrade,
    smoothingWindowS: DEFAULT_TERRAIN_TUNING.terrainSmoothing,
    bikeWeightKg: DEFAULT_TERRAIN_TUNING.terrainBikeMass,
    rollingResistance: DEFAULT_TERRAIN_TUNING.terrainRollingResistance,
    dragArea: DEFAULT_TERRAIN_TUNING.terrainDragArea,
  };
}

function terrainInputs() {
  return [
    els.terrainSourceSelect,
    els.terrainSampleStep,
    els.terrainGradeScale,
    els.terrainBaseline,
    els.terrainMinGrade,
    els.terrainMaxGrade,
    els.terrainSmoothing,
    els.terrainBikeMass,
    els.terrainRollingResistance,
    els.terrainDragArea,
  ].filter(Boolean);
}

function setupTerrainHelp() {
  for (const input of terrainInputs()) {
    const help = TERRAIN_TUNING_HELP[input.id];
    if (!help) {
      continue;
    }
    const label = input.closest("label");
    const title = label?.querySelector("span");
    input.title = help;
    if (title) {
      title.title = help;
      title.tabIndex = 0;
      title.setAttribute("role", "button");
      title.addEventListener("mouseenter", () => showTerrainHelp(input.id));
      title.addEventListener("focus", () => showTerrainHelp(input.id));
      title.addEventListener("click", () => showTerrainHelp(input.id));
    }
    input.addEventListener("mouseenter", () => showTerrainHelp(input.id));
    input.addEventListener("focus", () => showTerrainHelp(input.id));
    input.addEventListener("click", () => showTerrainHelp(input.id));
  }
  showTerrainHelp("terrainGradeScale");
}

function showTerrainHelp(inputId) {
  if (!els.terrainHelpText) {
    return;
  }
  els.terrainHelpText.textContent = TERRAIN_TUNING_HELP[inputId]
    ?? "Adjust route generation and modeled speed defaults for terrain experiments.";
}

function resetTerrainTuning() {
  for (const [id, value] of Object.entries(DEFAULT_TERRAIN_TUNING)) {
    const input = els[id];
    if (input) {
      input.value = String(value);
    }
  }
  terrainRoute = buildTerrainRoute();
  renderTerrainTuning();
  renderTerrainSummary();
  drawRideChart();
  updateAnalysis();
  showTerrainHelp("terrainGradeScale");
}

function renderTerrainTuning() {
  els.terrainSampleStepOut.textContent = `${Math.round(Number(els.terrainSampleStep.value))}s`;
  els.terrainGradeScaleOut.textContent = Number(els.terrainGradeScale.value).toFixed(1);
  els.terrainBaselineOut.textContent = Number(els.terrainBaseline.value).toFixed(2);
  els.terrainMinGradeOut.textContent = `${Number(els.terrainMinGrade.value).toFixed(1)}%`;
  els.terrainMaxGradeOut.textContent = `${Number(els.terrainMaxGrade.value).toFixed(1)}%`;
  els.terrainSmoothingOut.textContent = `${Math.round(Number(els.terrainSmoothing.value))}s`;
  els.terrainBikeMassOut.textContent = `${Number(els.terrainBikeMass.value).toFixed(1)}kg`;
  els.terrainRollingResistanceOut.textContent = Number(els.terrainRollingResistance.value).toFixed(3);
  els.terrainDragAreaOut.textContent = Number(els.terrainDragArea.value).toFixed(2);
}

function renderTerrainSummary() {
  if (!terrainRoute?.samples?.length) {
    return;
  }
  const currentDistanceM = terrainDistanceAtVideoTime(latestVideoTime);
  const point = routePointAt(terrainRoute, currentDistanceM);
  const speed = terrainSpeedAtVideoTime(latestVideoTime, point);
  els.terrainSummary.textContent = [
    `${formatDistance(currentDistanceM)} / ${formatDistance(terrainRoute.distanceM)}`,
    `+${Math.round(point.elevationGainM ?? 0)} / +${Math.round(terrainRoute.elevationGainM)} m`,
  ].join(" | ");
  els.terrainLiveText.textContent = [
    `${terrainSourceLabel()} @ ${terrainRoute.sampleStepS}s`,
    `Grade ${point.gradePercent.toFixed(1)}%`,
    `elev ${Math.round(point.elevationM)} m`,
    `${speed.source} ${speed.kph.toFixed(1)} kph`,
  ].join(", ");
}

function terrainSourceLabel() {
  return els.terrainSourceSelect?.value === "cues" ? "authored cues" : "derived intensity";
}

function terrainDistanceAtVideoTime(timeS) {
  if (!terrainRoute?.samples?.length) {
    return 0;
  }
  const sample = terrainRoute.samples.reduce((nearest, next) => (
    Math.abs(next.timeS - timeS) < Math.abs(nearest.timeS - timeS) ? next : nearest
  ));
  return sample.distanceM;
}

function terrainSpeedAtVideoTime(timeS, point = null) {
  if (!terrainRoute?.samples?.length) {
    return { kph: 0, source: "modeled speed" };
  }
  if (currentPower > 0) {
    const routePoint = point ?? routePointAt(terrainRoute, terrainDistanceAtVideoTime(timeS));
    return {
      kph: estimateSpeedMps(currentPower, routePoint?.gradePercent ?? 0, terrainOptions()) * 3.6,
      source: "live-power speed",
    };
  }
  const sample = nearestTerrainSample(timeS);
  return { kph: sample.speedMps * 3.6, source: "modeled speed" };
}

function nearestTerrainSample(timeS) {
  return terrainRoute.samples.reduce((nearest, next) => (
    Math.abs(next.timeS - timeS) < Math.abs(nearest.timeS - timeS) ? next : nearest
  ));
}

function derivedIntensityPoints() {
  const points = profile.derived_intensity_curve?.points;
  if (!Array.isArray(points)) {
    return [];
  }
  return points
    .map((point) => ({
      ...point,
      t: Number(point.t),
      intensity: Number(point.intensity),
    }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.intensity))
    .sort((a, b) => a.t - b.t);
}

function derivedIntensityAt(timeS) {
  const points = derivedIntensityPoints();
  if (points.length === 0) {
    return null;
  }
  let current = points[0];
  for (const point of points) {
    if (point.t > timeS) {
      break;
    }
    current = point;
  }
  return current;
}

function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

function updateAnalysis() {
  const planned = estimatePlannedWorkout(profile, controller);
  const terrainPlanned = estimateTerrainAdjustedWorkout();
  const actual = summarizeRideSamples(rideSamples, controller.ftp, rideSamples.length);
  const compliance = summarizeCompliance(rideSamples);
  const active = rideSamples.length > 0 ? actual : terrainPlanned;

  els.tssEstimate.textContent = String(Math.round(active.tss));
  els.ifEstimate.textContent = active.intensityFactor.toFixed(2);

  if (rideSamples.length === 0) {
    els.analysisTitle.textContent = "Planned workout";
    els.analysisText.textContent = [
      `TSS ${Math.round(planned.tss)}`,
      `IF ${planned.intensityFactor.toFixed(2)}`,
      `terrain TSS ${Math.round(terrainPlanned.tss)}`,
      `terrain IF ${terrainPlanned.intensityFactor.toFixed(2)}`,
      `avg ${Math.round(planned.avgPower)} W`,
      `terrain weighted ${Math.round(terrainPlanned.weightedPower)} W`,
    ].join(" | ");
    return;
  }

  els.analysisTitle.textContent = "Current ride";
  els.analysisText.textContent = [
    `TSS ${Math.round(actual.tss)} of planned ${Math.round(planned.tss)}`,
    `IF ${actual.intensityFactor.toFixed(2)}`,
    `held ${Math.round(compliance.maintainedPct * 100)}%`,
    `power ${Math.round(compliance.powerMaintainedPct * 100)}%`,
    `cadence ${Math.round(compliance.cadenceMaintainedPct * 100)}%`,
    `avg delta ${Math.round(compliance.avgPowerDelta)} W / ${Math.round(compliance.avgCadenceDelta)} rpm`,
  ].join(" | ");
}

function estimateTerrainAdjustedWorkout() {
  if (!terrainRoute?.samples?.length) {
    return estimatePlannedWorkout(profile, controller);
  }
  const opts = terrainOptions();
  const powerSamples = terrainRoute.samples.map((sample) => {
    const target = controller.targetAt(sample.timeS);
    const watts = target.watts * terrainDifficultyMultiplier(sample, opts);
    return { time: sample.timeS, watts: Math.max(0, Math.min(target.watts * 1.8, watts)) };
  });
  return summarizePowerLikeSamples(powerSamples, controller.ftp, profile.duration_s);
}

function terrainDifficultyMultiplier(sample, opts) {
  const gradeFactor = clamp(1 + Math.max(0, sample.gradePercent) * 0.028 + Math.min(0, sample.gradePercent) * 0.006, 0.92, 1.42);
  const rollingFactor = clamp(1 + ((opts.rollingResistance / DEFAULT_TERRAIN_TUNING.terrainRollingResistance) - 1) * 0.10, 0.88, 1.18);
  const aeroFactor = clamp(1 + ((opts.dragArea / DEFAULT_TERRAIN_TUNING.terrainDragArea) - 1) * 0.07, 0.94, 1.10);
  const massFactor = clamp(1 + ((opts.bikeWeightKg / DEFAULT_TERRAIN_TUNING.terrainBikeMass) - 1) * 0.04, 0.96, 1.06);
  return clamp(gradeFactor * rollingFactor * aeroFactor * massFactor, 0.82, 1.65);
}

function summarizePowerLikeSamples(samples, ftp, durationS) {
  if (samples.length === 0 || ftp <= 0 || durationS <= 0) {
    return {
      durationS,
      avgPower: 0,
      weightedPower: 0,
      intensityFactor: 0,
      tss: 0,
      avgFtpPct: 0,
    };
  }
  const avgPower = average(samples.map((sample) => sample.watts));
  const weightedPower = Math.pow(average(samples.map((sample) => Math.pow(sample.watts, 4))), 0.25);
  const intensityFactor = weightedPower / ftp;
  const tss = (durationS / 3600) * intensityFactor * intensityFactor * 100;
  return {
    durationS,
    avgPower,
    weightedPower,
    intensityFactor,
    tss,
    avgFtpPct: avgPower / ftp,
  };
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function drawRideChart() {
  const canvas = els.rideChart;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width || canvas.clientWidth || 320));
  const height = Math.max(200, Math.floor(rect.height || 230));
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const pad = { left: 44, right: 54, top: 18, bottom: 22 };
  const plotArea = { top: pad.top, bottom: height - pad.bottom };
  const plotLeft = pad.left;
  const plotRight = width - pad.right;
  const plotWidth = plotRight - plotLeft;
  const maxPower = Math.max(Number(els.maxTargetInput.value) || 420, controller.ftp * 1.25, 200);
  const minCadence = 60;
  const maxCadence = 115;
  const minMusicBpm = 80;
  const maxMusicBpm = 230;

  ctx.fillStyle = "#0f1116";
  ctx.fillRect(0, 0, width, height);
  if (els.songDivisionsToggle.checked) {
    drawSongDivisionLines(ctx, plotLeft, plotWidth, plotArea.top, plotArea.bottom);
  }
  drawPowerArea(ctx, plotLeft, plotWidth, plotArea, maxPower);
  drawTerrainProfile(ctx, plotLeft, plotWidth, plotArea);
  drawDerivedIntensityCurve(ctx, plotLeft, plotWidth, plotArea);
  drawActualSamples(ctx, plotLeft, plotWidth, plotArea, maxPower);
  drawTerrainProgress(ctx, plotLeft, plotWidth, plotArea);
  drawCadenceCurve(ctx, plotLeft, plotWidth, plotArea, minCadence, maxCadence);
  drawMusicBpmCurve(ctx, plotLeft, plotWidth, plotArea, minMusicBpm, maxMusicBpm);
  drawPlayhead(ctx, plotLeft, plotWidth, plotArea.top, plotArea.bottom);
  drawHoverLine(ctx, plotLeft, plotWidth, plotArea.top, plotArea.bottom);
  drawAnnotationMarkers(ctx, plotArea, plotLeft, plotWidth);
  drawChartLabels(ctx, width, height, plotArea, maxPower, minCadence, maxCadence, minMusicBpm, maxMusicBpm);
  drawElevationAxis(ctx, plotRight, plotArea);
}

function drawSongDivisionLines(ctx, plotLeft, plotWidth, top, bottom) {
  const windows = trackWindows();
  const boundaries = new Set();
  for (const track of windows) {
    boundaries.add(track.start_s);
    boundaries.add(track.end_s);
  }
  for (const boundary of boundaries) {
    if (boundary <= 0 || boundary >= profile.duration_s) {
      continue;
    }
    const x = timeToX(boundary, plotLeft, plotWidth);
    ctx.strokeStyle = "rgba(242, 244, 248, 0.24)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }
}

function drawPowerArea(ctx, plotLeft, plotWidth, area, maxPower) {
  let previousX = plotLeft;
  let previousY = powerToY(controller.targetAt(0).watts, area, maxPower);
  for (let x = plotLeft; x <= plotLeft + plotWidth; x += 4) {
    const time = ((x - plotLeft) / plotWidth) * profile.duration_s;
    const target = controller.targetAt(time);
    const y = powerToY(target.watts, area, maxPower);
    ctx.beginPath();
    ctx.moveTo(previousX, area.bottom);
    ctx.lineTo(previousX, previousY);
    ctx.lineTo(x, y);
    ctx.lineTo(x, area.bottom);
    ctx.closePath();
    ctx.fillStyle = powerColor(target.ftpPct, 0.82);
    ctx.fill();
    previousX = x;
    previousY = y;
  }
}

function drawCadenceCurve(ctx, plotLeft, plotWidth, area, minCadence, maxCadence) {
  ctx.beginPath();
  for (let x = plotLeft; x <= plotLeft + plotWidth; x += 4) {
    const time = ((x - plotLeft) / plotWidth) * profile.duration_s;
    const target = controller.targetAt(time);
    const y = cadenceToY(target.cadenceRpm, area, minCadence, maxCadence);
    if (x === plotLeft) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = "rgba(56, 189, 248, 0.94)";
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawMusicBpmCurve(ctx, plotLeft, plotWidth, area, minMusicBpm, maxMusicBpm) {
  ctx.beginPath();
  for (let x = plotLeft; x <= plotLeft + plotWidth; x += 4) {
    const time = ((x - plotLeft) / plotWidth) * profile.duration_s;
    const target = controller.targetAt(time);
    const y = musicBpmToY(target.musicBpm, area, minMusicBpm, maxMusicBpm);
    if (x === plotLeft) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = "rgba(250, 250, 250, 0.94)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawTerrainProfile(ctx, plotLeft, plotWidth, area) {
  if (!terrainRoute?.samples?.length) {
    return;
  }
  const samples = terrainRoute.samples;
  const yForElevation = elevationToYFactory(area);

  ctx.beginPath();
  for (const sample of samples) {
    const x = timeToX(sample.timeS, plotLeft, plotWidth);
    const y = yForElevation(sample.elevationM);
    if (sample === samples[0]) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = "rgba(250, 204, 21, 0.84)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawTerrainProgress(ctx, plotLeft, plotWidth, area) {
  if (!terrainRoute?.samples?.length) {
    return;
  }
  const samples = terrainRoute.samples.filter((sample) => sample.timeS <= latestVideoTime);
  if (samples.length < 2) {
    return;
  }
  const yForElevation = elevationToYFactory(area);

  ctx.beginPath();
  for (const sample of samples) {
    const x = timeToX(sample.timeS, plotLeft, plotWidth);
    const y = yForElevation(sample.elevationM);
    if (sample === samples[0]) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = "rgba(255, 255, 255, 0.96)";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  const point = routePointAt(terrainRoute, terrainDistanceAtVideoTime(latestVideoTime));
  const x = timeToX(latestVideoTime, plotLeft, plotWidth);
  const y = yForElevation(point?.elevationM ?? 0);
  ctx.fillStyle = "#f2f4f8";
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawElevationAxis(ctx, plotRight, area) {
  const domain = terrainElevationDomain();
  const yForElevation = elevationToYFactory(area);
  const ticks = [domain.max, Math.round((domain.max + domain.min) / 2), domain.min];
  ctx.strokeStyle = "rgba(250, 204, 21, 0.36)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plotRight + 8, area.top);
  ctx.lineTo(plotRight + 8, area.bottom);
  ctx.stroke();
  ctx.fillStyle = "rgba(250, 204, 21, 0.90)";
  ctx.font = "10px system-ui, sans-serif";
  for (const tick of ticks) {
    const y = yForElevation(tick);
    ctx.strokeStyle = "rgba(250, 204, 21, 0.30)";
    ctx.beginPath();
    ctx.moveTo(plotRight + 5, y);
    ctx.lineTo(plotRight + 11, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(tick)}m`, plotRight + 14, y + 3);
  }
}

function elevationToYFactory(area) {
  const domain = terrainElevationDomain();
  const elevationSpan = Math.max(1, domain.max - domain.min);
  const profileTop = area.top + (area.bottom - area.top) * 0.18;
  return (elevationM) => (
    area.bottom - ((elevationM - domain.min) / elevationSpan) * (area.bottom - profileTop)
  );
}

function terrainElevationDomain() {
  const defaultRoute = sampleTerrainRoute(profile, defaultTerrainOptions());
  const defaultElevations = defaultRoute.samples.map((sample) => sample.elevationM);
  const currentElevations = terrainRoute?.samples?.map((sample) => sample.elevationM) ?? [0];
  const defaultMin = Math.min(0, ...defaultElevations);
  const defaultMax = Math.max(1, ...defaultElevations);
  let min = Math.min(defaultMin, 0);
  let max = Math.max(defaultMax, 1);
  const currentMin = Math.min(...currentElevations);
  const currentMax = Math.max(...currentElevations);
  if (currentMin < min) {
    min = currentMin;
  }
  if (currentMax > max * 1.35) {
    max = currentMax;
  }
  const padding = Math.max(10, (max - min) * 0.08);
  return {
    min: Math.floor(min - padding),
    max: Math.ceil(max + padding),
  };
}

function drawDerivedIntensityCurve(ctx, plotLeft, plotWidth, area) {
  const points = derivedIntensityPoints();
  if (points.length < 2) {
    return;
  }
  ctx.beginPath();
  for (const point of points) {
    const x = timeToX(point.t, plotLeft, plotWidth);
    const y = area.bottom - Math.max(0, Math.min(1.25, point.intensity)) / 1.25 * (area.bottom - area.top);
    if (point === points[0]) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = "rgba(216, 180, 254, 0.72)";
  ctx.lineWidth = 1.4;
  ctx.setLineDash([2, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
}


function drawActualSamples(ctx, plotLeft, plotWidth, area, maxPower) {
  const barWidth = Math.max(2, plotWidth / Math.max(profile.duration_s, 1));
  for (const sample of rideSamples) {
    const x = timeToX(sample.time, plotLeft, plotWidth);
    const color = sample.maintained ? "rgba(73, 194, 122, 0.82)" : "rgba(238, 92, 85, 0.82)";
    const powerY = powerToY(sample.power, area, maxPower);
    ctx.fillStyle = color;
    ctx.fillRect(x, powerY, barWidth, area.bottom - powerY);
  }
}

function drawPlayhead(ctx, plotLeft, plotWidth, top, bottom) {
  const x = timeToX(latestVideoTime, plotLeft, plotWidth);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.stroke();
}

function drawHoverLine(ctx, plotLeft, plotWidth, top, bottom) {
  if (hoverChartTime == null) {
    return;
  }
  const x = timeToX(hoverChartTime, plotLeft, plotWidth);
  ctx.strokeStyle = "rgba(244, 184, 74, 0.92)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.stroke();
}

function drawChartLabels(ctx, width, height, area, maxPower, minCadence, maxCadence, minMusicBpm, maxMusicBpm) {
  ctx.fillStyle = "rgba(242, 244, 248, 0.86)";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText("Power", 8, area.top + 14);
  ctx.fillStyle = "rgba(167, 175, 188, 0.84)";
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText(`${Math.round(maxPower)} W`, 8, area.top + 30);
  ctx.fillText("0 W", 17, area.bottom - 4);
  ctx.fillStyle = "rgba(56, 189, 248, 0.96)";
  ctx.fillText(`${minCadence}-${maxCadence} rpm`, 4, area.top + 46);
  ctx.fillStyle = "rgba(250, 250, 250, 0.90)";
  ctx.fillText(`${minMusicBpm}-${maxMusicBpm} BPM`, 4, area.top + 62);
  ctx.fillStyle = "rgba(216, 180, 254, 0.90)";
  ctx.fillText("Derived", 7, area.top + 78);
  ctx.fillText(formatTime(0), 44, height - 5);
  const endText = formatTime(profile.duration_s);
  ctx.fillText(endText, width - 10 - ctx.measureText(endText).width, height - 5);
}

function timeToX(time, plotLeft, plotWidth) {
  return plotLeft + (Math.max(0, Math.min(profile.duration_s, time)) / profile.duration_s) * plotWidth;
}

function powerToY(watts, area, maxPower) {
  const ratio = Math.max(0, Math.min(1, watts / maxPower));
  return area.bottom - ratio * (area.bottom - area.top);
}

function cadenceToY(rpm, area, minCadence, maxCadence) {
  const ratio = Math.max(0, Math.min(1, (rpm - minCadence) / (maxCadence - minCadence)));
  return area.bottom - ratio * (area.bottom - area.top);
}

function musicBpmToY(bpm, area, minMusicBpm, maxMusicBpm) {
  const ratio = Math.max(0, Math.min(1, (bpm - minMusicBpm) / (maxMusicBpm - minMusicBpm)));
  return area.bottom - ratio * (area.bottom - area.top);
}

function onRideChartMouseMove(event) {
  const canvas = els.rideChart;
  const rect = canvas.getBoundingClientRect();
  const padLeft = 44;
  const padRight = 10;
  const plotWidth = Math.max(1, rect.width - padLeft - padRight);
  const x = Math.max(padLeft, Math.min(rect.width - padRight, event.clientX - rect.left));
  hoverChartTime = ((x - padLeft) / plotWidth) * profile.duration_s;
  updateRideChartTooltip(event, hoverChartTime);
  drawRideChart();
}

function onRideChartClick(event) {
  if (!els.timelineSeekToggle.checked || hoverChartTime == null) {
    return;
  }
  event.preventDefault();
  const seekTime = Math.max(0, Math.min(profile.duration_s, hoverChartTime));
  player?.seekTo(seekTime, true);
  latestVideoTime = seekTime;
  els.seekSlider.value = String(Math.floor(seekTime));
  controller.resetWrites();
  tick(true);
  log(`Timeline seek to ${formatTime(seekTime)}`);
}

function onRideChartMouseLeave() {
  hoverChartTime = null;
  els.rideChartTooltip.hidden = true;
  drawRideChart();
}

function updateRideChartTooltip(event, time) {
  const target = controller.targetAt(time);
  const nearest = nearestRideSample(time);
  const track = trackAt(time);
  const powerZone = ftpZoneLabel(target.ftpPct);
  const cadenceZone = cadenceZoneLabel(target.cadenceRpm);
  const terrainPoint = routePointAt(terrainRoute, terrainDistanceAtVideoTime(time));
  const derived = derivedIntensityAt(time);
  const sampleText = nearest
    ? `<span>Actual: ${nearest.power} W, ${nearest.cadence} rpm (${nearest.maintained ? "maintained" : "dropped"})</span>`
    : "<span>Actual: no sample yet</span>";

  els.rideChartTooltip.innerHTML = `
    <strong>${formatTime(time)} - ${escapeHtml(target.label)}</strong>
    <span>Song: ${track ? `${track.index + 1}. ${escapeHtml(track.title)}` : "not aligned"}</span>
    <span>Target: ${target.watts} W (${Math.round(target.ftpPct * 100)}% FTP), ${target.cadenceRpm} rpm</span>
    <span>Mode: ${escapeHtml(target.modeLabel ?? "Workout")}${target.planBlock ? ` / ${escapeHtml(target.planBlock)}` : ""}</span>
    <span>Music BPM: ${target.musicBpm}</span>
    <span>Derived intensity: ${derived ? `${Math.round(derived.intensity * 100)}%` : "not available"}</span>
    <span>Terrain: ${terrainPoint.gradePercent.toFixed(1)}%, ${formatDistance(terrainPoint.distanceM)}, ${Math.round(terrainPoint.elevationM)} m elev</span>
    <span>Power zone: ${powerZone}</span>
    <span>Cadence zone: ${cadenceZone}</span>
    ${sampleText}
  `;
  els.rideChartTooltip.hidden = false;

  const panelRect = els.rideChart.parentElement.getBoundingClientRect();
  const tooltipRect = els.rideChartTooltip.getBoundingClientRect();
  const left = Math.min(
    panelRect.width - tooltipRect.width - 8,
    Math.max(8, event.clientX - panelRect.left + 12)
  );
  const top = Math.min(
    panelRect.height - tooltipRect.height - 8,
    Math.max(8, event.clientY - panelRect.top + 12)
  );
  els.rideChartTooltip.style.left = `${left}px`;
  els.rideChartTooltip.style.top = `${top}px`;
}

function nearestRideSample(time) {
  let nearest = null;
  let nearestDelta = Infinity;
  for (const sample of rideSamples) {
    const delta = Math.abs(sample.time - time);
    if (delta < nearestDelta) {
      nearest = sample;
      nearestDelta = delta;
    }
  }
  return nearestDelta <= 5 ? nearest : null;
}

function ftpZoneLabel(ftpPct) {
  if (ftpPct < 0.55) {
    return "Z1 easy";
  }
  if (ftpPct < 0.75) {
    return "Z2 endurance";
  }
  if (ftpPct < 0.90) {
    return "Z3 tempo";
  }
  if (ftpPct < 1.05) {
    return "Z4 threshold";
  }
  return "Z5+ peak";
}

function cadenceZoneLabel(rpm) {
  if (rpm < 80) {
    return "low cadence";
  }
  if (rpm < 90) {
    return "steady";
  }
  if (rpm < 100) {
    return "quick";
  }
  return "fast";
}

function tracklistOffsetS() {
  return parseDurationInput(els.trackOffsetInput.value, profile.tracklist_intro_offset_s ?? 0);
}

function trackWindows() {
  const offset = tracklistOffsetS();
  const windows = [];
  if (offset > 0) {
    windows.push({
      title: "Intro / warmup",
      duration_s: offset,
      index: 0,
      start_s: 0,
      end_s: offset,
      avgFtpPct: averageFtpPct(0, offset),
      isIntro: true,
    });
  }
  let start = offset;
  for (const [trackIndex, track] of (profile.tracks ?? []).entries()) {
    const window = {
      ...track,
      index: windows.length,
      start_s: start,
      end_s: start + track.duration_s,
      avgFtpPct: averageFtpPct(start, start + track.duration_s),
      trackIndex,
    };
    windows.push(window);
    start = window.end_s;
  }
  return windows;
}

function trackAt(time) {
  return trackWindows().find((track) => time >= track.start_s && time < track.end_s) ?? null;
}

function renderSongStrip() {
  els.songStrip.replaceChildren();
  const windows = trackWindows();
  for (const track of windows) {
    const segment = document.createElement("div");
    segment.className = "song-segment";
    if (latestVideoTime >= track.start_s && latestVideoTime < track.end_s) {
      segment.classList.add("active");
    }
    const label = document.createElement("span");
    label.className = "song-segment-label";
    label.textContent = track.title;
    segment.append(label);
    segment.title = `${formatTime(track.start_s)} - ${formatTime(track.end_s)} ${track.title}`;
    segment.style.flexBasis = `${(track.duration_s / profile.duration_s) * 100}%`;
    segment.style.background = `linear-gradient(90deg, ${powerColor(track.avgFtpPct, 0.94)}, ${powerColor(Math.min(1.2, track.avgFtpPct + 0.12), 0.98)})`;
    els.songStrip.append(segment);
  }
  window.requestAnimationFrame(updateSongMarquees);
}

function updateSongMarquees() {
  for (const segment of els.songStrip.querySelectorAll(".song-segment")) {
    const label = segment.querySelector(".song-segment-label");
    if (!label) {
      continue;
    }
    const distance = Math.max(0, label.scrollWidth - segment.clientWidth + 18);
    segment.classList.toggle("overflowing", distance > 0);
    segment.style.setProperty("--marquee-distance", `${distance}px`);
  }
}

function powerColor(ftpPct, alpha = 1) {
  if (ftpPct < 0.55) {
    return `rgba(34, 197, 94, ${alpha})`;
  }
  if (ftpPct < 0.75) {
    return `rgba(132, 204, 22, ${alpha})`;
  }
  if (ftpPct < 0.90) {
    return `rgba(250, 204, 21, ${alpha})`;
  }
  if (ftpPct < 1.05) {
    return `rgba(249, 115, 22, ${alpha})`;
  }
  return `rgba(239, 68, 68, ${alpha})`;
}

function averageFtpPct(startS, endS) {
  const samples = 8;
  let total = 0;
  for (let i = 0; i < samples; i += 1) {
    const t = startS + ((endS - startS) * (i + 0.5)) / samples;
    total += controller.targetAt(t).ftpPct;
  }
  return total / samples;
}

function parseDurationInput(value, fallbackS = 0) {
  const text = String(value ?? "").trim();
  if (!text) {
    return fallbackS;
  }
  if (text.includes(":")) {
    const [minutesText, secondsText = "0"] = text.split(":");
    const minutes = Number(minutesText);
    const seconds = Number(secondsText);
    if (Number.isFinite(minutes) && Number.isFinite(seconds)) {
      return Math.max(0, Math.round(minutes * 60 + seconds));
    }
    return fallbackS;
  }
  const minutes = Number(text);
  if (Number.isFinite(minutes)) {
    return Math.max(0, Math.round(minutes * 60));
  }
  return fallbackS;
}

function formatDurationInput(totalSeconds) {
  const total = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function updateClock() {
  els.timeOutput.textContent = `${formatTime(latestVideoTime)} / ${formatTime(videoDuration)}`;
}

function renderTimeline() {
  els.timeline.replaceChildren();
  for (const cue of profile.cues) {
    const node = document.createElement("div");
    node.className = "cue";
    node.dataset.t = String(cue.t);
    node.innerHTML = `
      <span class="cue-time">${formatTime(cue.t)}</span>
      <strong>${escapeHtml(cue.label)}</strong>
      <span class="cue-pct">${Math.round(cue.ftp_pct * 100)}%</span>
    `;
    node.addEventListener("click", () => {
      player?.seekTo(cue.t, true);
      latestVideoTime = cue.t;
      controller.resetWrites();
      tick(true);
    });
    els.timeline.append(node);
  }
}

function setConnectionStatus() {
  if (sidecar?.readyState !== WebSocket.OPEN) {
    setStatus("disconnected", "");
  } else if (!supportsTargetPower) {
    setStatus(`connected, target power unknown/unsupported (${targetPowerAck})`, "warn");
  } else if (!controlAcquired) {
    setStatus(`connected, waiting for trainer control (${targetPowerAck})`, "warn");
  } else {
    setStatus(`trainer control active (${targetPowerAck})`, "ok");
  }
}

function setStatus(text, className) {
  els.connectionStatus.textContent = text;
  els.connectionStatus.className = className;
}

function log(text) {
  const node = document.createElement("div");
  node.textContent = `${new Date().toLocaleTimeString()}  ${text}`;
  els.eventLog.prepend(node);
  while (els.eventLog.children.length > 24) {
    els.eventLog.lastElementChild.remove();
  }
}

function escapeHtml(text) {
  const node = document.createElement("span");
  node.textContent = text;
  return node.innerHTML;
}

// --- annotation overlay (F2 to open) -------------------------------------

function populateAnnotationPresets() {
  els.annotationPresets.innerHTML = "";
  for (const preset of TAG_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.tag = preset.tag;
    btn.title = preset.hint;
    btn.innerHTML =
      `<span class="preset-key">${escapeHtml(preset.key)}</span>` +
      `<span class="preset-label">${escapeHtml(preset.label)}</span>` +
      `<span class="preset-hint">${escapeHtml(preset.tag)}</span>`;
    btn.addEventListener("click", () => sendAnnotation(preset.tag));
    els.annotationPresets.append(btn);
  }
}

function isAnnotationOverlayOpen() {
  return !els.annotationOverlay.hidden;
}

function onGlobalKeyDown(event) {
  // F2 toggles the overlay. We deliberately allow it even while typing in
  // app inputs (FTP, weight, etc.) — F2 isn't bound in any input UX we use
  // and a rider mid-ride may be focused anywhere.
  if (event.key === "F2") {
    event.preventDefault();
    if (isAnnotationOverlayOpen()) {
      closeAnnotationOverlay();
    } else {
      openAnnotationOverlay();
    }
  }
}

function openAnnotationOverlay() {
  if (isAnnotationOverlayOpen()) {
    return;
  }
  annotationFocusRestore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  els.annotationOverlay.hidden = false;
  els.annotationTagInput.value = "";
  els.annotationNoteInput.value = "";
  hideAnnotationError();
  // Focus the first preset for hotkey discovery; rider can Tab to inputs.
  const firstPreset = els.annotationPresets.querySelector("button");
  if (firstPreset instanceof HTMLElement) {
    firstPreset.focus();
  }
}

function closeAnnotationOverlay() {
  if (!isAnnotationOverlayOpen()) {
    return;
  }
  els.annotationOverlay.hidden = true;
  hideAnnotationError();
  if (annotationFocusRestore && document.body.contains(annotationFocusRestore)) {
    annotationFocusRestore.focus();
  }
  annotationFocusRestore = null;
}

function onAnnotationOverlayKeyDown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeAnnotationOverlay();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    submitFromOverlayInputs();
    return;
  }
  // Digit hotkey: send preset immediately. Skip when the rider is typing
  // a digit into a tag/note input — otherwise "1" while typing "round 1"
  // would send instead of inserting.
  const targetIsInput =
    event.target === els.annotationTagInput || event.target === els.annotationNoteInput;
  if (!targetIsInput) {
    const preset = presetForHotkey(event.key);
    if (preset) {
      event.preventDefault();
      sendAnnotation(preset.tag);
    }
  }
}

function submitFromOverlayInputs() {
  const tag = els.annotationTagInput.value.trim();
  const note = els.annotationNoteInput.value.trim();
  if (!tag) {
    showAnnotationError("pick a preset or type a tag");
    return;
  }
  sendAnnotation(tag, note);
}

function sendAnnotation(tag, note = "") {
  if (sidecar?.readyState !== WebSocket.OPEN) {
    showAnnotationError("sidecar not connected");
    return;
  }
  const target = controller.targetAt(latestVideoTime);
  const derived = derivedIntensityAt(latestVideoTime);
  const context = buildContextSnapshot({
    profile_id: profile.id,
    profile_version: profile.version,
    intensity_model_version: profile.derived_intensity_curve?.model_version,
    mode: controller.modeId,
    video_id: profile.video_id,
    section: target?.label,
    estimated_intensity: derived?.intensity,
    audio_features: derived?.audio_features,
    target_watts: target?.watts,
    power: currentPower,
    cadence: currentCadence,
    hr: currentHr,
    wkg: target?.wkg,
    hardware_source: supportsTargetPower ? "trainer_power" : undefined,
  });
  let payload;
  try {
    payload = buildAnnotateCommand({
      tag,
      note: note || null,
      clientId: CLIENT_ID,
      clientTimeS: Number.isFinite(latestVideoTime) && latestVideoTime > 0 ? latestVideoTime : null,
      context,
    });
  } catch (error) {
    showAnnotationError(error.message);
    return;
  }
  sidecar.send(JSON.stringify(payload));
  closeAnnotationOverlay();
}

function showAnnotationError(message) {
  els.annotationError.textContent = message;
  els.annotationError.hidden = false;
}

function hideAnnotationError() {
  els.annotationError.hidden = true;
  els.annotationError.textContent = "";
}

function drawAnnotationMarkers(ctx, area, plotLeft, plotWidth) {
  if (annotations.length === 0) {
    return;
  }
  ctx.save();
  for (const ann of annotations) {
    if (!Number.isFinite(ann.videoTime) || ann.videoTime < 0) {
      continue;
    }
    const x = timeToX(ann.videoTime, plotLeft, plotWidth);
    ctx.strokeStyle = "rgba(255, 209, 102, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x, area.top);
    ctx.lineTo(x, area.bottom);
    ctx.stroke();
    // Triangle marker at the top of the chart so density is glanceable.
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255, 209, 102, 0.92)";
    ctx.beginPath();
    ctx.moveTo(x - 4, area.top);
    ctx.lineTo(x + 4, area.top);
    ctx.lineTo(x, area.top + 6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
