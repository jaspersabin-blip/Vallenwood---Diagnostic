import crypto from "crypto";
import { createClient } from "redis";

let clientPromise = null;

async function getRedisClient() {
  if (!clientPromise) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error("Missing REDIS_URL");
    }

    const client = createClient({ url });
    client.on("error", (err) => {
      console.error("[redis] Client error:", err);
    });

    clientPromise = client.connect().then(() => client);
  }

  return clientPromise;
}

export function makeReportId() {
  return crypto.randomBytes(16).toString("hex");
}

export async function saveReport(reportId, reportData) {
  const client = await getRedisClient();
  await client.set(`report:${reportId}`, JSON.stringify(reportData), {
    EX: 60 * 60 * 24 * 30,
  });
}

export async function getReport(reportId) {
  const client = await getRedisClient();
  const raw = await client.get(`report:${reportId}`);
  return raw ? JSON.parse(raw) : null;
}