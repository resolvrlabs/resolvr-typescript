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
  const params = (task.params ?? {}) as Record<string, unknown>;
  // html mode is not currently supported by the API.
  if (params.mode === "html" || params.html !== undefined) {
    throw new ResolvrValidationError(
      "html mode is not currently supported for cloudflare_blockpage",
    );
  }
  if (params.mode !== undefined && params.mode !== "url") {
    throw new ResolvrValidationError("task.params.mode must be url");
  }
  return "url";
}

function requireNonEmptyInput(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ResolvrValidationError(`${path} must be a non-empty string`);
  }
  return value;
}

export const cloudflareBlockpageDefinition: TaskDefinition<"cloudflare_blockpage"> =
  {
    type: "cloudflare_blockpage",
    replayRequirements: Object.freeze([
      "same_proxy_egress",
      "preserve_supplied_user_agent",
      "optional_final_request",
    ]),
    redactRaw: redactResponseRaw,
    serialize(task: CloudflareBlockpageTask): Record<string, unknown> {
      if ("cookies" in task) {
        throw new ResolvrValidationError(
          "block-page cookies belong under task.params.cookies",
        );
      }
      // params may be omitted entirely; the wire still carries mode "url".
      if (task.params !== undefined && !isRecord(task.params)) {
        throw new ResolvrValidationError("task.params must be an object");
      }
      const params: Record<string, unknown> = { mode: resolveMode(task) };
      const cookies = serializeCloudflareCookies(
        task.params?.cookies,
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
          : requireNonEmptyInput(task.userAgent, "task.userAgent");
      if (userAgent !== undefined) wire.user_agent = userAgent;
      return wire;
    },
    context(
      task: CloudflareBlockpageTask,
    ): TaskContextByType["cloudflare_blockpage"] {
      return { mode: resolveMode(task) };
    },
    parseData(value: unknown): CloudflareBlockpageSolution {
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
      // final_request is optional. A clearance-bearing solve is
      // complete on its own: cf_clearance is usually enough to reach the
      // protected content, and the completing request is only returned when
      // the flow submitted one. Neither its presence nor its absence
      // invalidates the solve.
      return finalRequest === undefined
        ? { cookies }
        : { cookies, finalRequest };
    },
  };
