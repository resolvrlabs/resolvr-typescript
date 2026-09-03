<p align="center"><img src="https://resolvr.com/resolvr-lockup.svg" width="260" alt="Resolvr"></p>

<div align="center">
  <h1>Resolvr TypeScript SDK</h1>

  <p><strong>Challenges, solved.</strong></p>
  <p>Typed access to reCAPTCHA v2, reCAPTCHA v3, and Cloudflare solving through one clean interface.</p>
  <p>Official TypeScript SDK. Published as <code>@resolvrlabs/sdk</code>.</p>

  <p>
    <a href="#install">Install</a>
    ·
    <a href="#solve-a-challenge">Quick start</a>
    ·
    <a href="#supported-challenges">Challenges</a>
    ·
    <a href="#api">API</a>
  </p>
</div>

---

## Install

```bash
npm install @resolvrlabs/sdk
```

The SDK is intended for server-side TypeScript applications. Keep your API key out of browser bundles and source control.

## Solve a challenge

Create a client, describe the challenge, and await the result. Resolvr handles task creation and retrieval for you.

```ts
import { ResolvrClient } from "@resolvrlabs/sdk";

const resolvr = new ResolvrClient({
  apiKey: "<RESOLVR_API_KEY>",
});

const result = await resolvr.solve({
  type: "recaptcha_v3",
  url: "https://example.com/checkout",
  proxy: "http://user:pass@proxy.example.net:8080",
  params: {
    siteKey: "6Lc...",
    data: { action: "checkout" },
  },
});

console.log(result.data.token);
console.log(result.data.headers);
```

CommonJS consumers import the same named export:

```js
const { ResolvrClient } = require("@resolvrlabs/sdk");
```

`result.data.headers` contains the browser identity headers that minted the reCAPTCHA token. Send them with the token when completing the target request.

### Run a real test

Clone this repository and supply an API key, target URL, site key, and proxy. The test submits a real `recaptcha_v3` task to Resolvr—there is no simulated API.

```bash
RESOLVR_API_KEY="..." \
RESOLVR_TARGET_URL="https://example.com/checkout" \
RESOLVR_SITE_KEY="6Lc..." \
RESOLVR_PROXY="http://user:pass@proxy.example.net:8080" \
npm run test:solve
```

Set `RESOLVR_ACTION` as an additional environment variable when the target uses a reCAPTCHA action. The runner reports success and timing without printing the returned token or secret configuration. See [`test/solve-recaptcha-v3.mjs`](./test/solve-recaptcha-v3.mjs).

For reCAPTCHA v2, set `RESOLVR_V2_TARGET_URL` and `RESOLVR_V2_SITE_KEY` instead, then run `npm run test:solve:v2`. Set `RESOLVR_V2_S` when the page supplies an `s` value. See [`test/solve-recaptcha-v2.mjs`](./test/solve-recaptcha-v2.mjs).

## Supported challenges

<table>
  <thead>
    <tr>
      <th>Challenge</th>
      <th>Task type</th>
      <th>Result</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>reCAPTCHA v2</td>
      <td><code>recaptcha_v2</code></td>
      <td>Short-lived, single-use token</td>
    </tr>
    <tr>
      <td>reCAPTCHA v3</td>
      <td><code>recaptcha_v3</code></td>
      <td>Token + browser identity headers</td>
    </tr>
    <tr>
      <td>Cloudflare Turnstile</td>
      <td><code>cloudflare_turnstile</code></td>
      <td>Short-lived, single-use token</td>
    </tr>
    <tr>
      <td>Cloudflare block page</td>
      <td><code>cloudflare_blockpage</code></td>
      <td>Session cookies + optional final request</td>
    </tr>
  </tbody>
</table>

### reCAPTCHA v2

```ts
const result = await resolvr.solve({
  type: "recaptcha_v2",
  url: "https://example.com/login",
  proxy: "http://user:pass@proxy.example.net:8080",
  params: {
    siteKey: "6Lc...",
    enterprise: false,
    data: { s: "" },
  },
});

const response = result.data.token;
```

Submit `response` immediately as `g-recaptcha-response` from the same proxy egress used for solving. The token is short-lived and single-use. V2 may escalate to several image rounds, so keep the proxy available for the complete solve and leave the solve timeout comfortably above the expected challenge duration.

