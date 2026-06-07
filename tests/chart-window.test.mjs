import assert from "node:assert/strict";
import test from "node:test";

import {
  chartWindowFor,
  customChartWindow,
  overlapsWindow,
  timeToXInWindow,
  xToTimeInWindow,
} from "../src/chart-window.js";

test("chartWindowFor returns the full duration by default", () => {
  assert.deepEqual(chartWindowFor("full", 900, 3600), {
    startS: 0,
    endS: 3600,
    durationS: 3600,
    rangeId: "full",
  });
});

test("chartWindowFor centers a zoomed window around current time", () => {
  assert.deepEqual(chartWindowFor("10m", 900, 3600), {
    startS: 600,
    endS: 1200,
    durationS: 600,
    rangeId: "10m",
  });
});

test("chartWindowFor clamps zoomed windows at ride boundaries", () => {
  assert.deepEqual(chartWindowFor("5m", 30, 3600), {
    startS: 0,
    endS: 300,
    durationS: 300,
    rangeId: "5m",
  });
  assert.deepEqual(chartWindowFor("5m", 3580, 3600), {
    startS: 3300,
    endS: 3600,
    durationS: 300,
    rangeId: "5m",
  });
});

test("customChartWindow uses explicit start and end points", () => {
  assert.deepEqual(customChartWindow(833, 1119, 3600), {
    startS: 833,
    endS: 1119,
    durationS: 286,
    rangeId: "custom",
  });
});

test("customChartWindow enforces a minimum visible range", () => {
  assert.deepEqual(customChartWindow(100, 105, 3600), {
    startS: 100,
    endS: 130,
    durationS: 30,
    rangeId: "custom",
  });
});

test("time and x mapping round-trips within the visible window", () => {
  const window = chartWindowFor("20m", 1200, 3600);
  const x = timeToXInWindow(1200, 44, 800, window);

  assert.equal(x, 444);
  assert.equal(xToTimeInWindow(x, 44, 800, window), 1200);
});

test("overlapsWindow detects clipped song strip segments", () => {
  const window = chartWindowFor("10m", 900, 3600);

  assert.equal(overlapsWindow(100, 200, window), false);
  assert.equal(overlapsWindow(650, 700, window), true);
  assert.equal(overlapsWindow(1200, 1300, window), false);
});
