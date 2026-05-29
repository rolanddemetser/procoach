const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

const INTERVALS_API_BASE = "https://intervals.icu/api/v1";
const ATHLETE_ID = process.env.INTERVALS_ATHLETE_ID || "i60867";
const API_KEY = process.env.INTERVALS_API_KEY;
const LOOKBACK_DAYS = Number(process.env.INTERVALS_LOOKBACK_DAYS || 14);

function setCorsHeaders(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function dateString(date) {
  return date.toISOString().slice(0, 10);
}

function range() {
  const newest = new Date();
  const oldest = new Date(newest);
  oldest.setDate(oldest.getDate() - LOOKBACK_DAYS);
  return { oldest: dateString(oldest), newest: dateString(newest) };
}

async function intervalsFetch(path, params = {}) {
  if (!API_KEY) {
    throw new Error("Missing INTERVALS_API_KEY environment variable");
  }

  const url = new URL(`${INTERVALS_API_BASE}/athlete/${ATHLETE_ID}/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`API_KEY:${API_KEY}`).toString("base64")}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Intervals ${path} failed with HTTP ${response.status}`);
  }

  return response.json();
}

exports.getIntervalsData = onRequest(
  { region: "us-central1", cors: true },
  async (req, res) => {
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
      const { oldest, newest } = range();
      const [activities, wellness] = await Promise.all([
        intervalsFetch("activities", { oldest, newest }),
        intervalsFetch("wellness", { oldest, newest }),
      ]);

      res.status(200).json([...activities, ...wellness]);
    } catch (error) {
      logger.error("getIntervalsData failed", error);
      res.status(500).json({ error: error.message || "Intervals sync failed" });
    }
  }
);
