import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIntervalsUrl, handleGetIntervalsData, normalizeWellnessRecord } from '../src/getIntervalsData.js';

test('builds Intervals wellness URL with oldest and newest range', () => {
  const url = buildIntervalsUrl('https://intervals.icu/api/v1/', '/athlete/123/wellness', {
    oldest: '2026-02-10',
    newest: '2026-05-29',
  });

  assert.equal(url.toString(), 'https://intervals.icu/api/v1/athlete/123/wellness?oldest=2026-02-10&newest=2026-05-29');
});

test('normalizes wellness sleep, resting HR, HRV rMSSD and weight for ProCoach', () => {
  const record = normalizeWellnessRecord({
    id: '2026-05-28',
    sleepTime: 27_000,
    restingHR: 52,
    hrv: 41,
    weight: 93.2,
    steps: 9226,
    wellness: { steps: 12420 },
  });

  assert.equal(record.date, '2026-05-28');
  assert.equal(record._procoachKind, 'wellness');
  assert.equal(record.sleepHours, 7.5);
  assert.equal(record.sleep_duration_hours, 7.5);
  assert.equal(record.rhr, 52);
  assert.equal(record.resting_hr, 52);
  assert.equal(record.hrv_rmssd, 41);
  assert.equal(record.weight, 93.2);
  assert.equal(record.steps, 12420);
});

test('handler appends normalized wellness records to unchanged activities', async () => {
  const previousEnv = { ...process.env };
  process.env.INTERVALS_ATHLETE_ID = 'athlete-1';
  process.env.INTERVALS_API_KEY = 'secret';
  process.env.INTERVALS_BASE_URL = 'https://intervals.test/api/v1';

  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url.toString());
    if (url.pathname.endsWith('/activities')) {
      return jsonResponse([{ id: 'activity-1', date: '2026-05-28', type: 'Ride' }]);
    }
    if (url.pathname.endsWith('/wellness')) {
      return jsonResponse([{ id: '2026-05-28', sleepTime: 28_800, restingHR: 50, hrv: 44, weight: 92.7, steps: 9226, wellness: { steps: '12420' } }]);
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const res = createMockResponse();
  try {
    await handleGetIntervalsData({ method: 'GET', url: '/?oldest=2026-05-01&newest=2026-05-29' }, res, { fetchImpl });
  } finally {
    process.env = previousEnv;
  }

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [
    'https://intervals.test/api/v1/athlete/athlete-1/activities?oldest=2026-05-01&newest=2026-05-29',
    'https://intervals.test/api/v1/athlete/athlete-1/wellness?oldest=2026-05-01&newest=2026-05-29',
  ]);

  const payload = JSON.parse(res.body);
  assert.equal(payload.length, 2);
  assert.equal(payload[0].id, 'activity-1');
  assert.equal(payload[1]._procoachKind, 'wellness');
  assert.equal(payload[1].sleepHours, 8);
  assert.equal(payload[1].rhr, 50);
  assert.equal(payload[1].hrv_rmssd, 44);
  assert.equal(payload[1].weight, 92.7);
  assert.equal(payload[1].steps, 12420);
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
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    writeHead(statusCode) {
      this.statusCode = statusCode;
    },
    end(body = '') {
      this.body = body;
    },
  };
}
