import { buildIntervalsUrl, mergeIntervalsData } from './getIntervalsDataV35.js';
import { WELLNESS_COLS } from './getIntervalsDataV36.js';
import { parseCsv } from './getIntervalsDataV37.js';

const DEFAULT_BASE_URL = 'https://intervals.icu/api/v1';
const DEFAULT_OLDEST = '2026-02-10';

export async function handleGetIntervalsData(req, res, options = {}) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'GET') { sendJson(res, 405, { error: 'Method not allowed' }); return; }

  try {
    const requestUrl = new URL(req.url || '/', 'https://procoach.local');
    const config = readConfig(requestUrl);
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const debug = requestUrl.searchParams.get('debug') === '1';

    if (!fetchImpl) throw new Error('Fetch API is not available');
    if (!config.athleteId) throw new Error('Missing INTERVALS_ATHLETE_ID');
    if (!config.apiKey && !config.basicAuth && !config.bearerToken) throw new Error('Missing Intervals authentication');

    const activityUrl = buildIntervalsUrl(config.baseUrl, `/athlete/${encodeURIComponent(config.athleteId)}/activities`, { oldest: config.oldest, newest: config.newest });
    const wellnessCsvUrl = buildIntervalsUrl(config.baseUrl, `/athlete/${encodeURIComponent(config.athleteId)}/wellness.csv`, { oldest: config.oldest, newest: config.newest, cols: WELLNESS_COLS });
    const wellnessJsonUrl = buildIntervalsUrl(config.baseUrl, `/athlete/${encodeURIComponent(config.athleteId)}/wellness`, { oldest: config.oldest, newest: config.newest });

    const activities = ensureArray(await fetchJson(fetchImpl, activityUrl, config));
    let wellness = [];
    let wellnessFetchMode = 'csv-explicit-cols';
    let wellnessDiagnostic = null;

    try {
      const csvResult = await fetchTextDetailed(fetchImpl, wellnessCsvUrl, config);
      wellness = parseCsv(csvResult.text);
      if (!wellness.length) throw diagnosticError('Wellness CSV returned no rows', csvResult, wellnessCsvUrl);
      wellnessDiagnostic = summarizeSuccess(csvResult, wellnessCsvUrl, wellness.length);
    } catch (error) {
      wellnessFetchMode = 'json-fallback';
      wellnessDiagnostic = normalizeDiagnostic(error, wellnessCsvUrl);
      wellness = ensureArray(await fetchJson(fetchImpl, wellnessJsonUrl, config));
    }

    const days = mergeIntervalsData({ activities, wellness, debug }).map(day => ({
      ...day,
      source: 'intervals-merged-v38',
      wellnessFetchMode,
      ...(debug ? { wellnessDiagnostic } : {})
    }));

    console.log(JSON.stringify({ severity: wellnessFetchMode === 'csv-explicit-cols' ? 'INFO' : 'WARNING', message: 'Intervals fetch complete', mode: 'daily-merged-v38', wellnessFetchMode, activitiesCount: activities.length, wellnessRecordsCount: wellness.length, daysCount: days.length, wellnessDiagnostic }));
    sendJson(res, 200, days);
  } catch (error) {
    console.error(JSON.stringify({ severity: 'ERROR', message: 'Intervals fetch failed', error: error.message, stack: error.stack }));
    sendJson(res, 500, { error: error.message });
  }
}

function diagnosticError(message, result, url) {
  const error = new Error(message);
  error.diagnostic = summarizeResponse(result, url);
  return error;
}

function normalizeDiagnostic(error, url) {
  return { mode: 'csv-failed', message: error.message, requestPath: requestPath(url), ...(error.diagnostic || {}) };
}

function summarizeSuccess(result, url, rows) {
  return { mode: 'csv-success', ...summarizeResponse(result, url), rows };
}

function summarizeResponse(result, url) {
  return {
    ok: result.ok,
    status: result.status,
    statusText: result.statusText,
    contentType: result.contentType,
    responseLength: result.text.length,
    responsePreview: safePreview(result.text),
    requestPath: requestPath(url)
  };
}

function requestPath(url) { return `${url.pathname}${url.search}`; }
function safePreview(text) { return String(text || '').replace(/[\r\n]+/g, ' ').slice(0, 240); }

function readConfig(requestUrl) {
  const newest = requestUrl.searchParams.get('newest') || new Date().toISOString().slice(0, 10);
  return {
    baseUrl: process.env.INTERVALS_BASE_URL || DEFAULT_BASE_URL,
    athleteId: clean(process.env.INTERVALS_ATHLETE_ID || process.env.ATHLETE_ID),
    apiKey: clean(process.env.INTERVALS_API_KEY || process.env.API_KEY),
    basicAuth: clean(process.env.INTERVALS_BASIC_AUTH || process.env.BASIC_AUTH),
    bearerToken: clean(process.env.INTERVALS_BEARER_TOKEN || process.env.INTERVALS_TOKEN),
    oldest: requestUrl.searchParams.get('oldest') || process.env.INTERVALS_OLDEST || DEFAULT_OLDEST,
    newest
  };
}

async function fetchJson(fetchImpl, url, config) {
  const result = await fetchTextDetailed(fetchImpl, url, config);
  return result.text ? JSON.parse(result.text) : [];
}

async function fetchTextDetailed(fetchImpl, url, config) {
  const response = await fetchImpl(url, { headers: authHeaders(config) });
  const text = await response.text();
  const result = { ok: response.ok, status: response.status, statusText: response.statusText || '', contentType: response.headers?.get?.('content-type') || '', text };
  if (!response.ok) {
    const error = new Error(`Intervals API ${url.pathname} returned HTTP ${result.status}: ${safePreview(result.text)}`);
    error.diagnostic = summarizeResponse(result, url);
    throw error;
  }
  return result;
}

function authHeaders(config) {
  if (config.bearerToken) return { Authorization: `Bearer ${config.bearerToken}`, Accept: '*/*' };
  if (config.basicAuth) return { Authorization: config.basicAuth.startsWith('Basic ') ? config.basicAuth : `Basic ${config.basicAuth}`, Accept: '*/*' };
  return { Authorization: `Basic ${Buffer.from(`API_KEY:${config.apiKey}`, 'utf8').toString('base64')}`, Accept: '*/*' };
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

function clean(value) { return typeof value === 'string' ? value.trim() : value; }
function setCorsHeaders(res) { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.setHeader('Cache-Control', 'no-store'); }
function sendJson(res, status, payload) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); }
