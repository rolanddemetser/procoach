const DEFAULT_BASE_URL = 'https://intervals.icu/api/v1';
const DEFAULT_OLDEST = '2026-02-10';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/*
  ProCoach Cloud Run V32
  ----------------------
  Deze versie geeft één samengevoegde dagrecord per datum terug.
  Daardoor hoeft de frontend niet meer zelf te gokken tussen activity-records en wellness-records.
*/

const STEP_KEYS = [
  'wellness.steps',
  'wellness.Steps',
  'wellness.stepCount',
  'wellness.step_count',
  'wellness.totalSteps',
  'wellness.total_steps',
  'steps',
  'Steps',
  'stepCount',
  'step_count',
  'totalSteps',
  'total_steps',
  'dailySteps',
  'daily_steps'
];

const SLEEP_KEYS = [
  'sleepTime',
  'sleepSecs',
  'sleepSeconds',
  'sleepDuration',
  'sleepDurationSeconds',
  'sleep',
  'sleep_hours',
  'sleep_duration_hours',
  'sleep_seconds',
  'sleep.minutes',
  'sleep_minutes',
  'sleep.seconds',
  'sleep.duration',
  'sleep.total',
  'sleep_duration',
  'total_sleep'
];

const RHR_KEYS = [
  'restingHR',
  'restingHr',
  'resting_hr',
  'resting_heart_rate',
  'resting_heartrate',
  'rhr'
];

const BODY_BATTERY_KEYS = [
  'body_battery',
  'bodyBattery',
  'body_battery_morning',
  'morning_body_battery'
];

export async function handleGetIntervalsData(req, res, options = {}) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const requestUrl = new URL(req.url || '/', 'https://procoach.local');
    const config = readConfig(requestUrl);
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const debug = requestUrl.searchParams.get('debug') === '1';

    if (!fetchImpl) throw new Error('Fetch API is not available');
    if (!config.athleteId) throw new Error('Missing INTERVALS_ATHLETE_ID');
    if (!config.apiKey && !config.basicAuth && !config.bearerToken) {
      throw new Error('Missing Intervals authentication');
    }

    const activityUrl = buildIntervalsUrl(
      config.baseUrl,
      `/athlete/${encodeURIComponent(config.athleteId)}/activities`,
      { oldest: config.oldest, newest: config.newest }
    );

    const wellnessUrl = buildIntervalsUrl(
      config.baseUrl,
      `/athlete/${encodeURIComponent(config.athleteId)}/wellness`,
      { oldest: config.oldest, newest: config.newest }
    );

    const activitiesPayload = await fetchJson(fetchImpl, activityUrl, config);

    let wellnessPayload = [];
    let wellnessError = null;
    try {
      wellnessPayload = await fetchJson(fetchImpl, wellnessUrl, config);
    } catch (error) {
      wellnessError = error.message;
      logError('Wellness failed, continuing with activities only', { error: wellnessError });
    }

    const activities = ensureArray(activitiesPayload);
    const wellness = ensureArray(wellnessPayload);

    const days = mergeIntervalsData({ activities, wellness, debug });

    logInfo('Intervals fetch complete', {
      mode: 'daily-merged-v32',
      activitiesCount: activities.length,
      wellnessRecordsCount: wellness.length,
      daysCount: days.length,
      wellnessError
    });

    sendJson(res, 200, days);
  } catch (error) {
    logError('Intervals fetch failed', {
      error: error.message,
      stack: error.stack
    });

    sendJson(res, 500, { error: error.message });
  }
}

