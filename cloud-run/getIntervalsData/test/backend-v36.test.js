import test from 'node:test';
import assert from 'node:assert/strict';
import { handleGetIntervalsData, WELLNESS_COLS } from '../src/getIntervalsDataV36.js';

function makeResponse() {
  return {
    statusCode: null,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) { this.statusCode = status; Object.assign(this.headers, headers); },
    end(body = '') { this.body = body; }
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); }
  };
}

test('V36 explicitly requests case-sensitive custom wellness fields', async () => {
  const requested = [];
  const fetchImpl = async url => {
    requested.push(String(url));
    if (String(url).includes('/activities')) return jsonResponse([]);
    if (String(url).includes('/wellness/2026-08-01')) {
      return jsonResponse({ id: '2026-08-01', steps: 1718, Steps: 9071, BodyBatteryMax: 59, restingHR: 50 });
    }
    if (String(url).includes('/wellness/')) return jsonResponse({ id: '2026-07-31', steps: 1000 });
    return jsonResponse([{ id: '2026-08-01', steps: 1718, Steps: 9071, BodyBatteryMax: 59, restingHR: 50 }]);
  };

  const req = { method: 'GET', url: '/?oldest=2026-08-01&newest=2026-08-01&debug=1' };
  const res = makeResponse();

  await handleGetIntervalsData(req, res, { fetchImpl });

  assert.equal(res.statusCode, 200);
  const wellnessListUrl = requested.find(url => url.includes('/wellness?'));
  assert.ok(wellnessListUrl, 'wellness list request missing');
  assert.match(wellnessListUrl, /cols=/);
  assert.ok(decodeURIComponent(wellnessListUrl).includes('Steps'));
  assert.ok(decodeURIComponent(wellnessListUrl).includes('BodyBatteryMax'));
  assert.ok(WELLNESS_COLS.includes('Steps'));
  assert.ok(WELLNESS_COLS.includes('BodyBatteryMax'));
});

test('V36 chooses 9071 over partial 1718 and BodyBatteryMax 59', async () => {
  const fetchImpl = async url => {
    const text = String(url);
    if (text.includes('/activities')) return jsonResponse([]);
    if (text.includes('/wellness/2026-08-01')) {
      return jsonResponse({ id: '2026-08-01', steps: 1718, Steps: 9071, BodyBatteryMax: 59, restingHR: 50 });
    }
    if (text.includes('/wellness/')) return jsonResponse({ id: text.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '2026-08-01' });
    return jsonResponse([{ id: '2026-08-01', steps: 1718, Steps: 9071, BodyBatteryMax: 59, restingHR: 50 }]);
  };

  const req = { method: 'GET', url: '/?oldest=2026-08-01&newest=2026-08-01' };
  const res = makeResponse();
  await handleGetIntervalsData(req, res, { fetchImpl });

  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  const day = payload.find(item => item.date === '2026-08-01');
  assert.equal(day.source, 'intervals-merged-v36');
  assert.equal(day.steps, 9071);
  assert.equal(day.stepsSource, 'Steps');
  assert.equal(day.bodyBattery, 59);
  assert.equal(day.bodyBatterySourcePath, 'BodyBatteryMax');
  assert.equal(day.rhr, 50);
});

test('V36 falls back safely when explicit cols are rejected', async () => {
  let rejected = false;
  const fetchImpl = async url => {
    const text = String(url);
    if (text.includes('/activities')) return jsonResponse([]);
    if (text.includes('/wellness?') && text.includes('cols=')) {
      rejected = true;
      return jsonResponse({ error: 'unknown custom field' }, 400);
    }
    if (text.includes('/wellness/')) return jsonResponse({ id: text.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '2026-08-01' });
    return jsonResponse([{ id: '2026-08-01', steps: 1233, restingHR: 50 }]);
  };

  const req = { method: 'GET', url: '/?oldest=2026-08-01&newest=2026-08-01' };
  const res = makeResponse();
  await handleGetIntervalsData(req, res, { fetchImpl });

  assert.equal(rejected, true);
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  const day = payload.find(item => item.date === '2026-08-01');
  assert.equal(day.steps, 1233);
  assert.equal(day.wellnessFetchMode, 'fallback-default-cols');
});
