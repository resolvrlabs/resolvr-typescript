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
    data: { action: "login", s: "" },
  },
});
assert.deepEqual(wire, {
  type: "recaptcha_v2",
  url: "https://example.com/login",
  proxy: "http://user:pass@proxy.example.net:8080",
  params: {
    sitekey: "site-key",
    enterprise: false,
    data: { action: "login", s: "" },
  },
});

// data.action is optional and rides alone; a non-string is rejected client-side.
assert.deepEqual(
  recaptchaV2Definition.serialize({
    type: "recaptcha_v2",
    url: "https://example.com/login",
    proxy: "http://user:pass@proxy.example.net:8080",
    params: {
      siteKey: "site-key",
      enterprise: true,
      data: { action: "login" },
    },
  }).params,
  { sitekey: "site-key", enterprise: true, data: { action: "login" } },
);
assert.throws(
  () =>
    recaptchaV2Definition.serialize({
      type: "recaptcha_v2",
      url: "https://example.com/login",
      proxy: "http://user:pass@proxy.example.net:8080",
      params: { siteKey: "site-key", data: { action: 1 } },
    }),
  /task\.params\.data\.action/,
);

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

// final_request is optional: cf_clearance alone is a complete solve.
const clearanceCookies = [{ name: "cf_clearance", value: "clearance" }];
assert.deepEqual(
  cloudflareBlockpageDefinition.parseData(
    { cookies: clearanceCookies },
    { mode: "url" },
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
    { mode: "url" },
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
assert.throws(
  () =>
    cloudflareBlockpageDefinition.parseData(
      { cookies: [{ name: "other", value: "x" }] },
      { mode: "url" },
    ),
  /cf_clearance/,
);

// params may be omitted for the block page; the wire matches explicit url mode.
const blockpageTask = {
  type: "cloudflare_blockpage",
  url: "https://example.com/protected",
  proxy: "http://user:pass@proxy.example.net:8080",
};
const blockpageWire = { ...blockpageTask, params: { mode: "url" } };
assert.deepEqual(
  cloudflareBlockpageDefinition.serialize(blockpageTask),
  blockpageWire,
);
assert.deepEqual(
  cloudflareBlockpageDefinition.serialize({
    ...blockpageTask,
    params: { mode: "url" },
  }),
  blockpageWire,
);
assert.deepEqual(cloudflareBlockpageDefinition.context(blockpageTask), {
  mode: "url",
});
assert.throws(
  () =>
    cloudflareBlockpageDefinition.serialize({
      ...blockpageTask,
      params: "url",
    }),
  /task\.params must be an object/,
);

// html mode is not currently supported and is rejected before any request.
for (const params of [{ mode: "html" }, { html: "<html>challenge</html>" }]) {
  assert.throws(
    () => cloudflareBlockpageDefinition.serialize({ ...blockpageTask, params }),
    /html mode is not currently supported/,
  );
}

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

  // A block page solved without params, typed and raw. The raw task is sent
  // exactly as given; other types still require params.
  const taskId = "01KZPV5BGPVDTSNQCCQV2M7EF6";
  const clearance = [{ name: "cf_clearance", value: "clearance" }];
  const posted = [];
  globalThis.fetch = async (url, init) => {
    if (init.method === "POST") {
      assert.equal(url, "https://api.resolvr.com/v1/task");
      posted.push(JSON.parse(init.body));
      return jsonResponse(202, { task_id: taskId, status: "queued" });
    }
    assert.equal(url, `https://api.resolvr.com/v1/task/${taskId}`);
    return jsonResponse(200, {
      task_id: taskId,
      status: "completed",
      success: true,
      data: { cookies: clearance },
      timing: {
        queued_ms: 2,
        proxy_verify_ms: 204,
        execution_ms: 6120,
        total_ms: 6326,
      },
    });
  };
  const solved = await client.solve(blockpageTask);
  assert.deepEqual(solved.data, { cookies: clearance });
  const rawSolved = await client.solveRaw(blockpageTask);
  assert.equal(rawSolved.status, "completed");
  assert.deepEqual(posted, [blockpageWire, blockpageTask]);
  await assert.rejects(
    client.solveRaw({
      type: "recaptcha_v2",
      url: "https://example.com/login",
      proxy: "http://user:pass@proxy.example.net:8080",
    }),
    /rawTask\.params must be an object/,
  );
} finally {
  globalThis.fetch = originalFetch;
}
