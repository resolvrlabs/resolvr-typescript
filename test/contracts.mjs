import assert from "node:assert/strict";
import { SUPPORTED_TASK_TYPES } from "../dist/esm/index.js";
import { recaptchaV2Definition } from "../dist/esm/tasks/recaptcha-v2.js";

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
