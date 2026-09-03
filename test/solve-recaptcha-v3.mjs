import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ResolvrClient } from "../dist/esm/index.js";

const envPath = resolve(import.meta.dirname, "..", ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const settings = {
  apiKey: process.env.RESOLVR_API_KEY,
  siteKey: process.env.RESOLVR_SITE_KEY,
  url: process.env.RESOLVR_TARGET_URL,
  proxy: process.env.RESOLVR_PROXY,
  action: process.env.RESOLVR_ACTION,
};

const missing = Object.entries(settings)
  .filter(([name, value]) => name !== "action" && !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.error(`Missing required values: ${missing.join(", ")}`);
  console.error(
    "Set RESOLVR_API_KEY, RESOLVR_SITE_KEY, RESOLVR_TARGET_URL, and RESOLVR_PROXY.",
  );
  process.exit(1);
}

const resolvr = new ResolvrClient({ apiKey: settings.apiKey });

try {
  console.log("Submitting reCAPTCHA v3 task...");
  const result = await resolvr.solve({
    type: "recaptcha_v3",
    url: settings.url,
    proxy: settings.proxy,
    params: {
      siteKey: settings.siteKey,
      ...(settings.action ? { data: { action: settings.action } } : {}),
    },
  });

  console.log("Solve completed successfully.");
  console.log(`Task: ${result.taskId}`);
  console.log(`Token received: ${result.data.token.length > 0 ? "yes" : "no"}`);
  console.log(`Execution time: ${result.timing.executionMs}ms`);
  console.log(
    `Identity headers: ${Object.keys(result.data.headers).join(", ")}`,
  );
} catch (error) {
  const details =
    error && typeof error === "object" ? error : { message: String(error) };
  console.error("Solve failed.");
  console.error(`Type: ${details.name ?? "UnknownError"}`);
  console.error(`Code: ${details.code ?? "n/a"}`);
  console.error(`Message: ${details.message ?? "Unknown error"}`);
  process.exitCode = 1;
}
