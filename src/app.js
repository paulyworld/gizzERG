import { concertProfiles } from "./concert-profile.js";
import { ErgWorkoutController, formatTime, targetMaintained } from "./erg-controller.js";
import { estimatePlannedWorkout, summarizeCompliance, summarizeRideSamples } from "./workout-analysis.js";
import { workoutModes } from "./workout-patterns.js";

const profile = concertProfiles[0];
const controller = new ErgWorkoutController(profile);

const els = {
  profileTitle: document.querySelector("#profileTitle"),
  playButton: document.querySelector("#playButton"),
  pauseButton: document.querySelector("#pauseButton"),
  seekSlider: document.querySelector("#seekSlider"),
  timeOutput: document.querySelector("#timeOutput"),
  rideChart: document.querySelector("#rideChart"),
  rideChartTooltip: document.querySelector("#rideChartTooltip"),
  timelineSeekToggle: document.querySelector("#timelineSeekToggle"),
  songStrip: document.querySelector("#songStrip"),
  ftpInput: document.querySelector("#ftpInput"),
  workoutModeSelect: document.querySelector("#workoutModeSelect"),
  weightInput: document.querySelector("#weightInput"),
  warmupDurationInput: document.querySelector("#warmupDurationInput"),
  maxTargetInput: document.querySelector("#maxTargetInput"),
  sidecarUrlInput: document.querySelector("#sidecarUrlInput"),
  trackOffsetInput: document.querySelector("#trackOffsetInput"),
  connectButton: document.querySelector("#connectButton"),
  connectionStatus: document.querySelector("#connectionStatus"),
  targetWatts: document.querySelector("#targetWatts"),
  targetCadence: document.querySelector("#targetCadence"),
  targetPct: document.querySelector("#targetPct"),
  livePower: document.querySelector("#livePower"),
  liveCadence: document.querySelector("#liveCadence"),
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
updateAnalysis();
drawRideChart();
window.addEventListener("resize", drawRideChart);
els.rideChart.addEventListener("mousemove", onRideChartMouseMove);
els.rideChart.addEventListener("mouseleave", onRideChartMouseLeave);
els.rideChart.addEventListener("click", onRideChartClick);
els.timelineSeekToggle.addEventListener("change", () => {
  els.rideChart.parentElement.classList.toggle("timeline-seek-enabled", els.timelineSeekToggle.checked);
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

setInterval(() => tick(false), 500);

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
    els.livePower.textContent = `${currentPower} W`;
  } else if (event.type === "cadence") {
    currentCadence = Math.round(event.data.rpm);
    els.liveCadence.textContent = `${currentCadence} rpm`;
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
  els.targetWatts.textContent = `${target.watts} W`;
  els.targetCadence.textContent = `${target.cadenceRpm} rpm`;
  els.targetPct.textContent = `${Math.round(target.ftpPct * 100)}%`;
  els.sectionLabel.textContent = target.label;
  els.guidanceText.textContent = `${target.modeLabel}: ${target.musicBpm} music BPM, ride ${target.cadenceRpm} rpm, ${target.wkg.toFixed(2)} W/kg target.`;
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

function updateAnalysis() {
  const planned = estimatePlannedWorkout(profile, controller);
  const actual = summarizeRideSamples(rideSamples, controller.ftp, rideSamples.length);
  const compliance = summarizeCompliance(rideSamples);
  const active = rideSamples.length > 0 ? actual : planned;

  els.tssEstimate.textContent = String(Math.round(active.tss));
  els.ifEstimate.textContent = active.intensityFactor.toFixed(2);

  if (rideSamples.length === 0) {
    els.analysisTitle.textContent = "Planned workout";
    els.analysisText.textContent = [
      `TSS ${Math.round(planned.tss)}`,
      `IF ${planned.intensityFactor.toFixed(2)}`,
      `avg ${Math.round(planned.avgPower)} W`,
      `weighted ${Math.round(planned.weightedPower)} W`,
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

  const pad = { left: 44, right: 10, top: 18, bottom: 22 };
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
  drawSongBands(ctx, plotLeft, plotWidth, plotArea.top, plotArea.bottom);
  drawPowerArea(ctx, plotLeft, plotWidth, plotArea, maxPower);
  drawActualSamples(ctx, plotLeft, plotWidth, plotArea, maxPower);
  drawCadenceCurve(ctx, plotLeft, plotWidth, plotArea, minCadence, maxCadence);
  drawMusicBpmCurve(ctx, plotLeft, plotWidth, plotArea, minMusicBpm, maxMusicBpm);
  drawPlayhead(ctx, plotLeft, plotWidth, plotArea.top, plotArea.bottom);
  drawHoverLine(ctx, plotLeft, plotWidth, plotArea.top, plotArea.bottom);
  drawChartLabels(ctx, width, height, plotArea, maxPower, minCadence, maxCadence, minMusicBpm, maxMusicBpm);
}

function drawSongBands(ctx, plotLeft, plotWidth, top, bottom) {
  if (!Array.isArray(profile.tracks) || profile.tracks.length === 0) {
    return;
  }
  for (const track of trackWindows()) {
    const x = timeToX(track.start_s, plotLeft, plotWidth);
    const nextX = timeToX(track.end_s, plotLeft, plotWidth);
    const gradient = ctx.createLinearGradient(x, 0, nextX, 0);
    gradient.addColorStop(0, powerColor(track.avgFtpPct, 0.20));
    gradient.addColorStop(1, powerColor(Math.min(1.2, track.avgFtpPct + 0.12), 0.42));
    ctx.fillStyle = gradient;
    ctx.fillRect(x, top, Math.max(1, nextX - x), bottom - top);
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
  const sampleText = nearest
    ? `<span>Actual: ${nearest.power} W, ${nearest.cadence} rpm (${nearest.maintained ? "maintained" : "dropped"})</span>`
    : "<span>Actual: no sample yet</span>";

  els.rideChartTooltip.innerHTML = `
    <strong>${formatTime(time)} - ${escapeHtml(target.label)}</strong>
    <span>Song: ${track ? `${track.index + 1}. ${escapeHtml(track.title)}` : "not aligned"}</span>
    <span>Target: ${target.watts} W (${Math.round(target.ftpPct * 100)}% FTP), ${target.cadenceRpm} rpm</span>
    <span>Mode: ${escapeHtml(target.modeLabel ?? "Workout")}${target.planBlock ? ` / ${escapeHtml(target.planBlock)}` : ""}</span>
    <span>Music BPM: ${target.musicBpm}</span>
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
    segment.textContent = track.title;
    segment.title = `${formatTime(track.start_s)} - ${formatTime(track.end_s)} ${track.title}`;
    segment.style.flexBasis = `${Math.max(0.25, (track.duration_s / profile.duration_s) * 100)}%`;
    segment.style.background = `linear-gradient(90deg, ${powerColor(track.avgFtpPct, 0.92)}, ${powerColor(Math.min(1.2, track.avgFtpPct + 0.12), 0.98)})`;
    els.songStrip.append(segment);
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
