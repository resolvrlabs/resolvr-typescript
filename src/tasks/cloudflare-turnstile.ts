import { ResolvrValidationError } from "../errors.js";
import type {
  CloudflareTurnstileSolution,
  CloudflareTurnstileTask,
  TaskContextByType,
} from "../types.js";
import {
  isRecord,
  optionalString,
  requireResponseRecord,
  requireResponseString,
  requireString,
  validateProxy,
  validateTargetUrl,
} from "../validation.js";
import type { TaskDefinition } from "../task-registry.js";
import { redactResponseRaw } from "../redaction.js";

export const cloudflareTurnstileDefinition: TaskDefinition<"cloudflare_turnstile"> =
  {
    type: "cloudflare_turnstile",
    replayRequirements: Object.freeze([
      "immediate_single_use_token",
      "same_proxy_egress",
    ]),
    redactRaw: redactResponseRaw,
    serialize(task: CloudflareTurnstileTask): Record<string, unknown> {
      if ("userAgent" in task || "user_agent" in task) {
        throw new ResolvrValidationError(
          "userAgent is not accepted for cloudflare_turnstile",
        );
      }
      if ("cookies" in task) {
        throw new ResolvrValidationError(
          "cookies are not accepted for typed cloudflare_turnstile tasks",
        );
      }
      if (!isRecord(task.params)) {
        throw new ResolvrValidationError("task.params must be an object");
      }
      const params: Record<string, unknown> = {
        sitekey: requireString(task.params.siteKey, "task.params.siteKey"),
      };
      if (task.params.data !== undefined) {
        if (!isRecord(task.params.data)) {
          throw new ResolvrValidationError(
            "task.params.data must be an object",
          );
        }
        const data: Record<string, unknown> = {};
        const action = optionalString(
          task.params.data.action,
          "task.params.data.action",
        );
        const cdata = optionalString(
          task.params.data.cdata,
          "task.params.data.cdata",
        );
        if (action !== undefined) data.action = action;
        if (cdata !== undefined) data.cdata = cdata;
        params.data = data;
      }
      return {
        type: "cloudflare_turnstile",
        url: validateTargetUrl(task.url),
        proxy: validateProxy(task.proxy),
        params,
      };
    },
    context(): TaskContextByType["cloudflare_turnstile"] {
      return undefined;
    },
    parseData(value: unknown): CloudflareTurnstileSolution {
      const data = requireResponseRecord(value, "response.data");
      return {
        token: requireResponseString(data.token, "response.data.token"),
      };
    },
  };
