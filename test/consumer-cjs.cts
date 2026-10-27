import {
  ResolvrClient,
  type CloudflareBlockpageTask,
  type RecaptchaV2Solution,
  type RecaptchaV2Task,
  type RecaptchaV3Solution,
} from "@resolvrlabs/sdk";

const client = new ResolvrClient({ apiKey: "consumer-test" });
const task: CloudflareBlockpageTask = {
  type: "cloudflare_blockpage",
  url: "https://example.test",
  proxy: "http://proxy.example.test:8080",
  params: { mode: "url" },
};
const v2Task: RecaptchaV2Task = {
  type: "recaptcha_v2",
  url: "https://example.test",
  proxy: "http://proxy.example.test:8080",
  params: { siteKey: "placeholder", data: { s: "" } },
};

async function verifyTypes(): Promise<void> {
  const result = await client.solve(task);
  result.data.cookies.at(0)?.name;
  const v2Result = await client.solve(v2Task);
  v2Result.data.token;
  const raw = await client.solveRaw<{ custom: true }>({
    type: "cloudflare_turnstile",
    url: "https://example.test",
    proxy: "http://proxy.example.test:8080",
    params: { sitekey: "placeholder" },
  });
  raw.data.custom;
}

const exampleSolution: RecaptchaV3Solution = {
  token: "placeholder",
  headers: { "user-agent": "placeholder" },
};
const exampleV2Solution: RecaptchaV2Solution = { token: "placeholder" };

void verifyTypes;
void exampleSolution;
void exampleV2Solution;
