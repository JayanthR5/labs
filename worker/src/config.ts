import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const envPaths = new Set<string>();
for (let directory of [process.cwd(), __dirname]) {
  while (true) {
    const envPath = resolve(directory, ".env");
    if (existsSync(envPath)) envPaths.add(envPath);
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}
for (const envPath of envPaths) {
  loadEnv({ path: envPath });
}

const required = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing worker environment variable: ${name}`);
  return value;
};

const positiveNumber = (name: string, fallback: string) => {
  const value = Number(required(name, fallback));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Worker environment variable ${name} must be positive`);
  }
  return value;
};

export const workerConfig = {
  redisUrl: required("REDIS_URL", "redis://localhost:6379"),
  elasticsearchUrl: required("ELASTICSEARCH_URL", "http://localhost:9200"),
  elasticsearchUsername: required("ELASTICSEARCH_USERNAME"),
  elasticsearchPassword: required("ELASTICSEARCH_PASSWORD"),
  concurrency: positiveNumber("WORKER_CONCURRENCY", "5"),
  minimumDelayMs: positiveNumber("EMAIL_MIN_DELAY_MS", "2000"),
  maximumEmailsPerHour: positiveNumber("MAX_EMAILS_PER_HOUR", "200"),
};