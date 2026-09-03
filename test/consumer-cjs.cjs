const assert = require("node:assert/strict");
const { ResolvrClient } = require("..");

const client = new ResolvrClient({ apiKey: "consumer-test" });
assert.equal(client.apiBaseUrl, "https://api.resolvr.com/v1");
