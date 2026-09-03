import assert from "node:assert/strict";
import { ResolvrClient } from "../dist/esm/index.js";

const client = new ResolvrClient({ apiKey: "consumer-test" });
assert.equal(client.apiBaseUrl, "https://api.resolvr.com/v1");
