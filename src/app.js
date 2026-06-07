import {
  CLIENT_ID,
  TAG_PRESETS,
  buildAnnotateCommand,
  buildContextSnapshot,
  presetForHotkey,
} from "./annotations.js";
import { concertProfiles } from "./concert-profile.js?v=subjective-v0.4-1";
import { ErgWorkoutController, formatTime, targetMaintained } from "./erg-controller.js?v=sampled-targets-1";
import { applySymmetricSmoothing, buildExtremaPreservingSeries } from "./intensity-sampling.js";
import {
  CHART_RANGE_OPTIONS,
  chartWindowFor,
  customChartWindow,
  overlapsWindow,
  timeToXInWindow,
  xToTimeInWindow,
} from "./chart-window.js";
import {
  blendTerrainIntensityAt,
  estimateSpeedMps,
  routePointAt,
  sampleTerrainRoute,
} from "./terrain-model.js";
import { estimatePlannedWorkout, summarizeCompliance, summarizeRideSamples } from "./workout-analysis.js";
import { workoutModes } from "./workout-patterns.js";

let profile = concertProfiles[0];
let controller = new ErgWorkoutController(profile);
const TERRAIN_TUNING_HELP = {
  terrainSourceSelect: "Blended starts from the derived curve, pulls toward authored cues, and applies terrain overrides. Derived and authored isolate each source.",
  terrainBlend: "Default 65% derived. Lower values trust authored cues more; higher values trust the dense derived curve more.",
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
  terrainSourceSelect: "blended",
  terrainBlend: 0.65,
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
  blendedIntensityToggle: document.querySelector("#blendedIntensityToggle"),
  authoredCuesToggle: document.querySelector("#authoredCuesToggle"),
  chartRangeSelect: document.querySelector("#chartRangeSelect"),
  chartRangeLabel: document.querySelector("#chartRangeLabel"),
  chartSelectionToggle: document.querySelector("#chartSelectionToggle"),
  songZoomToggle: document.querySelector("#songZoomToggle"),
  chartTallToggle: document.querySelector("#chartTallToggle"),
  chartSelectionControls: document.querySelector("#chartSelectionControls"),
  chartStartSlider: document.querySelector("#chartStartSlider"),
  chartStartOut: document.querySelector("#chartStartOut"),
  chartEndSlider: document.querySelector("#chartEndSlider"),
  chartEndOut: document.querySelector("#chartEndOut"),
  applyChartSelection: document.querySelector("#applyChartSelection"),
  songStrip: document.querySelector("#songStrip"),
  profileSelect: document.querySelector("#profileSelect"),
  curveSelect: document.querySelector("#curveSelect"),
  intensitySmoothing: document.querySelector("#intensitySmoothing"),
  intensitySmoothingOut: document.querySelector("#intensitySmoothingOut"),
  ftpInput: document.querySelector("#ftpInput"),
  workoutModeSelect: document.querySelector("#workoutModeSelect"),
  weightInput: document.querySelector("#weightInput"),
  warmupDurationInput: document.querySelector("#warmupDurationInput"),
  maxTargetInput: document.querySelector("#maxTargetInput"),
  sidecarUrlInput: document.querySelector("#sidecarUrlInput"),
  trackOffsetInput: document.querySelector("#trackOffsetInput"),
  terrainSourceSelect: document.querySelector("#terrainSourceSelect"),
  terrainBlend: document.querySelector("#terrainBlend"),
  terrainBlendOut: document.querySelector("#terrainBlendOut"),
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
let customChartSelection = defaultCustomChartSelection();

populateChartRangeSelect();
populateProfileSelect();
populateCurveSelect();
syncIntensitySmoothingOutput();
// populateCurveSelect restored the dropdown to the persisted choice, but
// profile/controller above were built with the default curve. Activate now
// so the restored selection actually loads — otherwise the dropdown shows
// the right thing while the loaded curve is still the default.
activateSelectedProfile({ reloadVideo: false });
renderProfileMetadata({ resetTimingInputs: true });
for (const mode of workoutModes) {
  const option = document.createElement("option");
  option.value = mode.id;
  option.textContent = mode.label;
  option.title = mode.description;
  els.workoutModeSelect.append(option);
}
syncControllerIntensitySource();
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
els.blendedIntensityToggle.addEventListener("change", drawRideChart);
els.authoredCuesToggle.addEventListener("change", drawRideChart);
els.chartRangeSelect.addEventListener("change", () => {
  renderSongStrip();
  drawRideChart();
});
els.chartSelectionToggle.addEventListener("change", () => {
  els.chartSelectionControls.hidden = !els.chartSelectionToggle.checked;
  els.rideChart.parentElement.classList.toggle("chart-select-enabled", els.chartSelectionToggle.checked);
  syncChartSelectionControls();
  drawRideChart();
});
els.songZoomToggle.addEventListener("change", () => {
  els.rideChart.parentElement.classList.toggle("song-zoom-enabled", els.songZoomToggle.checked);
});
els.chartTallToggle.addEventListener("change", () => {
  els.rideChart.parentElement.classList.toggle("tall", els.chartTallToggle.checked);
  drawRideChart();
});
for (const input of [els.chartStartSlider, els.chartEndSlider]) {
  input.addEventListener("input", () => {
    syncChartSelectionOutputs();
    drawRideChart();
  });
}
els.applyChartSelection.addEventListener("click", () => {
  const next = customChartWindow(
    Number(els.chartStartSlider.value),
    Number(els.chartEndSlider.value),
    profile.duration_s,
  );
  customChartSelection = { startS: next.startS, endS: next.endS };
  els.chartRangeSelect.value = "custom";
  syncChartSelectionControls();
  renderSongStrip();
  drawRideChart();
});
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
els.profileSelect.addEventListener("change", () => {
  populateCurveSelect();
  activateSelectedProfile({ reloadVideo: true });
});
els.curveSelect.addEventListener("change", () => {
  persistCurveSelection();
  activateSelectedProfile({ reloadVideo: false });
});
els.intensitySmoothing.addEventListener("input", () => {
  syncIntensitySmoothingOutput();
  syncControllerIntensitySource();
  controller.resetWrites();
  renderTarget(controller.targetAt(latestVideoTime));
  drawRideChart();
  tick(true);
});

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
    syncControllerIntensitySource();
    controller.resetWrites();
    renderTerrainTuning();
    renderTerrainSummary();
    drawRideChart();
    updateAnalysis();
    renderTarget(controller.targetAt(latestVideoTime));
    tick(true);
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

function populateChartRangeSelect() {
  els.chartRangeSelect.replaceChildren();
  for (const optionConfig of CHART_RANGE_OPTIONS) {
    const option = document.createElement("option");
    option.value = optionConfig.id;
    option.textContent = optionConfig.label;
    els.chartRangeSelect.append(option);
  }
  els.chartRangeSelect.value = "full";
  syncChartSelectionControls();
}

function syncChartSelectionControls() {
  const max = Math.max(1, Math.round(profile.duration_s));
  for (const slider of [els.chartStartSlider, els.chartEndSlider]) {
    slider.max = String(max);
  }
  els.chartStartSlider.value = String(Math.round(Math.min(customChartSelection.startS, max)));
  els.chartEndSlider.value = String(Math.round(Math.min(customChartSelection.endS, max)));
  syncChartSelectionOutputs();
}

function syncChartSelectionOutputs() {
  const start = Number(els.chartStartSlider.value);
  const end = Number(els.chartEndSlider.value);
  els.chartStartOut.textContent = formatTime(Math.min(start, end));
  els.chartEndOut.textContent = formatTime(Math.max(start, end));
}

function populateProfileSelect() {
  els.profileSelect.innerHTML = "";
  for (const [index, candidate] of concertProfiles.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = candidate.title;
    els.profileSelect.append(option);
  }
  els.profileSelect.value = "0";
}

function curveOptionsFor(candidate) {
  const options = Array.isArray(candidate.available_intensity_curves)
    ? candidate.available_intensity_curves
    : [];
  if (options.length > 0) {
    return options;
  }
  return [
    {
      id: "default",
      label: candidate.derived_intensity_curve?.model_version ?? "Default curve",
      curve: candidate.derived_intensity_curve,
    },
  ];
}

function populateCurveSelect() {
  const baseProfile = concertProfiles[Number(els.profileSelect.value) || 0] ?? concertProfiles[0];
  els.curveSelect.innerHTML = "";
  const options = curveOptionsFor(baseProfile);
  for (const optionConfig of options) {
    const option = document.createElement("option");
    option.value = optionConfig.id;
    option.textContent = optionConfig.label;
    option.title = optionConfig.curve?.note ?? optionConfig.curve?.model_version ?? "";
    els.curveSelect.append(option);
  }
  const stored = readStoredCurveSelection(baseProfile.video_id);
  const fallback = options[0]?.id ?? "default";
  const initial = stored && options.some((o) => o.id === stored) ? stored : fallback;
  els.curveSelect.value = initial;
}

function curveSelectionStorageKey(videoId) {
  return `gizzERG:curveSelection:${videoId ?? "default"}`;
}

function readStoredCurveSelection(videoId) {
  try {
    return window.localStorage?.getItem(curveSelectionStorageKey(videoId));
  } catch {
    return null;
  }
}

function persistCurveSelection() {
  const baseProfile = concertProfiles[Number(els.profileSelect.value) || 0] ?? concertProfiles[0];
  try {
    window.localStorage?.setItem(
      curveSelectionStorageKey(baseProfile?.video_id),
      els.curveSelect.value,
    );
  } catch {
    // ignore — localStorage may be disabled
  }
}

function selectedProfile() {
  const baseProfile = concertProfiles[Number(els.profileSelect.value) || 0] ?? concertProfiles[0];
  const curveOption = curveOptionsFor(baseProfile).find((option) => option.id === els.curveSelect.value)
    ?? curveOptionsFor(baseProfile)[0];
  return {
    ...baseProfile,
    version: curveOption?.id ? `${baseProfile.version}:${curveOption.id}` : baseProfile.version,
    derived_intensity_curve: curveOption?.curve ?? baseProfile.derived_intensity_curve,
  };
}

function activateSelectedProfile({ reloadVideo = false } = {}) {
  const previousVideoId = profile.video_id;
  profile = selectedProfile();
  controller = new ErgWorkoutController(profile);
  controller.setRider({
    ftp: els.ftpInput.value,
    weightKg: els.weightInput.value,
    maxWatts: els.maxTargetInput.value,
  });
  controller.setMode({
    modeId: els.workoutModeSelect.value,
    warmupMinutes: parseDurationInput(els.warmupDurationInput.value, 15 * 60) / 60,
  });
  latestVideoTime = Math.min(latestVideoTime, profile.duration_s);
  els.seekSlider.value = String(Math.round(latestVideoTime));
  customChartSelection = defaultCustomChartSelection();
  syncChartSelectionControls();
  currentSongKey = "";
  terrainRoute = buildTerrainRoute();
  syncControllerIntensitySource();
  renderProfileMetadata({ resetTimingInputs: reloadVideo });
  clearRideSamples();
  renderTimeline();
  renderSongStrip();
  renderTerrainSummary();
  renderTarget(controller.targetAt(latestVideoTime));
  updateClock();
  drawRideChart();
  if (reloadVideo && player && previousVideoId !== profile.video_id) {
    player.loadVideoById(profile.video_id);
  }
}

function defaultCustomChartSelection() {
  const start = Math.max(0, Math.min(profile.tracklist_intro_offset_s ?? 0, profile.duration_s));
  return {
    startS: start,
    endS: Math.min(profile.duration_s, start + 20 * 60),
  };
}

function renderProfileMetadata({ resetTimingInputs = false } = {}) {
  els.profileTitle.textContent = profile.title;
  videoDuration = profile.duration_s;
  els.seekSlider.max = String(profile.duration_s);
  if (resetTimingInputs) {
    els.trackOffsetInput.value = formatDurationInput(profile.tracklist_intro_offset_s ?? 0);
    els.warmupDurationInput.value = formatDurationInput(profile.tracklist_intro_offset_s ?? 15 * 60);
  }
  const curveLabel = selectedCurveLabel();
  els.trackSourceText.textContent = `${profile.tracklist_source?.name ?? "Tracklist"} song bands. Curve: ${curveLabel}.`;
}

function selectedCurveLabel() {
  return els.curveSelect.selectedOptions[0]?.textContent
    ?? profile.derived_intensity_curve?.model_version
    ?? "default";
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
  if (els.chartRangeSelect.value !== "full") {
    renderSongStrip();
  }
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
  const liveBpm = audioBpmAt(latestVideoTime);
  const bpmText = liveBpm != null ? `${Math.round(liveBpm)} music BPM` : `${target.musicBpm} music BPM`;
  els.guidanceText.textContent = `${target.modeLabel}: ${bpmText}, ride ${target.cadenceRpm} rpm, ${target.wkg.toFixed(2)} W/kg target.`;
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

function syncControllerIntensitySource() {
  if (typeof controller.setIntensitySource !== "function") {
    console.warn("ErgWorkoutController.setIntensitySource unavailable; refresh cached modules.");
    return;
  }
  controller.setIntensitySource({
    intensitySource: terrainSourceValue(),
    intensityBlend: Number(els.terrainBlend?.value) || DEFAULT_TERRAIN_TUNING.terrainBlend,
    intensitySeries: sampledTargetIntensitySeries(),
  });
}

function sampledTargetIntensitySeries() {
  if (!terrainRoute?.samples?.length || terrainSourceValue() === "cues") {
    return [];
  }
  const candidates = sampledTargetCandidateTimes();
  const opts = terrainOptions();
  return buildExtremaPreservingSeries({
    durationS: profile.duration_s,
    sampleStepS: opts.sampleStepS,
    candidateTimes: candidates,
    intensityAt: (time) => targetSourceIntensityAt(time),
  });
}

function sampledTargetCandidateTimes() {
  const derivedTimes = derivedIntensityPoints().map((point) => point.t);
  const cueTimes = profile.cues?.map((cue) => Number(cue.t)).filter(Number.isFinite) ?? [];
  return terrainSourceValue() === "blended"
    ? [...derivedTimes, ...cueTimes]
    : derivedTimes;
}

function targetSourceIntensityAt(time) {
  if (terrainSourceValue() === "blended") {
    return blendedTerrainIntensityAt(time);
  }
  return derivedIntensityAt(time)?.intensity ?? null;
}

function terrainOptions() {
  return {
    ftp: Number(els.ftpInput?.value) || controller.ftp,
    riderWeightKg: Number(els.weightInput?.value) || controller.weightKg,
    sampleStepS: Number(els.terrainSampleStep?.value) || DEFAULT_TERRAIN_TUNING.terrainSampleStep,
    intensitySource: terrainSourceValue(),
    intensityBlend: Number(els.terrainBlend?.value) || DEFAULT_TERRAIN_TUNING.terrainBlend,
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
    intensityBlend: DEFAULT_TERRAIN_TUNING.terrainBlend,
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
    els.terrainBlend,
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
  syncControllerIntensitySource();
  controller.resetWrites();
  renderTerrainTuning();
  renderTerrainSummary();
  drawRideChart();
  updateAnalysis();
  renderTarget(controller.targetAt(latestVideoTime));
  tick(true);
  showTerrainHelp("terrainGradeScale");
}

function renderTerrainTuning() {
  els.terrainBlendOut.textContent = `${Math.round(Number(els.terrainBlend.value) * 100)}%`;
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
  if (terrainSourceValue() === "cues") {
    return "authored cues";
  }
  if (terrainSourceValue() === "blended") {
    return `${Math.round(Number(els.terrainBlend?.value || 0) * 100)}% blended`;
  }
  return "derived intensity";
}

function terrainSourceDisplayLabel() {
  if (terrainSourceValue() === "cues") {
    return "Authored cues";
  }
  if (terrainSourceValue() === "blended") {
    return `Blended (${Math.round(Number(els.terrainBlend?.value || 0) * 100)}% derived)`;
  }
  return derivedIntensityLabel();
}

function terrainSourceValue() {
  const value = els.terrainSourceSelect?.value;
  if (value === "cues" || value === "derived" || value === "blended") {
    return value;
  }
  return DEFAULT_TERRAIN_TUNING.terrainSourceSelect;
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
  const normalized = points
    .map((point) => ({
      ...point,
      t: Number(point.t),
      intensity: Number(point.intensity),
    }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.intensity))
    .sort((a, b) => a.t - b.t);
  return applySymmetricSmoothing(normalized, intensitySmoothingWindowS());
}

function intensitySmoothingWindowS() {
  return Math.max(0, Number(els.intensitySmoothing?.value) || 0);
}

function syncIntensitySmoothingOutput() {
  const value = intensitySmoothingWindowS();
  els.intensitySmoothingOut.textContent = value === 0 ? "off" : `${Math.round(value)}s`;
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

// Per-window BPM from audio_features when the active curve carries it
// (v0.3 / v0.4 after BPM extraction). Returns null otherwise so callers
// can fall back to the per-section cue.bpm.
//
// Smoothing reuses the intensity-smoothing window so a single slider
// controls both signals consistently. Per-frame tempo from librosa is
// noisy at sub-second resolution — smoothing makes the BPM line track
// musical phrases rather than estimator jitter.
function audioBpmAt(timeS) {
  const points = derivedIntensityPoints();
  if (points.length === 0) {
    return null;
  }
  const window = intensitySmoothingWindowS();
  if (window === 0) {
    const point = nearestPointAtOrBefore(points, timeS);
    const bpm = Number(point?.audio_features?.bpm);
    return Number.isFinite(bpm) && bpm > 0 ? bpm : null;
  }
  const half = window / 2;
  let sum = 0;
  let count = 0;
  for (const point of points) {
    if (point.t < timeS - half) continue;
    if (point.t > timeS + half) break;
    const bpm = Number(point.audio_features?.bpm);
    if (Number.isFinite(bpm) && bpm > 0) {
      sum += bpm;
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

function nearestPointAtOrBefore(points, timeS) {
  let current = points[0];
  for (const point of points) {
    if (point.t > timeS) break;
    current = point;
  }
  return current;
}

function blendedTerrainIntensityAt(timeS) {
  return blendTerrainIntensityAt(profile, timeS, terrainOptions());
}

function derivedIntensityLabel() {
  return profile.derived_intensity_curve?.model_version === "manual-seed-v0.1"
    ? "Seed intensity"
    : "Derived intensity";
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
  const chartWindow = currentChartWindow();
  updateChartRangeLabel(chartWindow);
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
  drawIntensityGuideLines(ctx, plotLeft, plotWidth, plotArea, maxPower);
  drawDerivedIntensityCurve(ctx, plotLeft, plotWidth, plotArea, maxPower);
  if (els.authoredCuesToggle.checked) {
    drawAuthoredCuesCurve(ctx, plotLeft, plotWidth, plotArea, maxPower);
  }
  if (els.blendedIntensityToggle.checked) {
    drawBlendedIntensityCurve(ctx, plotLeft, plotWidth, plotArea);
  }
  drawActualSamples(ctx, plotLeft, plotWidth, plotArea, maxPower);
  drawTerrainProgress(ctx, plotLeft, plotWidth, plotArea);
  drawCadenceCurve(ctx, plotLeft, plotWidth, plotArea, minCadence, maxCadence);
  drawMusicBpmCurve(ctx, plotLeft, plotWidth, plotArea, minMusicBpm, maxMusicBpm);
  drawPlayhead(ctx, plotLeft, plotWidth, plotArea.top, plotArea.bottom);
  drawHoverLine(ctx, plotLeft, plotWidth, plotArea.top, plotArea.bottom);
  drawSelectionPreviewMarkers(ctx, plotLeft, plotWidth, plotArea.top, plotArea.bottom);
  drawAnnotationMarkers(ctx, plotArea, plotLeft, plotWidth);
  drawChartLabels(ctx, width, height, plotArea, maxPower, minCadence, maxCadence, minMusicBpm, maxMusicBpm, chartWindow);
  drawElevationAxis(ctx, plotRight, plotArea);
}

function currentChartWindow() {
  if (els.chartRangeSelect.value === "custom") {
    return customChartWindow(customChartSelection.startS, customChartSelection.endS, profile.duration_s);
  }
  return chartWindowFor(els.chartRangeSelect.value, latestVideoTime, profile.duration_s);
}

function updateChartRangeLabel(chartWindow) {
  if (chartWindow.rangeId === "full") {
    els.chartRangeLabel.textContent = "Showing full ride";
    return;
  }
  const prefix = chartWindow.rangeId === "custom" ? "Selected" : "Showing";
  els.chartRangeLabel.textContent = `${prefix} ${formatTime(chartWindow.startS)} - ${formatTime(chartWindow.endS)}`;
}

function drawSongDivisionLines(ctx, plotLeft, plotWidth, top, bottom) {
  const windows = trackWindows();
  const boundaries = new Set();
  for (const track of windows) {
    boundaries.add(track.start_s);
    boundaries.add(track.end_s);
  }
  for (const boundary of boundaries) {
    const chartWindow = currentChartWindow();
    if (boundary <= chartWindow.startS || boundary >= chartWindow.endS) {
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
  const chartWindow = currentChartWindow();
  let previousX = plotLeft;
  let previousY = powerToY(controller.targetAt(chartWindow.startS).watts, area, maxPower);
  for (let x = plotLeft; x <= plotLeft + plotWidth; x += 4) {
    const time = xToTimeInWindow(x, plotLeft, plotWidth, chartWindow);
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
  const chartWindow = currentChartWindow();
  ctx.beginPath();
  for (let x = plotLeft; x <= plotLeft + plotWidth; x += 4) {
    const time = xToTimeInWindow(x, plotLeft, plotWidth, chartWindow);
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
  const chartWindow = currentChartWindow();
  ctx.beginPath();
  for (let x = plotLeft; x <= plotLeft + plotWidth; x += 4) {
    const time = xToTimeInWindow(x, plotLeft, plotWidth, chartWindow);
    const bpm = audioBpmAt(time) ?? controller.targetAt(time).musicBpm;
    const y = musicBpmToY(bpm, area, minMusicBpm, maxMusicBpm);
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
  const chartWindow = currentChartWindow();
  const samples = terrainRoute.samples.filter((sample) => (
    sample.timeS >= chartWindow.startS && sample.timeS <= chartWindow.endS
  ));
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
  ctx.strokeStyle = "rgba(250, 204, 21, 0.84)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawTerrainProgress(ctx, plotLeft, plotWidth, area) {
  if (!terrainRoute?.samples?.length) {
    return;
  }
  const chartWindow = currentChartWindow();
  const samples = terrainRoute.samples.filter((sample) => (
    sample.timeS >= chartWindow.startS && sample.timeS <= chartWindow.endS && sample.timeS <= latestVideoTime
  ));
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
  if (latestVideoTime < chartWindow.startS || latestVideoTime > chartWindow.endS) {
    return;
  }
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

function drawDerivedIntensityCurve(ctx, plotLeft, plotWidth, area, maxPower) {
  const chartWindow = currentChartWindow();
  const points = visibleStepPoints(derivedIntensityPoints(), (point) => point.t, chartWindow);
  if (points.length < 2) {
    return;
  }
  ctx.beginPath();
  let previousY = null;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const x = timeToX(point.t, plotLeft, plotWidth);
    const y = derivedIntensityToY(point.intensity, area, maxPower);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, previousY);
      ctx.lineTo(x, y);
    }
    previousY = y;
  }
  const finalX = timeToX(chartWindow.endS, plotLeft, plotWidth);
  ctx.lineTo(finalX, previousY);
  ctx.save();
  ctx.strokeStyle = "rgba(3, 7, 18, 0.92)";
  ctx.lineWidth = 4.6;
  ctx.setLineDash([5, 6]);
  ctx.stroke();
  ctx.strokeStyle = "rgba(34, 211, 238, 0.98)";
  ctx.lineWidth = 2.3;
  ctx.setLineDash([2, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// Authored cues line: renders profile.cues as a step function on the same
// power-axis as the derived overlay so they're directly comparable. Useful
// when tuning the blend slider — you can see the authored baseline next to
// the rider-tuned derived curve and the blended target the trainer follows.
function drawAuthoredCuesCurve(ctx, plotLeft, plotWidth, area, maxPower) {
  const cues = Array.isArray(profile.cues) ? profile.cues : [];
  if (cues.length < 2) {
    return;
  }
  const chartWindow = currentChartWindow();
  const cuePoints = cues
    .map((cue) => ({ t: Number(cue.t), intensity: Number(cue.ftp_pct) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.intensity))
    .sort((a, b) => a.t - b.t);
  const points = visibleStepPoints(cuePoints, (point) => point.t, chartWindow);
  if (points.length < 2) {
    return;
  }
  ctx.beginPath();
  let previousY = null;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const x = timeToX(point.t, plotLeft, plotWidth);
    const y = derivedIntensityToY(point.intensity, area, maxPower);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, previousY);
      ctx.lineTo(x, y);
    }
    previousY = y;
  }
  const finalX = timeToX(chartWindow.endS, plotLeft, plotWidth);
  ctx.lineTo(finalX, previousY);
  ctx.save();
  ctx.strokeStyle = "rgba(3, 7, 18, 0.92)";
  ctx.lineWidth = 4.0;
  ctx.setLineDash([3, 8]);
  ctx.stroke();
  ctx.strokeStyle = "rgba(244, 114, 182, 0.95)"; // rose-400 — distinct from cyan derived and green blended
  ctx.lineWidth = 1.8;
  ctx.setLineDash([3, 8]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawBlendedIntensityCurve(ctx, plotLeft, plotWidth, area) {
  if (!terrainRoute?.samples?.length) {
    return;
  }
  const chartWindow = currentChartWindow();
  const samples = visibleStepPoints(terrainRoute.samples, (sample) => sample.timeS, chartWindow);
  if (samples.length < 2) {
    return;
  }
  ctx.beginPath();
  let previousY = null;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const x = timeToX(sample.timeS, plotLeft, plotWidth);
    const y = intensityToY(sample.intensity, area);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, previousY);
      ctx.lineTo(x, y);
    }
    previousY = y;
  }
  const finalX = timeToX(chartWindow.endS, plotLeft, plotWidth);
  ctx.lineTo(finalX, previousY);
  ctx.strokeStyle = "rgba(52, 211, 153, 0.86)";
  ctx.lineWidth = 1.8;
  ctx.setLineDash([6, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawIntensityGuideLines(ctx, plotLeft, plotWidth, area, maxPower) {
  const points = derivedIntensityPoints().filter((point) => Number.isFinite(point.intensity));
  if (points.length === 0) {
    return;
  }
  const values = points.map((point) => point.intensity);
  const guides = [
    { label: "max", value: Math.max(...values), color: "rgba(239, 68, 68, 0.58)" },
    { label: "mean", value: average(values), color: "rgba(250, 204, 21, 0.50)" },
    { label: "min", value: Math.min(...values), color: "rgba(34, 197, 94, 0.50)" },
  ];
  ctx.save();
  ctx.font = "10px system-ui, sans-serif";
  for (const guide of guides) {
    const y = derivedIntensityToY(guide.value, area, maxPower);
    ctx.strokeStyle = guide.color;
    ctx.lineWidth = guide.label === "mean" ? 1.2 : 1;
    ctx.setLineDash(guide.label === "mean" ? [5, 4] : [2, 5]);
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotLeft + plotWidth, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = guide.color;
    ctx.fillText(`${guide.label} ${Math.round(guide.value * 100)}%`, plotLeft + plotWidth - 58, y - 3);
  }
  ctx.restore();
}


function drawActualSamples(ctx, plotLeft, plotWidth, area, maxPower) {
  const chartWindow = currentChartWindow();
  const barWidth = Math.max(2, plotWidth / Math.max(chartWindow.durationS, 1));
  for (const sample of rideSamples) {
    if (sample.time < chartWindow.startS || sample.time > chartWindow.endS) {
      continue;
    }
    const x = timeToX(sample.time, plotLeft, plotWidth);
    const color = sample.maintained ? "rgba(73, 194, 122, 0.82)" : "rgba(238, 92, 85, 0.82)";
    const powerY = powerToY(sample.power, area, maxPower);
    ctx.fillStyle = color;
    ctx.fillRect(x, powerY, barWidth, area.bottom - powerY);
  }
}

function drawPlayhead(ctx, plotLeft, plotWidth, top, bottom) {
  const chartWindow = currentChartWindow();
  if (latestVideoTime < chartWindow.startS || latestVideoTime > chartWindow.endS) {
    return;
  }
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
  const chartWindow = currentChartWindow();
  if (hoverChartTime < chartWindow.startS || hoverChartTime > chartWindow.endS) {
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

function drawSelectionPreviewMarkers(ctx, plotLeft, plotWidth, top, bottom) {
  if (!els.chartSelectionToggle.checked) {
    return;
  }
  const chartWindow = currentChartWindow();
  const start = Number(els.chartStartSlider.value);
  const end = Number(els.chartEndSlider.value);
  drawSelectionMarker(ctx, Math.min(start, end), "rgba(34, 197, 94, 0.95)", plotLeft, plotWidth, top, bottom, chartWindow);
  drawSelectionMarker(ctx, Math.max(start, end), "rgba(239, 68, 68, 0.95)", plotLeft, plotWidth, top, bottom, chartWindow);
}

function drawSelectionMarker(ctx, time, color, plotLeft, plotWidth, top, bottom, chartWindow) {
  if (time < chartWindow.startS || time > chartWindow.endS) {
    return;
  }
  const x = timeToX(time, plotLeft, plotWidth);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, top + 5, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawChartLabels(ctx, width, height, area, maxPower, minCadence, maxCadence, minMusicBpm, maxMusicBpm, chartWindow) {
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
  ctx.fillText(derivedIntensityLabel(), 7, area.top + 78);
  if (els.blendedIntensityToggle.checked) {
    ctx.fillStyle = "rgba(52, 211, 153, 0.94)";
    ctx.fillText("Blended", 7, area.top + 94);
  }
  ctx.fillText(formatTime(chartWindow.startS), 44, height - 5);
  const endText = formatTime(chartWindow.endS);
  ctx.fillText(endText, width - 10 - ctx.measureText(endText).width, height - 5);
}

function timeToX(time, plotLeft, plotWidth) {
  return timeToXInWindow(time, plotLeft, plotWidth, currentChartWindow());
}

function visibleStepPoints(points, timeForPoint, chartWindow) {
  const sorted = [...points].sort((a, b) => timeForPoint(a) - timeForPoint(b));
  const visible = [];
  let previous = null;
  for (const point of sorted) {
    const time = timeForPoint(point);
    if (time < chartWindow.startS) {
      previous = point;
      continue;
    }
    if (time > chartWindow.endS) {
      break;
    }
    if (previous && visible.length === 0) {
      visible.push(previous);
    }
    visible.push(point);
  }
  if (visible.length === 0 && previous) {
    visible.push(previous, { ...previous, t: chartWindow.endS, timeS: chartWindow.endS });
  }
  return visible;
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

function intensityToY(intensity, area) {
  return area.bottom - Math.max(0, Math.min(2, intensity)) / 2 * (area.bottom - area.top);
}

function derivedIntensityToY(intensity, area, maxPower) {
  if (terrainSourceValue() === "derived") {
    const watts = Math.min(
      Number(els.maxTargetInput.value) || maxPower,
      Math.max(0, Number(intensity) * controller.ftp),
    );
    return powerToY(watts, area, maxPower);
  }
  return intensityToY(intensity, area);
}

function onRideChartMouseMove(event) {
  const canvas = els.rideChart;
  const rect = canvas.getBoundingClientRect();
  const padLeft = 44;
  const padRight = 54;
  const plotWidth = Math.max(1, rect.width - padLeft - padRight);
  const x = Math.max(padLeft, Math.min(rect.width - padRight, event.clientX - rect.left));
  hoverChartTime = xToTimeInWindow(x, padLeft, plotWidth, currentChartWindow());
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
  const terrainSample = nearestTerrainSample(time);
  const blendedIntensity = blendedTerrainIntensityAt(time);
  const sampleText = nearest
    ? `<span>Actual: ${nearest.power} W, ${nearest.cadence} rpm (${nearest.maintained ? "maintained" : "dropped"})</span>`
    : "<span>Actual: no sample yet</span>";

  els.rideChartTooltip.innerHTML = `
    <strong>${formatTime(time)} - ${escapeHtml(target.label)}</strong>
    <span>Song: ${track ? `${track.index + 1}. ${escapeHtml(track.title)}` : "not aligned"}</span>
    <span>Target: ${target.watts} W (${Math.round(target.ftpPct * 100)}% FTP), ${target.cadenceRpm} rpm</span>
    <span>Mode: ${escapeHtml(target.modeLabel ?? "Workout")}${target.planBlock ? ` / ${escapeHtml(target.planBlock)}` : ""}</span>
    <span>Music BPM: ${(() => { const b = audioBpmAt(time); return b != null ? `${Math.round(b)} (per-window)` : `${target.musicBpm} (per-section)`; })()}</span>
    <span>${derivedIntensityLabel()}: ${derived ? `${Math.round(derived.intensity * 100)}%` : "not available"}</span>
    <span>Terrain source: ${escapeHtml(terrainSourceDisplayLabel())}</span>
    <span>Blended terrain intensity: ${Math.round(blendedIntensity * 100)}%</span>
    <span>Terrain: ${terrainPoint.gradePercent.toFixed(1)}%, ${formatDistance(terrainPoint.distanceM)}, ${Math.round(terrainPoint.elevationM)} m elev, +${Math.round(terrainPoint.elevationGainM)} m gain</span>
    <span>Route sample: ${terrainSample ? `${Math.round(terrainSample.smoothedIntensity * 100)}% smoothed, ${terrainSample.gradePercent.toFixed(1)}% grade` : "not available"}</span>
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
  const chartWindow = currentChartWindow();
  const windows = trackWindows().filter((track) => overlapsWindow(track.start_s, track.end_s, chartWindow));
  for (const track of windows) {
    const visibleStart = Math.max(track.start_s, chartWindow.startS);
    const visibleEnd = Math.min(track.end_s, chartWindow.endS);
    const visibleDuration = Math.max(0, visibleEnd - visibleStart);
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
    segment.style.flexBasis = `${(visibleDuration / chartWindow.durationS) * 100}%`;
    segment.style.background = `linear-gradient(90deg, ${powerColor(track.avgFtpPct, 0.94)}, ${powerColor(Math.min(1.2, track.avgFtpPct + 0.12), 0.98)})`;
    segment.addEventListener("click", () => {
      if (!els.songZoomToggle.checked) {
        return;
      }
      customChartSelection = {
        startS: track.start_s,
        endS: track.end_s,
      };
      els.chartRangeSelect.value = "custom";
      syncChartSelectionControls();
      renderSongStrip();
      drawRideChart();
    });
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
    btn.addEventListener("click", () => sendAnnotation(preset.tag, currentAnnotationNote()));
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
      sendAnnotation(preset.tag, currentAnnotationNote());
    }
  }
}

function currentAnnotationNote() {
  return els.annotationNoteInput.value.trim();
}

function submitFromOverlayInputs() {
  const tag = els.annotationTagInput.value.trim();
  const note = currentAnnotationNote();
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
  const chartWindow = currentChartWindow();
  ctx.save();
  for (const ann of annotations) {
    if (!Number.isFinite(ann.videoTime) || ann.videoTime < 0) {
      continue;
    }
    if (ann.videoTime < chartWindow.startS || ann.videoTime > chartWindow.endS) {
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
