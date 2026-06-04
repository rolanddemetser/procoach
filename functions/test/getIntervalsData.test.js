process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const test = require("node:test");
const { _test } = require("../index.js");

test("builds the Intervals wellness range endpoint", () => {
  const url = _test.buildIntervalsUrl("https://intervals.icu/api/v1/", "/athlete/123/wellness", {
    oldest: "2026-02-10",
    newest: "2026-05-29",
  });

  assert.equal(url.toString(), "https://intervals.icu/api/v1/athlete/123/wellness?oldest=2026-02-10&newest=2026-05-29");
});

test("normalizes sleep, resting HR, HRV rMSSD and weight from wellness", () => {
  const record = _test.normalizeWellnessRecord({
    id: "2026-05-28",
    sleepTime: 27000,
    restingHR: 52,
    hrv: 41,
    weight: 93.2,
    Steps: 12420,
  });

  assert.equal(record.date, "2026-05-28");
  assert.equal(record.sleepHours, 7.5);
  assert.equal(record.rhr, 52);
  assert.equal(record.hrv_rmssd, 41);
  assert.equal(record.weight, 93.2);
  assert.equal(record.steps, 12420);
});



test("handler appends normalized wellness to unchanged activities", async () => {
  const previousEnv = { ...process.env };
  process.env.INTERVALS_ATHLETE_ID = "athlete-1";
  process.env.INTERVALS_API_KEY = "secret";
  process.env.INTERVALS_BASE_URL = "https://intervals.test/api/v1";

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    calls.push(url.toString());
    if (url.pathname.endsWith("/activities")) {
      return jsonResponse([{ id: "activity-1", date: "2026-05-28", type: "Ride" }]);
    }
    if (url.pathname.endsWith("/wellness")) {
      return jsonResponse([{ id: "2026-05-28", sleepTime: 28800, restingHR: 50, hrv: 44, weight: 92.7, Steps: "12420" }]);
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const res = createMockResponse();
  try {
    await _test.getIntervalsDataHandler({ method: "GET", url: "/?oldest=2026-05-01&newest=2026-05-29" }, res);
  } finally {
    global.fetch = originalFetch;
    process.env = previousEnv;
  }

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [
    "https://intervals.test/api/v1/athlete/athlete-1/activities?oldest=2026-05-01&newest=2026-05-29",
    "https://intervals.test/api/v1/athlete/athlete-1/wellness?oldest=2026-05-01&newest=2026-05-29",
  ]);

  const payload = JSON.parse(res.body);
  assert.equal(payload.length, 2);
  assert.equal(payload[0].id, "activity-1");
  assert.equal(payload[1]._procoachKind, "wellness");
  assert.equal(payload[1].sleepHours, 8);
  assert.equal(payload[1].rhr, 50);
  assert.equal(payload[1].hrv_rmssd, 44);
  assert.equal(payload[1].weight, 92.7);
  assert.equal(payload[1].steps, 12420);
});

test("handler keeps activities working when wellness fetch fails", async () => {
  const previousEnv = { ...process.env };
  process.env.INTERVALS_ATHLETE_ID = "athlete-1";
  process.env.INTERVALS_API_KEY = "secret";
  process.env.INTERVALS_BASE_URL = "https://intervals.test/api/v1";

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (url.pathname.endsWith("/activities")) {
      return jsonResponse([{ id: "activity-1", date: "2026-05-28", type: "Ride" }]);
    }
    return {
      ok: false,
      status: 404,
      async text() {
        return "not found";
      },
    };
  };

  const res = createMockResponse();
  try {
    await _test.getIntervalsDataHandler({ method: "GET", url: "/?oldest=2026-05-01&newest=2026-05-29" }, res);
  } finally {
    global.fetch = originalFetch;
    process.env = previousEnv;
  }

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), [{ id: "activity-1", date: "2026-05-28", type: "Ride" }]);
});

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function createMockResponse() {
  return {
    headers: {},
    statusCode: null,
    body: "",
    set(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      this.body = JSON.stringify(payload);
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}
