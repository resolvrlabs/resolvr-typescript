import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ResolvrClient } from "../dist/esm/index.js";

const envPath = resolve(import.meta.dirname, "..", ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const settings = {
  apiKey: process.env.RESOLVR_API_KEY,
  siteKey: process.env.RESOLVR_V2_SITE_KEY,
  url: process.env.RESOLVR_V2_TARGET_URL,
  proxy: process.env.RESOLVR_PROXY,
  s: process.env.RESOLVR_V2_S,
};

const missing = Object.entries(settings)
  .filter(([name, value]) => name !== "s" && !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.error(`Missing required values: ${missing.join(", ")}`);
  console.error(
    "Set RESOLVR_API_KEY, RESOLVR_V2_SITE_KEY, RESOLVR_V2_TARGET_URL, and RESOLVR_PROXY.",
  );
  process.exit(1);
}

const resolvr = new ResolvrClient({ apiKey: settings.apiKey });

try {
  console.log("Submitting reCAPTCHA v2 task...");
  const result = await resolvr.solve({
    type: "recaptcha_v2",
    url: settings.url,
    proxy: settings.proxy,
    params: {
      siteKey: settings.siteKey,
      ...(settings.s !== undefined ? { data: { s: settings.s } } : {}),
    },
  });

  console.log("Solve completed successfully.");
  console.log(`Task: ${result.taskId}`);
  console.log(`Token received: ${result.data.token.length > 0 ? "yes" : "no"}`);
  console.log(`Execution time: ${result.timing.executionMs}ms`);
} catch (error) {
  const details =
    error && typeof error === "object" ? error : { message: String(error) };
  console.error("Solve failed.");
  console.error(`Type: ${details.name ?? "UnknownError"}`);
  console.error(`Code: ${details.code ?? "n/a"}`);
  console.error(`Message: ${details.message ?? "Unknown error"}`);
  process.exitCode = 1;
}
