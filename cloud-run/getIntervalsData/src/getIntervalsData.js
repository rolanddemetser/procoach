const DEFAULT_BASE_URL = 'https://intervals.icu/api/v1';
const DEFAULT_OLDEST = '2026-02-10';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const STEP_KEYS = [
  'steps','Steps','stepCount','step_count',
  'totalSteps','total_steps','dailySteps','daily_steps',
  'wellness.steps','wellness.Steps'
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

    let activities = [];
    let wellness = [];
    let wellnessError = null;

    activities = await fetchJson(fetchImpl, activityUrl, config);

    try {
      wellness = await fetchJson(fetchImpl, wellnessUrl, config);
    } catch (error) {
      wellnessError = error.message;
      logError('Wellness failed, continuing with activities only', {
        error: wellnessError
      });
    }

    const activityItems = ensureArray(activities);
    const wellnessItems = ensureArray(wellness);
    const normalizedWellness = wellnessItems
      .map(normalizeWellnessRecord)
      .filter(Boolean);

    const combined = [...activityItems, ...normalizedWellness];

    logInfo('Intervals fetch complete', {
      activitiesCount: activityItems.length,
      wellnessRecordsCount: wellnessItems.length,
      normalizedWellnessCount: normalizedWellness.length,
      totalCount: combined.length,
      wellnessError
    });

    sendJson(res, 200, combined);
  } catch (error) {
    logError('Intervals fetch failed', {
      error: error.message,
      stack: error.stack
    });

    sendJson(res, 500, {
      error: error.message
    });
  }
}

export function normalizeWellnessRecord(record) {
  if (!record || typeof record !== 'object') return null;

  const date = firstString(record, ['id', 'date', 'day', 'start_date', 'startDate']);
  if (!date) return null;

  const sleepHours = normalizeSleepHours(firstNumber(record, [
    'sleepTime',
    'sleepSecs',
    'sleepSeconds',
    'sleepDuration',
    'sleepDurationSeconds',
    'sleep'
  ]));

  const restingHR = firstNumber(record, [
    'restingHR',
    'restingHr',
    'resting_hr',
    'resting_heart_rate',
    'rhr'
  ]);

  const hrvRmssd = firstNumber(record, [
    'hrv',
    'hrvRMSSD',
    'hrvRmssd',
    'hrv_rmssd',
    'rmssd'
  ]);

  const weight = firstNumber(record, ['weight', 'weightKg', 'weight_kg']);
  const steps = maxNumber(record, STEP_KEYS);

  return {
    ...record,
    _procoachKind: 'wellness',
    date: date.slice(0, 10),
    wellness: record,
    sleepHours,
    sleep_duration: sleepHours,
    sleep_duration_hours: sleepHours,
    rhr: restingHR,
    resting_hr: restingHR,
    hrv: hrvRmssd,
    hrv_rmssd: hrvRmssd,
    weight,
    steps
  };
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
  const response = await fetchImpl(url, {
    headers: authHeaders(config)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Intervals API ${url.pathname} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  return text ? JSON.parse(text) : [];
}

function authHeaders(config) {
  if (config.bearerToken) {
    return {
      Authorization: `Bearer ${config.bearerToken}`,
      Accept: 'application/json'
    };
  }

  if (config.basicAuth) {
    const basicAuth = config.basicAuth.startsWith('Basic ')
      ? config.basicAuth
      : `Basic ${config.basicAuth}`;

    return {
      Authorization: basicAuth,
      Accept: 'application/json'
    };
  }

  const token = Buffer.from(`API_KEY:${config.apiKey}`, 'utf8').toString('base64');

  return {
    Authorization: `Basic ${token}`,
    Accept: 'application/json'
  };
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
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

function firstNumber(record, keys) {
  for (const key of keys) {
    const value = valueAt(record, key);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function maxNumber(record, keys) {
  const values = keys
    .map(key => valueAt(record, key))
    .map(parseFiniteNumber)
    .filter(value => value !== null);

  return values.length ? Math.max(...values) : null;
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

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8'
  });
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
  console.log(JSON.stringify({
    severity: 'INFO',
    message,
    ...data
  }));
}

function logError(message, data) {
  console.error(JSON.stringify({
    severity: 'ERROR',
    message,
    ...data
  }));
}