export function mergeIntervalsData({ activities = [], wellness = [], debug = false }) {
  const byDate = new Map();

  for (const record of wellness) {
    const date = normalDate(firstString(record, ['date', 'day', 'start_date', 'startDate', 'id']));
    if (!date) continue;

    const day = ensureDay(byDate, date);
    day._procoachKind = 'day';
    day.source = 'intervals-merged';
    day.hasWellness = true;

    const stepCandidates = extractStepCandidates(record);
    if (stepCandidates.length) {
      day.stepCandidates.push(...stepCandidates.map(c => ({
        ...c,
        recordType: 'wellness',
        recordDate: date
      })));

      const best = chooseBestStepCandidate(day.stepCandidates);
      day.steps = best.value;
      day.stepsSource = best.path;
      day.stepsRecordType = best.recordType;
    }

    const sleepHours = normalizeSleepHours(firstNumber(record, SLEEP_KEYS));
    if (sleepHours !== null) {
      day.sleepHours = sleepHours;
      day.sleep_duration = sleepHours;
      day.sleep_duration_hours = sleepHours;
    }

    const rhr = firstNumber(record, RHR_KEYS);
    if (rhr !== null) {
      day.rhr = rhr;
      day.resting_hr = rhr;
    }

    const bodyBattery = firstNumber(record, BODY_BATTERY_KEYS);
    if (bodyBattery !== null) {
      day.bodyBattery = bodyBattery;
      day.body_battery = bodyBattery;
      day.bodyBatteryMorning = hasAnyNumber(record, ['body_battery_morning', 'morning_body_battery']);
    }

    const hrv = firstNumber(record, ['hrv', 'hrvRMSSD', 'hrvRmssd', 'hrv_rmssd', 'rmssd']);
    if (hrv !== null) {
      day.hrv = hrv;
      day.hrv_rmssd = hrv;
    }

    const weight = firstNumber(record, ['weight', 'weightKg', 'weight_kg']);
    if (weight !== null) day.weight = weight;

    if (debug) {
      day.debugWellnessKeys = Object.keys(record).slice(0, 80);
      day.debugWellnessNumeric = numericSnapshot(record);
    }
  }

  for (const activity of activities) {
    const date = normalDate(firstString(activity, ['start_date_local', 'start_date', 'date', 'calendar_date', 'day']));
    if (!date) continue;

    const day = ensureDay(byDate, date);
    day._procoachKind = 'day';
    day.source = 'intervals-merged';
    day.hasActivities = true;

    const min = activityMinutes(activity);
    const name = String(firstString(activity, ['name', 'type', 'sport', 'activity_type']) || '').toLowerCase();
    const type = String(firstString(activity, ['type', 'sport', 'activity_type']) || '').toLowerCase();

    const isWalk =
      type.includes('walk') ||
      name.includes('walk') ||
      name.includes('wandel') ||
      type.includes('hike') ||
      name.includes('hike');

    const isStrength =
      type.includes('strength') ||
      name.includes('kracht') ||
      name.includes('strength') ||
      name.includes('workout');

    const isYoga =
      type.includes('yoga') ||
      name.includes('yoga') ||
      name.includes('mobiliteit') ||
      name.includes('mobility');

    if (min > 0 && isWalk && min >= 20 && min <= 180) {
      day.walkMin += min;
      day.activityMin += min;
    } else if (min > 0 && isStrength) {
      day.strengthMin += min;
      day.activityMin += min;
    } else if (min > 0 && isYoga) {
      day.yogaMin += min;
      day.activityMin += min;
    }

    const distanceKm = firstNumber(activity, ['distance', 'distance_km']);
    if (distanceKm !== null) {
      day.distanceKm += distanceKm > 1000 ? distanceKm / 1000 : distanceKm;
    }

    const load = firstNumber(activity, ['icu_training_load', 'training_load', 'load']);
    if (load !== null) day.load += load;

    if (debug) {
      if (!day.debugActivityKeys) day.debugActivityKeys = [];
      day.debugActivityKeys.push(Object.keys(activity).slice(0, 50));
    }
  }

  return Array.from(byDate.values())
    .map(finalizeDay)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function emptyDay(date) {
  return {
    date,
    start_date_local: date,
    calendar_date: date,
    day: date,
    source: 'intervals-merged',
    hasWellness: false,
    hasActivities: false,
    steps: null,
    stepsSource: '',
    stepsRecordType: '',
    stepCandidates: [],
    walkMin: 0,
    activityMin: 0,
    strengthMin: 0,
    yogaMin: 0,
    distanceKm: 0,
    load: 0,
    sleepHours: null,
    sleep_duration: null,
    sleep_duration_hours: null,
    rhr: null,
    resting_hr: null,
    bodyBattery: null,
    body_battery: null,
    bodyBatteryMorning: false
  };
}

function ensureDay(map, date) {
  if (!map.has(date)) map.set(date, emptyDay(date));
  return map.get(date);
}

function finalizeDay(day) {
  day.walkMin = Math.round(day.walkMin);
  day.activityMin = Math.round(day.activityMin);
  day.strengthMin = Math.round(day.strengthMin);
  day.yogaMin = Math.round(day.yogaMin);
  day.distanceKm = Math.round(day.distanceKm * 100) / 100;
  day.load = Math.round(day.load);
  day.stepsStatus = day.steps === null ? 'missing' : (day.steps < 9000 ? 'low' : 'ok');

  if (day.stepCandidates.length > 12) {
    day.stepCandidates = day.stepCandidates
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
  }

  return day;
}

function extractStepCandidates(record) {
  const candidates = [];

  for (const path of STEP_KEYS) {
    const value = parseFiniteNumber(valueAt(record, path));
    if (value !== null && value >= 0 && value < 100000) {
      candidates.push({ path, value });
    }
  }

  collectStepCandidates(record, '', candidates);

  const seen = new Set();
  return candidates
    .filter(c => {
      const id = `${c.path}:${c.value}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => b.value - a.value);
}

function collectStepCandidates(value, prefix, out) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (key.toLowerCase().includes('step')) {
      const n = parseFiniteNumber(child);
      if (n !== null && n >= 0 && n < 100000) {
        out.push({ path, value: n });
      }
    }

    if (child && typeof child === 'object' && !Array.isArray(child)) {
      collectStepCandidates(child, path, out);
    }
  }
}

function chooseBestStepCandidate(candidates) {
  const usable = candidates
    .filter(c => c.value !== null && Number.isFinite(c.value) && c.value >= 0 && c.value < 100000)
    .sort((a, b) => b.value - a.value);

  if (!usable.length) return { path: '', value: null, recordType: '' };

  const preferred = usable.find(c =>
    /wellness\.steps|dailySteps|daily_steps|totalSteps|total_steps|stepCount|step_count/i.test(c.path)
  );

  return preferred || usable[0];
}

export function buildIntervalsUrl(baseUrl, path, params) {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

function readConfig(requestUrl) {
  const newest = requestUrl.searchParams.get('newest') || todayIsoDate();
  const oldest =
    requestUrl.searchParams.get('oldest') ||
    process.env.INTERVALS_OLDEST ||
    daysAgoIsoDate(Number(process.env.INTERVALS_DAYS || 0), newest) ||
    DEFAULT_OLDEST;

  return {
    baseUrl: process.env.INTERVALS_BASE_URL || DEFAULT_BASE_URL,
    athleteId: cleanConfigValue(process.env.INTERVALS_ATHLETE_ID || process.env.ATHLETE_ID),
    apiKey: cleanConfigValue(process.env.INTERVALS_API_KEY || process.env.API_KEY),
    basicAuth: cleanConfigValue(process.env.INTERVALS_BASIC_AUTH || process.env.BASIC_AUTH),
    bearerToken: cleanConfigValue(process.env.INTERVALS_BEARER_TOKEN || process.env.INTERVALS_TOKEN),
    oldest,
    newest
  };
}

async function fetchJson(fetchImpl, url, config) {
  const response = await fetchImpl(url, { headers: authHeaders(config) });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Intervals API ${url.pathname} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  return text ? JSON.parse(text) : [];
}

function authHeaders(config) {
  if (config.bearerToken) {
    return { Authorization: `Bearer ${config.bearerToken}`, Accept: 'application/json' };
  }

  if (config.basicAuth) {
    const basicAuth = config.basicAuth.startsWith('Basic ')
      ? config.basicAuth
      : `Basic ${config.basicAuth}`;

    return { Authorization: basicAuth, Accept: 'application/json' };
  }

  const token = Buffer.from(`API_KEY:${config.apiKey}`, 'utf8').toString('base64');
  return { Authorization: `Basic ${token}`, Accept: 'application/json' };
}

function cleanConfigValue(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function ensureArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.activities)) return payload.activities;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.wellness)) return payload.wellness;
  if (payload && typeof payload === 'object') return [payload];
  return [];
}

function normalizeSleepHours(value) {
  if (value === null || value === undefined) return null;
  return value > 24 ? Math.round((value / 3600) * 100) / 100 : value;
}

function firstString(record, keys) {
  for (const key of keys) {
    const value = valueAt(record, key);
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstNumber(record, keys) {
  for (const key of keys) {
    const value = parseFiniteNumber(valueAt(record, key));
    if (value !== null) return value;
  }
  return null;
}

function hasAnyNumber(record, keys) {
  return keys.some(key => parseFiniteNumber(valueAt(record, key)) !== null);
}

function parseFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function valueAt(record, path) {
  if (!record || typeof record !== 'object') return undefined;

  let current = record;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

function activityMinutes(activity) {
  const raw = firstNumber(activity, ['moving_time', 'elapsed_time', 'duration', 'minutes']);
  if (raw === null) return 0;

  let mins = raw;
  if (raw > 600) mins = Math.round(raw / 60);
  if (mins > 600) return 0;

  return Math.round(mins);
}

function normalDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  const match = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }

  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

function numericSnapshot(record, prefix = '', out = []) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return out;

  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const n = parseFiniteNumber(value);

    if (n !== null) out.push({ path, value: n });

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      numericSnapshot(value, path, out);
    }
  }

  return out.slice(0, 120);
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIsoDate(days, newest) {
  if (!days || days < 1) return null;
  const base = new Date(`${newest}T00:00:00.000Z`);
  return new Date(base.getTime() - days * MS_PER_DAY).toISOString().slice(0, 10);
}

function logInfo(message, data) {
  console.log(JSON.stringify({ severity: 'INFO', message, ...data }));
}

function logError(message, data) {
  console.error(JSON.stringify({ severity: 'ERROR', message, ...data }));
}
