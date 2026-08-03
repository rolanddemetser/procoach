import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/getIntervalsDataV37.js';
import { mergeIntervalsData } from '../src/getIntervalsDataV35.js';

test('CSV parser preserves case-sensitive custom wellness fields', () => {
  const rows = parseCsv('date,steps,Steps,BodyBatteryMax,restingHR\n2026-07-31,1718,9071,59,50\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, '2026-07-31');
  assert.equal(rows[0].steps, 1718);
  assert.equal(rows[0].Steps, 9071);
  assert.equal(rows[0].BodyBatteryMax, 59);
  assert.equal(rows[0].restingHR, 50);
});

test('V35 merger chooses full Steps total from parsed CSV', () => {
  const wellness = parseCsv('date,steps,Steps,restingHR\n2026-07-31,1718,9071,50\n');
  const days = mergeIntervalsData({ wellness });
  assert.equal(days[0].steps, 9071);
  assert.equal(days[0].rhr, 50);
});

test('CSV parser handles quoted commas and empty fields', () => {
  const rows = parseCsv('date,comments,BodyBatteryMax\n2026-08-01,"goed, rustig",\n');
  assert.equal(rows[0].comments, 'goed, rustig');
  assert.equal(rows[0].BodyBatteryMax, null);
});
