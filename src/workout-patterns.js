export const workoutModes = [
  {
    id: "raw_feel",
    label: "Raw Feel",
    description: "Follow the manually authored music-first concert map.",
  },
  {
    id: "aerobic_builder",
    label: "Aerobic Builder",
    description: "Sports-backed endurance ride using the concert as a loose guide.",
  },
  {
    id: "tempo_intervals",
    label: "Tempo Intervals",
    description: "Warmup, tempo blocks, endurance recoveries, and cooldown.",
  },
];

export const workoutPatternLibrary = {
  zones: [
    { id: "recovery", label: "Recovery", minPct: 0.40, maxPct: 0.55, cadence: [75, 85] },
    { id: "endurance", label: "Endurance", minPct: 0.56, maxPct: 0.75, cadence: [82, 92] },
    { id: "tempo", label: "Tempo", minPct: 0.76, maxPct: 0.90, cadence: [88, 98] },
    { id: "threshold", label: "Threshold", minPct: 0.91, maxPct: 1.05, cadence: [92, 102] },
    { id: "vo2", label: "VO2 Max", minPct: 1.06, maxPct: 1.20, cadence: [96, 108] },
  ],
  rules: [
    "Use 10-20 minutes of progressive warmup before high intensity.",
    "Prefer endurance/tempo volume for long concert-length rides.",
    "Limit VO2 work to short blocks with real recovery.",
    "Use cadence to shape feel, not to mirror every beat exactly.",
    "Cool down progressively after late hard work.",
  ],
  sources: [
    {
      name: "British Cycling",
      url: "https://www.britishcycling.org.uk/knowledge/training/understand-training/article/izn20140115-Intermediate-Warming-Up-and-Cooling-Down-0",
      note: "Warmups/cooldowns scale with intensity; many rides use 10-20 minutes to build gradually.",
    },
    {
      name: "TrainerRoad power zones",
      url: "https://support.trainerroad.com/hc/en-us/articles/115005942786-Understanding-Power-Zones",
      note: "FTP-based zones: endurance, tempo, threshold, VO2 Max, and active recovery.",
    },
    {
      name: "TrainerRoad interval examples",
      url: "https://www.trainerroad.com/blog/interval-training-for-cyclists-interval-types-how-to-use-them/",
      note: "Structured interval workouts pair work intervals with recovery to target specific adaptations.",
    },
  ],
};

export function structuredTargetAt(rawTarget, timeS, durationS, modeId, options = {}) {
  if (modeId === "raw_feel") {
    return { ...rawTarget, modeLabel: "Raw Feel" };
  }

  const warmupS = Math.max(300, Number(options.warmupMinutes ?? 15) * 60);
  const cooldownS = Math.max(300, Math.min(900, durationS * 0.10));
  const remainingS = Math.max(1, durationS - warmupS - cooldownS);
  const workoutT = timeS - warmupS;
  let plan;

  if (timeS < warmupS) {
    const progress = clamp(timeS / warmupS, 0, 1);
    return {
      ...rawTarget,
      ftpPct: lerp(0.45, 0.70, smoothstep(progress)),
      cadenceRpm: Math.round(lerp(78, 90, progress)),
      label: "Sports warmup",
      modeLabel: modeLabel(modeId),
      planBlock: "Warmup",
    };
  }

  if (timeS >= durationS - cooldownS) {
    const progress = clamp((timeS - (durationS - cooldownS)) / cooldownS, 0, 1);
    return {
      ...rawTarget,
      ftpPct: lerp(0.65, 0.45, smoothstep(progress)),
      cadenceRpm: Math.round(lerp(86, 76, progress)),
      label: "Cooldown",
      modeLabel: modeLabel(modeId),
      planBlock: "Cooldown",
    };
  }

  if (modeId === "tempo_intervals") {
    plan = tempoIntervals(workoutT, remainingS, rawTarget);
  } else {
    plan = aerobicBuilder(workoutT, remainingS, rawTarget);
  }

  return {
    ...rawTarget,
    ...plan,
    modeLabel: modeLabel(modeId),
  };
}

function aerobicBuilder(workoutT, remainingS, rawTarget) {
  const phase = clamp(workoutT / remainingS, 0, 1);
  const musicLift = clamp((rawTarget.ftpPct - 0.75) * 0.30, -0.04, 0.08);
  if (phase < 0.50) {
    return {
      ftpPct: clamp(0.66 + musicLift, 0.58, 0.76),
      cadenceRpm: clampCadence(rawTarget.cadenceRpm, 84, 92),
      label: "Endurance builder",
      planBlock: "Endurance",
    };
  }
  if (phase < 0.82) {
    return {
      ftpPct: clamp(0.78 + musicLift, 0.72, 0.88),
      cadenceRpm: clampCadence(rawTarget.cadenceRpm, 88, 98),
      label: "Tempo builder",
      planBlock: "Tempo",
    };
  }
  return {
    ftpPct: clamp(0.62 + musicLift, 0.55, 0.72),
    cadenceRpm: clampCadence(rawTarget.cadenceRpm, 82, 90),
    label: "Endurance reset",
    planBlock: "Endurance reset",
  };
}

function tempoIntervals(workoutT, _remainingS, rawTarget) {
  const cycleS = 16 * 60;
  const position = workoutT % cycleS;
  const musicLift = clamp((rawTarget.ftpPct - 0.80) * 0.25, -0.03, 0.06);
  if (position < 8 * 60) {
    return {
      ftpPct: clamp(0.84 + musicLift, 0.78, 0.92),
      cadenceRpm: clampCadence(rawTarget.cadenceRpm, 88, 98),
      label: "Tempo interval",
      planBlock: "Tempo work",
    };
  }
  if (position < 12 * 60) {
    return {
      ftpPct: clamp(0.62 + musicLift, 0.55, 0.70),
      cadenceRpm: clampCadence(rawTarget.cadenceRpm, 82, 90),
      label: "Endurance recovery",
      planBlock: "Recovery",
    };
  }
  return {
    ftpPct: clamp(0.90 + musicLift, 0.84, 1.00),
    cadenceRpm: clampCadence(rawTarget.cadenceRpm, 92, 102),
    label: "Sweet spot finish",
    planBlock: "Sweet spot",
  };
}

function modeLabel(modeId) {
  return workoutModes.find((mode) => mode.id === modeId)?.label ?? "Workout";
}

function clampCadence(value, min, max) {
  return Math.round(clamp(value, min, max));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
