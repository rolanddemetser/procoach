import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeIntervalsData } from '../src/getIntervalsData.js';

test('highest plausible step total wins over partial wellness value', () => {
  const days = mergeIntervalsData({
    wellness: [{
      id: '2026-07-31',
      steps: 1718,
      custom: { DailySteps: 9071 }
    }]
  });
  assert.equal(days[0].steps, 9071);
  assert.match(days[0].stepsSource, /DailySteps/);
});

test('body battery accepts custom nested fields and highest morning value', () => {
  const days = mergeIntervalsData({
    wellness: [{
      id: '2026-08-01',
      bodyBattery: 55,
      garmin: {
        bodyBatteryValues: [55, 57, 59, 56]
      }
    }]
  });
  assert.equal(days[0].bodyBattery, 59);
  assert.equal(days[0].bodyBatteryMorning, true);
  assert.match(days[0].bodyBatterySourcePath, /bodyBatteryValues/);
});

test('missing body battery stays null rather than inventing a value', () => {
  const days = mergeIntervalsData({ wellness: [{ id: '2026-08-01', restingHR: 50 }] });
  assert.equal(days[0].bodyBattery, null);
  assert.equal(days[0].rhr, 50);
});
