const isTestRuntime = process.env.NODE_ENV === "test";
const functions = isTestRuntime ? null : require("firebase-functions");
const { onRequest } = isTestRuntime ? { onRequest: null } : require("firebase-functions/v2/https");

const DEFAULT_BASE_URL = "https://intervals.icu/api/v1";
const DEFAULT_OLDEST = "2026-02-10";
const DEFAULT_REGION = "us-central1";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const STEP_KEYS = ["steps", "Steps", "stepCount", "step_count", "totalSteps", "total_steps", "dailySteps", "daily_steps", "wellness.steps", "wellness.Steps"];

async function getIntervalsDataHandler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const requestUrl = new URL(req.originalUrl || req.url || "/", "https://procoach.local");
    const config = readConfig(requestUrl);

    if (!config.athleteId) {
      throw new Error("Missing Intervals athlete id. Set INTERVALS_ATHLETE_ID or ATHLETE_ID.");
    }

    if (!config.apiKey && !config.basicAuth && !config.bearerToken) {
      throw new Error("Missing Intervals credentials. Set INTERVALS_API_KEY, API_KEY, INTERVALS_BASIC_AUTH, INTERVALS_BEARER_TOKEN or INTERVALS_TOKEN.");
    }

    const activityUrl = buildIntervalsUrl(config.baseUrl, `/athlete/${encodeURIComponent(config.athleteId)}/activities`, {
      oldest: config.oldest,
      newest: config.newest,
    });
    const wellnessUrl = buildIntervalsUrl(config.baseUrl, `/athlete/${encodeURIComponent(config.athleteId)}/wellness`, {
      oldest: config.oldest,
      newest: config.newest,
    });

    logInfo("Intervals fetch start", {
      activityEndpoint: redactUrl(activityUrl),
      wellnessEndpoint: redactUrl(wellnessUrl),
      oldest: config.oldest,
      newest: config.newest,
    });

    const [activitiesResult, wellnessResult] = await Promise.allSettled([
      fetchIntervalsJson(activityUrl, config),
      fetchIntervalsJson(wellnessUrl, config),
    ]);

    if (activitiesResult.status === "rejected") {
      throw activitiesResult.reason;
    }

    if (wellnessResult.status === "rejected") {
      logError("Intervals wellness fetch failed; returning activities only", { error: wellnessResult.reason.message });
    }

    const activities = ensureArray(activitiesResult.value);
    const wellnessRecords = wellnessResult.status === "fulfilled" ? ensureArray(wellnessResult.value) : [];
    const wellnessKeys = collectKeys(wellnessRecords);
    const normalizedWellness = wellnessRecords.map(normalizeWellnessRecord).filter(Boolean);

    logInfo("Intervals fetch complete", {
      activitiesCount: activities.length,
      wellnessRecordsCount: wellnessRecords.length,
      normalizedWellnessCount: normalizedWellness.length,
      wellnessKeys,
    });

    // Backwards compatible response shape: existing ProCoach sync expects a top-level array.
    // Activity objects are kept unchanged; wellness/vitals records are appended as extra day items.
    res.status(200).json([...activities, ...normalizedWellness]);
  } catch (error) {
    logError("Intervals fetch failed", { error: error.message });
    res.status(500).json({ error: error.message });
  }
}

function readConfig(requestUrl) {
  const newest = requestUrl.searchParams.get("newest") || todayIsoDate();
  const oldest = requestUrl.searchParams.get("oldest") || env("INTERVALS_OLDEST") || daysAgoIsoDate(Number(env("INTERVALS_DAYS") || 0), newest) || DEFAULT_OLDEST;

  return {
    baseUrl: configValue("INTERVALS_BASE_URL", ["intervals", "base_url"]) || DEFAULT_BASE_URL,
    athleteId: configValue("INTERVALS_ATHLETE_ID", ["intervals", "athlete_id"]) || env("ATHLETE_ID") || env("INTERVALS_ATHLETE"),
    apiKey: configValue("INTERVALS_API_KEY", ["intervals", "api_key"]) || env("API_KEY") || env("INTERVALS_KEY"),
    basicAuth: configValue("INTERVALS_BASIC_AUTH", ["intervals", "basic_auth"]) || env("BASIC_AUTH"),
    bearerToken: configValue("INTERVALS_BEARER_TOKEN", ["intervals", "bearer_token"]) || env("INTERVALS_TOKEN"),
    oldest,
    newest,
  };
}

