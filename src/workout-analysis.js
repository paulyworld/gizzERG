export function estimatePlannedWorkout(profile, controller, stepS = 15) {
  const samples = [];
  for (let time = 0; time <= profile.duration_s; time += stepS) {
    const target = controller.targetAt(time);
    samples.push({
      time,
      watts: target.watts,
      ftpPct: target.ftpPct,
      cadence: target.cadenceRpm,
    });
  }
  return summarizePowerSamples(samples, controller.ftp, profile.duration_s);
}

export function summarizeRideSamples(rideSamples, ftp, fallbackDurationS = 0) {
  const samples = rideSamples
    .filter((sample) => Number.isFinite(sample.power) && sample.power > 0)
    .map((sample) => ({ time: sample.time, watts: sample.power }));
  if (samples.length === 0) {
    return emptySummary(fallbackDurationS);
  }
  const first = samples[0].time;
  const last = samples[samples.length - 1].time;
  const durationS = Math.max(fallbackDurationS, last - first + 1);
  return summarizePowerSamples(samples, ftp, durationS);
}

export function summarizeCompliance(rideSamples) {
  if (rideSamples.length === 0) {
    return {
      sampleCount: 0,
      maintainedPct: 0,
      powerMaintainedPct: 0,
      cadenceMaintainedPct: 0,
      avgPowerDelta: 0,
      avgCadenceDelta: 0,
    };
  }
  let maintained = 0;
  let powerMaintained = 0;
  let cadenceMaintained = 0;
  let powerDelta = 0;
  let cadenceDelta = 0;

  for (const sample of rideSamples) {
    const powerOk = sample.power >= sample.targetPower * 0.95;
    const cadenceOk = sample.cadence >= sample.targetCadence - 5;
    if (powerOk && cadenceOk) {
      maintained += 1;
    }
    if (powerOk) {
      powerMaintained += 1;
    }
    if (cadenceOk) {
      cadenceMaintained += 1;
    }
    powerDelta += sample.power - sample.targetPower;
    cadenceDelta += sample.cadence - sample.targetCadence;
  }

  const count = rideSamples.length;
  return {
    sampleCount: count,
    maintainedPct: maintained / count,
    powerMaintainedPct: powerMaintained / count,
    cadenceMaintainedPct: cadenceMaintained / count,
    avgPowerDelta: powerDelta / count,
    avgCadenceDelta: cadenceDelta / count,
  };
}

function summarizePowerSamples(samples, ftp, durationS) {
  if (samples.length === 0 || ftp <= 0 || durationS <= 0) {
    return emptySummary(durationS);
  }
  const avgPower = average(samples.map((sample) => sample.watts));
  const weightedPower = Math.pow(average(samples.map((sample) => Math.pow(sample.watts, 4))), 0.25);
  const intensityFactor = weightedPower / ftp;
  const tss = (durationS / 3600) * intensityFactor * intensityFactor * 100;
  const avgFtpPct = avgPower / ftp;

  return {
    durationS,
    avgPower,
    weightedPower,
    intensityFactor,
    tss,
    avgFtpPct,
  };
}

function emptySummary(durationS) {
  return {
    durationS,
    avgPower: 0,
    weightedPower: 0,
    intensityFactor: 0,
    tss: 0,
    avgFtpPct: 0,
  };
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
