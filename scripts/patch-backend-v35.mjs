import fs from 'node:fs';

const path = 'cloud-run/getIntervalsData/src/getIntervalsData.js';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`Patch marker not found: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
`    const activities = ensureArray(activitiesPayload);
    const wellness = ensureArray(wellnessPayload);

    const days = mergeIntervalsData({ activities, wellness, debug });`,
`    const activities = ensureArray(activitiesPayload);
    let wellness = ensureArray(wellnessPayload);

    // The range endpoint can briefly lag behind the individual day endpoint.
    // Refresh the most recent three local dates one by one and merge only
    // defined values, so a fresh daily total can replace a stale partial total.
    const recentWellness = await fetchRecentWellnessDetails(fetchImpl, config);
    wellness = mergeWellnessRecords(wellness, recentWellness);

    const days = mergeIntervalsData({ activities, wellness, debug });`,
'fresh daily wellness merge');

replaceOnce(
`    const bodyBattery = firstNumber(record, BODY_BATTERY_KEYS);
    if (bodyBattery !== null) {
      day.bodyBattery = bodyBattery;
      day.body_battery = bodyBattery;
      day.bodyBatteryMorning = hasAnyNumber(record, ['body_battery_morning', 'morning_body_battery']);
    }`,
`    const bodyBattery = extractBodyBatteryCandidate(record);
    if (bodyBattery.value !== null) {
      day.bodyBattery = bodyBattery.value;
      day.body_battery = bodyBattery.value;
      day.bodyBatteryMorning = true;
      day.bodyBatterySourcePath = bodyBattery.path;
    }`,
'body battery extraction');

replaceOnce(
`    bodyBattery: null,
    body_battery: null,
    bodyBatteryMorning: false`,
`    bodyBattery: null,
    body_battery: null,
    bodyBatteryMorning: false,
    bodyBatterySourcePath: ''`,
'body battery source field');

replaceOnce(
`function chooseBestStepCandidate(candidates) {
  const usable = candidates
    .filter(c => c.value !== null && Number.isFinite(c.value) && c.value >= 0 && c.value < 100000)
    .sort((a, b) => b.value - a.value);

  if (!usable.length) return { path: '', value: null, recordType: '' };

  const preferred = usable.find(c =>
    /wellness\\.steps|dailySteps|daily_steps|totalSteps|total_steps|stepCount|step_count/i.test(c.path)
  );

  return preferred || usable[0];
}`,
`function chooseBestStepCandidate(candidates) {
  const usable = candidates
    .filter(c => c.value !== null && Number.isFinite(c.value) && c.value >= 0 && c.value < 100000)
    .sort((a, b) => {
      // The highest plausible daily value wins. Field-name preference is only
      // a tie-breaker; it must never allow a partial 1718 to beat a 9071 total.
      if (b.value !== a.value) return b.value - a.value;
      return stepPathPriority(b.path) - stepPathPriority(a.path);
    });

  return usable[0] || { path: '', value: null, recordType: '' };
}

function stepPathPriority(path = '') {
  return /dailySteps|daily_steps|totalSteps|total_steps|stepCount|step_count|wellness\\.steps/i.test(path) ? 2 : 1;
}`,
'step candidate selection');

const insertionMarker = `export function buildIntervalsUrl(baseUrl, path, params) {`;
if (!source.includes(insertionMarker)) throw new Error('Patch marker not found: helper insertion');
source = source.replace(insertionMarker, `async function fetchRecentWellnessDetails(fetchImpl, config) {
  const dates = recentIsoDates(config.newest || todayIsoDate(), 3);
  const records = [];

  for (const date of dates) {
    const url = buildIntervalsUrl(
      config.baseUrl,
      \`/athlete/\${encodeURIComponent(config.athleteId)}/wellness/\${date}\`,
      {}
    );
    try {
      const record = await fetchJson(fetchImpl, url, config);
      if (record && typeof record === 'object' && !Array.isArray(record)) records.push(record);
    } catch (error) {
      // A missing individual record must not make the complete sync fail.
      logInfo('Recent wellness detail unavailable', { date, error: error.message });
    }
  }

  return records;
}

function recentIsoDates(endDate, count) {
  const end = new Date(\`\${endDate}T12:00:00Z\`);
  if (Number.isNaN(end.getTime())) return [];
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(end.getTime() - index * MS_PER_DAY);
    return date.toISOString().slice(0, 10);
  });
}

function mergeWellnessRecords(rangeRecords, detailRecords) {
  const byDate = new Map();
  for (const record of [...rangeRecords, ...detailRecords]) {
    const date = normalDate(firstString(record, ['date', 'day', 'start_date', 'startDate', 'id']));
    if (!date) continue;
    const previous = byDate.get(date) || {};
    byDate.set(date, mergeDefined(previous, record));
  }
  return [...byDate.values()];
}

function mergeDefined(previous, incoming) {
  const result = { ...previous };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (value !== undefined && value !== null && value !== '') result[key] = value;
  }
  return result;
}

function extractBodyBatteryCandidate(record) {
  const candidates = [];
  for (const path of BODY_BATTERY_KEYS) {
    const value = parseFiniteNumber(valueAt(record, path));
    if (value !== null && value >= 0 && value <= 100) {
      candidates.push({ path, value, priority: /morning/i.test(path) ? 3 : 2 });
    }
  }
  collectBodyBatteryCandidates(record, '', candidates, 0);
  candidates.sort((a, b) => b.value - a.value || b.priority - a.priority);
  return candidates[0] || { path: '', value: null, priority: 0 };
}

function collectBodyBatteryCandidates(value, prefix, out, depth) {
  if (!value || typeof value !== 'object' || depth > 6) return;
  if (Array.isArray(value)) {
    value.slice(0, 300).forEach((child, index) => collectBodyBatteryCandidates(child, \`\${prefix}[\${index}]\`, out, depth + 1));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? \`\${prefix}.\${key}\` : key;
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
    if (normalized.includes('bodybattery')) {
      const number = parseFiniteNumber(child);
      if (number !== null && number >= 0 && number <= 100) {
        out.push({ path, value: number, priority: normalized.includes('morning') || normalized.includes('max') ? 3 : 1 });
      }
    }
    if (child && typeof child === 'object') collectBodyBatteryCandidates(child, path, out, depth + 1);
  }
}

export function buildIntervalsUrl(baseUrl, path, params) {`);

fs.writeFileSync(path, source);
console.log('Backend V35 patch applied.');
