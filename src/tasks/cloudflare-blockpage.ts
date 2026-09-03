import { ResolvrProtocolError, ResolvrValidationError } from "../errors.js";
import type {
  BlockpageMode,
  CloudflareBlockpageSolution,
  CloudflareBlockpageTask,
  FinalRequest,
  TaskContextByType,
} from "../types.js";
import {
  isRecord,
  requireResponseRecord,
  requireResponseString,
  validateProxy,
  validateTargetUrl,
} from "../validation.js";
import type { TaskDefinition } from "../task-registry.js";
import { redactResponseRaw } from "../redaction.js";
import {
  parseCloudflareCookies,
  serializeCloudflareCookies,
} from "./shared.js";

function resolveMode(task: CloudflareBlockpageTask): BlockpageMode {
  const params = task.params as Record<string, unknown>;
  const mode = params.mode;
  if (mode !== undefined && mode !== "url" && mode !== "html") {
    throw new ResolvrValidationError("task.params.mode must be url or html");
  }
  const resolved = mode ?? (params.html !== undefined ? "html" : "url");
  if (resolved === "html") {
    requireResponseStringAsInput(params.html, "task.params.html");
  } else if (params.html !== undefined) {
    throw new ResolvrValidationError(
      "task.params.html is only accepted in html mode",
    );
  }
  return resolved;
}

function requireResponseStringAsInput(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ResolvrValidationError(
      `${path} must be a non-empty string in html mode`,
    );
  }
  return value;
}

export const cloudflareBlockpageDefinition: TaskDefinition<"cloudflare_blockpage"> =
  {
    type: "cloudflare_blockpage",
    replayRequirements: Object.freeze([
      "same_proxy_egress",
      "preserve_supplied_user_agent",
      "html_final_request",
    ]),
    redactRaw: redactResponseRaw,
    serialize(task: CloudflareBlockpageTask): Record<string, unknown> {
      if ("cookies" in task) {
        throw new ResolvrValidationError(
          "block-page cookies belong under task.params.cookies",
        );
      }
      if (!isRecord(task.params)) {
        throw new ResolvrValidationError("task.params must be an object");
      }
      const mode = resolveMode(task);
      const params: Record<string, unknown> = { mode };
      if (mode === "html") {
        params.html = requireResponseStringAsInput(
          task.params.html,
          "task.params.html",
        );
      }
      const cookies = serializeCloudflareCookies(
        task.params.cookies,
        "task.params.cookies",
      );
      if (cookies !== undefined) params.cookies = cookies;
      const wire: Record<string, unknown> = {
        type: "cloudflare_blockpage",
        url: validateTargetUrl(task.url),
        proxy: validateProxy(task.proxy),
        params,
      };
      const userAgent =
        task.userAgent === undefined
          ? undefined
          : requireResponseStringAsInput(task.userAgent, "task.userAgent");
      if (userAgent !== undefined) wire.user_agent = userAgent;
      return wire;
    },
    context(
      task: CloudflareBlockpageTask,
    ): TaskContextByType["cloudflare_blockpage"] {
      return { mode: resolveMode(task) };
    },
    parseData(value: unknown, context): CloudflareBlockpageSolution {
      const data = requireResponseRecord(value, "response.data");
      const cookies = parseCloudflareCookies(data.cookies);
      if (
        !cookies.some((cookie) => cookie.name.toLowerCase() === "cf_clearance")
      ) {
        throw new ResolvrProtocolError(
          "response.data.cookies must contain cf_clearance",
        );
      }
      let finalRequest: FinalRequest | undefined;
      if (data.final_request !== undefined) {
        const raw = requireResponseRecord(
          data.final_request,
          "response.data.final_request",
        );
        finalRequest = {
          url: requireResponseString(
            raw.url,
            "response.data.final_request.url",
          ),
          method: requireResponseString(
            raw.method,
            "response.data.final_request.method",
          ),
          body: requireResponseString(
            raw.body,
            "response.data.final_request.body",
            {
              allowEmpty: true,
            },
          ),
        };
      }
      // URL mode may include final_request; it does not invalidate a
      // clearance-bearing solve.
      if (context?.mode === "html" && finalRequest === undefined) {
        throw new ResolvrProtocolError(
          "HTML-mode block-page result must contain final_request",
        );
      }
      return finalRequest === undefined
        ? { cookies }
        : { cookies, finalRequest };
    },
  };
