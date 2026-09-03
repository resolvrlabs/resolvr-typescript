import type {
  SolutionByTaskType,
  SupportedTaskType,
  TaskByType,
  TaskContextByType,
} from "./types.js";
import { ResolvrValidationError } from "./errors.js";
import { cloudflareBlockpageDefinition } from "./tasks/cloudflare-blockpage.js";
import { cloudflareTurnstileDefinition } from "./tasks/cloudflare-turnstile.js";
import { recaptchaV2Definition } from "./tasks/recaptcha-v2.js";
import { recaptchaV3Definition } from "./tasks/recaptcha-v3.js";

export interface TaskDefinition<TType extends SupportedTaskType> {
  readonly type: TType;
  readonly replayRequirements: readonly ReplayRequirement[];
  serialize(task: TaskByType[TType]): Record<string, unknown>;
  context(task: TaskByType[TType]): TaskContextByType[TType];
  parseData(
    value: unknown,
    context: TaskContextByType[TType] | undefined,
  ): SolutionByTaskType[TType];
  redactRaw(response: Record<string, unknown>): Record<string, unknown>;
}

export type ReplayRequirement =
  | "identity_headers"
  | "immediate_single_use_token"
  | "same_proxy_egress"
  | "preserve_supplied_user_agent"
  | "html_final_request";

const registry = Object.freeze({
  recaptcha_v2: recaptchaV2Definition,
  recaptcha_v3: recaptchaV3Definition,
  cloudflare_turnstile: cloudflareTurnstileDefinition,
  cloudflare_blockpage: cloudflareBlockpageDefinition,
}) satisfies { [TType in SupportedTaskType]: TaskDefinition<TType> };

export function getTaskDefinition<TType extends SupportedTaskType>(
  type: TType,
): TaskDefinition<TType> {
  const definition = registry[type];
  if (definition === undefined) {
    throw new ResolvrValidationError(`Unsupported task type: ${String(type)}`);
  }
  return definition as TaskDefinition<TType>;
}

export function isSupportedTaskType(
  value: unknown,
): value is SupportedTaskType {
  return typeof value === "string" && value in registry;
}
