import { buildIntervalsUrl, mergeIntervalsData } from './getIntervalsDataV35.js';

const DEFAULT_BASE_URL = 'https://intervals.icu/api/v1';
const DEFAULT_OLDEST = '2026-02-10';
const MS_PER_DAY = 86400000;

// Intervals custom wellness fields are case-sensitive and are not always
// returned unless explicitly requested with `cols`.
export const WELLNESS_COLS = [
  'steps',
  'Steps',
  'stepCount',
  'totalSteps',
  'dailySteps',
  'restingHR',
  'hrv',
  'hrvSDNN',
  'sleepSecs',
  'sleepScore',
  'avgSleepingHR',
  'BodyBatteryMax',
  'BodyBatteryMin',
  'BodyBattery',
  'bodyBattery',
  'body_battery',
  'body_battery_morning',
  'morning_body_battery'
].join(',');

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

    const wellnessUrlWithCols = buildIntervalsUrl(
      config.baseUrl,
      `/athlete/${encodeURIComponent(config.athleteId)}/wellness`,
      { oldest: config.oldest, newest: config.newest, cols: WELLNESS_COLS }
    );

    const wellnessUrlFallback = buildIntervalsUrl(
      config.baseUrl,
      `/athlete/${encodeURIComponent(config.athleteId)}/wellness`,
      { oldest: config.oldest, newest: config.newest }
    );

    const activities = ensureArray(await fetchJson(fetchImpl, activityUrl, config));

    let rangeWellness = [];
    let wellnessError = null;
    let wellnessMode = 'explicit-cols';
    try {
      rangeWellness = ensureArray(await fetchJson(fetchImpl, wellnessUrlWithCols, config));
    } catch (error) {
      wellnessError = error.message;
      wellnessMode = 'fallback-default-cols';
      rangeWellness = ensureArray(await fetchJson(fetchImpl, wellnessUrlFallback, config));
    }

    const detailWellness = await fetchRecentWellnessDetails(fetchImpl, config);
    const wellness = mergeWellnessRecords(rangeWellness, detailWellness);
    const days = mergeIntervalsData({ activities, wellness, debug }).map(day => ({
      ...day,
      source: 'intervals-merged-v36',
      wellnessFetchMode: wellnessMode
    }));

    console.log(JSON.stringify({
      severity: 'INFO',
      message: 'Intervals fetch complete',
      mode: 'daily-merged-v36',
      wellnessMode,
      activitiesCount: activities.length,
      wellnessRecordsCount: wellness.length,
      detailRecordsCount: detailWellness.length,
      daysCount: days.length,
      wellnessError
    }));

    sendJson(res, 200, days);
  } catch (error) {
    console.error(JSON.stringify({
      severity: 'ERROR',
      message: 'Intervals fetch failed',
      error: error.message,
      stack: error.stack
    }));
    sendJson(res, 500, { error: error.message });
  }
}

async function fetchRecentWellnessDetails(fetchImpl, config) {
  const records = [];
  for (const date of recentIsoDates(config.newest, 7)) {
    const url = buildIntervalsUrl(
      config.baseUrl,
      `/athlete/${encodeURIComponent(config.athleteId)}/wellness/${date}`,
      { cols: WELLNESS_COLS }
    );

    try {
      const record = await fetchJson(fetchImpl, url, config);
      if (record && typeof record === 'object' && !Array.isArray(record)) {
        records.push(record);
      }
    } catch (error) {
      // Some Intervals installations ignore or reject `cols` on the single-day
      // endpoint. Retry without it before giving up.
      const fallbackUrl = buildIntervalsUrl(
        config.baseUrl,
        `/athlete/${encodeURIComponent(config.athleteId)}/wellness/${date}`,
        {}
      );
      try {
        const record = await fetchJson(fetchImpl, fallbackUrl, config);
        if (record && typeof record === 'object' && !Array.isArray(record)) {
          records.push(record);
        }
      } catch (fallbackError) {
        console.log(JSON.stringify({
          severity: 'INFO',
          message: 'Recent wellness detail unavailable',
          date,
          error: fallbackError.message
        }));
      }
    }
  }
  return records;
}

export function mergeWellnessRecords(rangeRecords, detailRecords) {
  const map = new Map();
  for (const record of [...rangeRecords, ...detailRecords]) {
    const date = normalDate(firstString(record, ['date', 'day', 'start_date', 'startDate', 'id']));
    if (!date) continue;
    map.set(date, mergeDefined(map.get(date) || {}, record));
  }
  return [...map.values()];
}

function mergeDefined(previous, incoming) {
  const result = { ...previous };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (value !== undefined && value !== null && value !== '') result[key] = value;
  }
  return result;
}

function readConfig(requestUrl) {
  const newest = requestUrl.searchParams.get('newest') || todayIsoDate();
  const oldest = requestUrl.searchParams.get('oldest')
    || process.env.INTERVALS_OLDEST
    || daysAgoIsoDate(Number(process.env.INTERVALS_DAYS || 0), newest)
    || DEFAULT_OLDEST;

  return {
    baseUrl: process.env.INTERVALS_BASE_URL || DEFAULT_BASE_URL,
    athleteId: clean(process.env.INTERVALS_ATHLETE_ID || process.env.ATHLETE_ID),
    apiKey: clean(process.env.INTERVALS_API_KEY || process.env.API_KEY),
    basicAuth: clean(process.env.INTERVALS_BASIC_AUTH || process.env.BASIC_AUTH),
    bearerToken: clean(process.env.INTERVALS_BEARER_TOKEN || process.env.INTERVALS_TOKEN),
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
  if (config.bearerToken) return { Authorization: `Bearer ${config.bearerToken}`, Accept: 'application/json' };
  if (config.basicAuth) {
    return {
      Authorization: config.basicAuth.startsWith('Basic ') ? config.basicAuth : `Basic ${config.basicAuth}`,
      Accept: 'application/json'
    };
  }
  return {
    Authorization: `Basic ${Buffer.from(`API_KEY:${config.apiKey}`, 'utf8').toString('base64')}`,
    Accept: 'application/json'
  };
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

function recentIsoDates(endDate, count) {
  const end = new Date(`${endDate}T12:00:00Z`);
  if (Number.isNaN(end.getTime())) return [];
  return Array.from({ length: count }, (_, index) =>
    new Date(end.getTime() - index * MS_PER_DAY).toISOString().slice(0, 10));
}

function firstString(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function normalDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  const match = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIsoDate(days, newest) {
  if (!Number.isFinite(days) || days <= 0) return null;
  const date = new Date(`${newest}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() - days * MS_PER_DAY).toISOString().slice(0, 10);
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
