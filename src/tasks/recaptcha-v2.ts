import { ResolvrValidationError } from "../errors.js";
import type {
  RecaptchaV2Solution,
  RecaptchaV2Task,
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

export const recaptchaV2Definition: TaskDefinition<"recaptcha_v2"> = {
  type: "recaptcha_v2",
  replayRequirements: Object.freeze([
    "immediate_single_use_token",
    "same_proxy_egress",
  ]),
  redactRaw: redactResponseRaw,
  serialize(task: RecaptchaV2Task): Record<string, unknown> {
    if (!isRecord(task.params)) {
      throw new ResolvrValidationError("task.params must be an object");
    }
    if ("cookies" in task) {
      throw new ResolvrValidationError(
        "cookies are not accepted for recaptcha_v2",
      );
    }
    if ("userAgent" in task || "user_agent" in task) {
      throw new ResolvrValidationError(
        "userAgent is not accepted for recaptcha_v2",
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
      if (action !== undefined) data.action = action;
      const s = optionalString(task.params.data.s, "task.params.data.s");
      if (s !== undefined) data.s = s;
      params.data = data;
    }
    return {
      type: "recaptcha_v2",
      url: validateTargetUrl(task.url),
      proxy: validateProxy(task.proxy),
      params,
    };
  },
  context(): TaskContextByType["recaptcha_v2"] {
    return undefined;
  },
  parseData(value: unknown): RecaptchaV2Solution {
    const data = requireResponseRecord(value, "response.data");
    return {
      token: requireResponseString(data.token, "response.data.token"),
    };
  },
};