### Cloudflare Turnstile

```ts
const result = await resolvr.solve({
  type: "cloudflare_turnstile",
  url: "https://example.com/login",
  proxy: "http://user:pass@residential.example.net:8080",
  params: {
    siteKey: "0x4AAA...",
    data: { action: "login" },
  },
});

console.log(result.data.token);
```

Use the token immediately and submit it from the same proxy egress.

### Cloudflare block page

```ts
const result = await resolvr.solve({
  type: "cloudflare_blockpage",
  url: "https://example.com/protected",
  proxy: "http://user:pass@residential.example.net:8080",
  userAgent: "<YOUR_CHROME_USER_AGENT>",
  params: { mode: "url" },
});

for (const cookie of result.data.cookies) {
  console.log(cookie.name, cookie.value);
}
```

Replay the returned cookies from the same proxy egress and with the same user agent when one was supplied. For a captured challenge page, use `params: { mode: "html", html }`; the completed result then includes `data.finalRequest` for replay.

## Built for real workflows

- One-call solving with `solve()`.
- Strong TypeScript types for every supported challenge.
- Resumable task handles for interrupted requests.
- Cancellation and configurable timeouts.
- Structured errors with retry guidance.
- Safe retrieval retries without duplicate task creation.
- ESM and CommonJS package exports.
- No runtime dependencies.

## API

- `solve(task, options?)` creates a task, retrieves it until completion, and returns its typed solution.
- `createTask(task, options?)` creates once and returns a resumable typed handle.
- `getTask(handle, options?)` retrieves `queued`, `processing`, `completed`, or `failed` state.
- `solveRaw(task, options?)` and `getRawTask(handle, options?)` preserve exact API field names for the four supported task types.

Request cancellation uses `AbortSignal`. Task creation is never retried automatically; safe retrieval requests use bounded retries for transport failures, rate limits, and transient server errors.

## Errors

```ts
import {
  ResolvrApiError,
  ResolvrTaskFailedError,
  ResolvrTimeoutError,
} from "@resolvrlabs/sdk";

try {
  const result = await resolvr.solve(task);
  console.log(result.data);
} catch (error) {
  if (error instanceof ResolvrTaskFailedError) {
    console.error(error.code, error.message, error.retryable);
  } else if (error instanceof ResolvrApiError) {
    console.error(error.httpStatus, error.code);
  } else if (error instanceof ResolvrTimeoutError && error.taskHandle) {
    const state = await resolvr.getTask(error.taskHandle);
    console.log(state.status);
  }
}
```

Task creation is never retried automatically. If a timeout or cancellation happens after creation, the error carries a resumable task handle whenever the SDK received one.

## Configuration

```ts
const resolvr = new ResolvrClient({
  apiKey: "<RESOLVR_API_KEY>",
  baseUrl: "https://api.resolvr.com/",
  requestTimeoutMs: 15_000,
  solveTimeoutMs: 120_000,
});
```

The default API URL is `https://api.resolvr.com/v1`. The library does not read environment variables automatically; pass your secret from your own configuration layer.

## Testing against Resolvr

This repository does not use a simulated Resolvr API. The integration runner submits all four documented task types to the configured API using private, authorized test targets.

```bash
RESOLVR_API_KEY="..." \
RESOLVR_INTEGRATION_TASKS_FILE="/absolute/path/to/tasks.json" \
npm run test:integration
```

The JSON file contains `recaptchaV2`, `recaptchaV3`, `cloudflareTurnstile`, and `cloudflareBlockpage` task objects in the same typed shape shown above. Never commit this file: it can contain proxies, site keys, captured HTML, and private target URLs.

## Support and security

For reproducible SDK bugs, [open a GitHub issue](https://github.com/resolvrlabs/resolvr-typescript/issues) with a sanitized example. Account, billing, balance, and production-task questions belong in Resolvr's private support channel.

Never post API keys, proxy credentials, cookies, challenge tokens, captured HTML, or private target URLs. Report vulnerabilities through the [security policy](./SECURITY.md), not a public issue.

## License

MIT © ResolvrLabs
