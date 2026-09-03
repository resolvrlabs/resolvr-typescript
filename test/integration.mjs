import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ResolvrClient } from "../dist/esm/index.js";

const apiKey = process.env.RESOLVR_API_KEY;
const tasksJson = process.env.RESOLVR_INTEGRATION_TASKS_JSON;
const tasksPath = process.env.RESOLVR_INTEGRATION_TASKS_FILE;
if (!apiKey || (!tasksJson && !tasksPath)) {
  throw new Error(
    "Set RESOLVR_API_KEY and either RESOLVR_INTEGRATION_TASKS_JSON or RESOLVR_INTEGRATION_TASKS_FILE",
  );
}

const fixtures = JSON.parse(tasksJson ?? (await readFile(tasksPath, "utf8")));
const required = [
  "recaptchaV2",
  "recaptchaV3",
  "cloudflareTurnstile",
  "cloudflareBlockpage",
];
for (const name of required)
  assert.ok(fixtures[name], `Missing authorized integration task: ${name}`);

const client = new ResolvrClient({
  apiKey,
  ...(process.env.RESOLVR_BASE_URL
    ? { baseUrl: process.env.RESOLVR_BASE_URL }
    : {}),
});

for (const name of required) {
  const result = await client.solve(fixtures[name]);
  assert.equal(result.status, "completed");
  assert.equal(result.success, true);
  console.log(`${name}: completed in ${result.timing.executionMs}ms`);
}