async function fetchIntervalsJson(url, config) {
  const response = await fetch(url, { headers: authHeaders(config) });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Intervals API ${url.pathname} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  return text ? JSON.parse(text) : [];
}

function normalizeWellnessRecord(record) {
  if (!record || typeof record !== "object") return null;

  const date = firstString(record, ["id", "date", "day", "start_date", "startDate"]);
  if (!date) return null;

  const sleepHours = normalizeSleepHours(firstNumber(record, [
    "sleepTime",
    "sleepSecs",
    "sleepSeconds",
    "sleepDuration",
    "sleepDurationSeconds",
    "sleep",
  ]));
  const restingHr = firstNumber(record, ["restingHR", "restingHr", "resting_hr", "resting_heart_rate", "resting_heartrate", "rhr"]);
  const hrvRmssd = firstNumber(record, ["hrv", "hrvRMSSD", "hrvRmssd", "hrv_rmssd", "rmssd"]);
  const weight = firstNumber(record, ["weight", "weightKg", "weight_kg"]);
  const steps = firstNumber(record, STEP_KEYS);

  return {
    ...record,
    _procoachKind: "wellness",
    date: date.slice(0, 10),
    wellness: record,
    sleepHours,
    sleep_duration: sleepHours,
    sleep_duration_hours: sleepHours,
    rhr: restingHr,
    resting_hr: restingHr,
    hrv: hrvRmssd,
    hrv_rmssd: hrvRmssd,
    weight,
    steps,
  };
}

function buildIntervalsUrl(baseUrl, path, params) {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  return url;
}

function authHeaders(config) {
  if (config.bearerToken) {
    return { Authorization: `Bearer ${config.bearerToken}`, Accept: "application/json" };
  }

  if (config.basicAuth) {
    return { Authorization: `Basic ${config.basicAuth}`, Accept: "application/json" };
  }

  const token = Buffer.from(`API_KEY:${config.apiKey}`, "utf8").toString("base64");
  return { Authorization: `Basic ${token}`, Accept: "application/json" };
}

function ensureArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.activities)) return payload.activities;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.wellness)) return payload.wellness;
  if (payload && typeof payload === "object") return [payload];
  return [];
}

function normalizeSleepHours(value) {
  if (value === null || value === undefined) return null;
  return value > 24 ? Math.round((value / 3600) * 100) / 100 : value;
}

function firstString(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

function firstNumber(record, keys) {
  for (const key of keys) {
    const value = valueAt(record, key);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function valueAt(record, path) {
  if (!record || typeof record !== "object") return undefined;

  let current = record;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function collectKeys(items) {
  return [...new Set(items.flatMap((item) => item && typeof item === "object" ? Object.keys(item) : []))].sort();
}

function setCorsHeaders(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Cache-Control", "no-store");
}

function env(name) {
  return process.env[name];
}

function configValue(envName, configPath) {
  if (process.env[envName]) return process.env[envName];
  if (!functions || typeof functions.config !== "function") return undefined;

  const root = functions.config();
  return configPath.reduce((current, key) => current && current[key], root);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIsoDate(days, newest) {
  if (!days || days < 1) return null;
  const base = new Date(`${newest}T00:00:00.000Z`);
  return new Date(base.getTime() - days * MS_PER_DAY).toISOString().slice(0, 10);
}

function redactUrl(url) {
  return `${url.origin}${url.pathname}?${url.searchParams.toString()}`;
}

function logInfo(message, data) {
  console.log(JSON.stringify({ severity: "INFO", message, ...data }));
}

function logError(message, data) {
  console.error(JSON.stringify({ severity: "ERROR", message, ...data }));
}

function makeHttpsFunction(handler) {
  if (process.env.FUNCTIONS_GEN === "2") {
    return onRequest({ region: env("FUNCTION_REGION") || DEFAULT_REGION, cors: true }, handler);
  }

  return functions
    .region(env("FUNCTION_REGION") || DEFAULT_REGION)
    .runWith({ timeoutSeconds: 60, memory: "256MB" })
    .https.onRequest(handler);
}

exports.getIntervalsData = isTestRuntime ? getIntervalsDataHandler : makeHttpsFunction(getIntervalsDataHandler);

exports._test = {
  buildIntervalsUrl,
  getIntervalsDataHandler,
  normalizeWellnessRecord,
};
