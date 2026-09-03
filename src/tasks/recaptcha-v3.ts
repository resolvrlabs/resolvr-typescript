import { ResolvrProtocolError, ResolvrValidationError } from "../errors.js";
import type {
  RecaptchaV3Solution,
  RecaptchaV3Task,
  TaskContextByType,
} from "../types.js";
import {
  isRecord,
  optionalBoolean,
  optionalString,
  requireResponseRecord,
  requireResponseString,
  requireString,
  validateProxy,
  validateTargetUrl,
} from "../validation.js";
import type { TaskDefinition } from "../task-registry.js";
import { redactResponseRaw } from "../redaction.js";
import { serializeRecaptchaCookies } from "./shared.js";

export const recaptchaV3Definition: TaskDefinition<"recaptcha_v3"> = {
  type: "recaptcha_v3",
  replayRequirements: Object.freeze(["identity_headers"]),
  redactRaw: redactResponseRaw,
  serialize(task: RecaptchaV3Task): Record<string, unknown> {
    if (!isRecord(task.params)) {
      throw new ResolvrValidationError("task.params must be an object");
    }
    if ("userAgent" in task || "user_agent" in task) {
      throw new ResolvrValidationError(
        "userAgent is not accepted for recaptcha_v3",
      );
    }
    const params: Record<string, unknown> = {
      sitekey: requireString(task.params.siteKey, "task.params.siteKey"),
    };
    const enterprise = optionalBoolean(
      task.params.enterprise,
      "task.params.enterprise",
    );
    if (enterprise !== undefined) params.enterprise = enterprise;
    if (task.params.data !== undefined) {
      if (!isRecord(task.params.data)) {
        throw new ResolvrValidationError("task.params.data must be an object");
      }
      const data: Record<string, unknown> = {};
      const action = optionalString(
        task.params.data.action,
        "task.params.data.action",
      );
      const s = optionalString(task.params.data.s, "task.params.data.s");
      if (action !== undefined) data.action = action;
      if (s !== undefined) data.s = s;
      params.data = data;
    }
    const wire: Record<string, unknown> = {
      type: "recaptcha_v3",
      url: validateTargetUrl(task.url),
      proxy: validateProxy(task.proxy),
      params,
    };
    const cookies = serializeRecaptchaCookies(task.cookies, "task.cookies");
    if (cookies !== undefined) wire.cookies = cookies;
    return wire;
  },
  context(): TaskContextByType["recaptcha_v3"] {
    return undefined;
  },
  parseData(value: unknown): RecaptchaV3Solution {
    const data = requireResponseRecord(value, "response.data");
    const rawHeaders = requireResponseRecord(
      data.headers,
      "response.data.headers",
    );
    const headers: Record<string, string> = {};
    for (const [name, headerValue] of Object.entries(rawHeaders)) {
      if (name !== name.toLowerCase()) {
        throw new ResolvrProtocolError(
          "response.data.headers keys must be lowercase",
        );
      }
      if (name !== "user-agent" && !name.startsWith("sec-ch-")) {
        throw new ResolvrProtocolError(
          `response.data.headers contains unsupported identity header ${name}`,
        );
      }
      headers[name] = requireResponseString(
        headerValue,
        `response.data.headers.${name}`,
      );
    }
    if (!("user-agent" in headers)) {
      throw new ResolvrProtocolError(
        "response.data.headers must contain user-agent",
      );
    }
    return {
      token: requireResponseString(data.token, "response.data.token"),
      headers,
    };
  },
};
