import assert from "node:assert/strict";
import {
  ResolvrApiError,
  ResolvrClient,
  ResolvrProtocolError,
  SUPPORTED_TASK_TYPES,
} from "../dist/esm/index.js";
import { recaptchaV2Definition } from "../dist/esm/tasks/recaptcha-v2.js";
import { cloudflareBlockpageDefinition } from "../dist/esm/tasks/cloudflare-blockpage.js";

assert.ok(SUPPORTED_TASK_TYPES.includes("recaptcha_v2"));

const wire = recaptchaV2Definition.serialize({
  type: "recaptcha_v2",
  url: "https://example.com/login",
  proxy: "http://user:pass@proxy.example.net:8080",
  params: {
    siteKey: "site-key",
    enterprise: false,
    data: { s: "" },
  },
});
assert.deepEqual(wire, {
  type: "recaptcha_v2",
  url: "https://example.com/login",
  proxy: "http://user:pass@proxy.example.net:8080",
  params: {
    sitekey: "site-key",
    enterprise: false,
    data: { s: "" },
  },
});

assert.deepEqual(recaptchaV2Definition.parseData({ token: "secret-token" }), {
  token: "secret-token",
});
assert.throws(
  () => recaptchaV2Definition.parseData({ token: "" }),
  /response\.data\.token/,
);
assert.throws(
  () =>
    recaptchaV2Definition.serialize({
      type: "recaptcha_v2",
      url: "https://example.com/login",
      proxy: "http://127.0.0.1:8080",
      params: { siteKey: "site-key" },
    }),
  /public host/,
);

const redacted = recaptchaV2Definition.redactRaw({
  task_id: "task-id",
  status: "completed",
  data: { token: "secret-token" },
});
assert.equal(redacted.data.token, "[REDACTED]");

// final_request is optional in both block-page modes: cf_clearance alone is a
// complete solve.
const clearanceCookies = [{ name: "cf_clearance", value: "clearance" }];
for (const mode of ["url", "html"]) {
  assert.deepEqual(
    cloudflareBlockpageDefinition.parseData(
      { cookies: clearanceCookies },
      { mode },
    ),
    { cookies: clearanceCookies },
  );
  assert.deepEqual(
    cloudflareBlockpageDefinition.parseData(
      {
        cookies: clearanceCookies,
        final_request: {
          url: "https://example.com/protected",
          method: "POST",
          body: "",
        },
      },
      { mode },
    ),
    {
      cookies: clearanceCookies,
      finalRequest: {
        url: "https://example.com/protected",
        method: "POST",
        body: "",
      },
    },
  );
}
assert.throws(
  () =>
    cloudflareBlockpageDefinition.parseData(
      { cookies: [{ name: "other", value: "x" }] },
      { mode: "url" },
    ),
  /cf_clearance/,
);

const originalFetch = globalThis.fetch;
const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
try {
  const events = [];
  const client = new ResolvrClient({
    apiKey: "test-key",
    onEvent: (event) => events.push(event),
  });

  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.resolvr.com/v1/balance");
    assert.equal(init.method, "GET");
    assert.equal(init.headers.Authorization, "Bearer test-key");
    assert.equal(init.body, undefined);
    return jsonResponse(200, { balance: 998.577, currency: "USD" });
  };
  const balance = await client.getBalance();
  assert.deepEqual(balance, {
    balance: 998.577,
    currency: "USD",
    raw: { balance: 998.577, currency: "USD" },
  });
  assert.ok(Object.isFrozen(balance));
  assert.ok(Object.isFrozen(balance.raw));
  assert.deepEqual(
    events.map((event) => event.type),
    ["balance.retrieve.started", "balance.retrieved"],
  );
  assert.equal(events[1].balance, 998.577);
  assert.equal(events[1].currency, "USD");

  globalThis.fetch = async () => jsonResponse(200, { balance: "998.577" });
  await assert.rejects(
    client.getBalance(),
    (error) =>
      error instanceof ResolvrProtocolError &&
      /response\.balance/.test(error.message),
  );

  globalThis.fetch = async () => jsonResponse(200, { balance: 1 });
  await assert.rejects(
    client.getBalance(),
    (error) =>
      error instanceof ResolvrProtocolError &&
      /response\.currency/.test(error.message),
  );

  globalThis.fetch = async () =>
    jsonResponse(401, {
      error: "ERROR_UNAUTHORIZED",
      message: "Invalid or missing API key",
    });
  await assert.rejects(
    client.getBalance(),
    (error) =>
      error instanceof ResolvrApiError &&
      error.httpStatus === 401 &&
      error.code === "ERROR_UNAUTHORIZED" &&
      error.retryable === false,
  );
} finally {
  globalThis.fetch = originalFetch;
}
