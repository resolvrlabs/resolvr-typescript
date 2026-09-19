export const SUPPORTED_TASK_TYPES = Object.freeze([
  "recaptcha_v2",
  "recaptcha_v3",
  "cloudflare_turnstile",
  "cloudflare_blockpage",
] as const);

export type SupportedTaskType = (typeof SUPPORTED_TASK_TYPES)[number];

export interface RecaptchaCookie {
  name: string;
  value?: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
}

export interface RecaptchaV2Task {
  type: "recaptcha_v2";
  url: string;
  proxy: string;
  params: {
    siteKey: string;
    enterprise?: boolean;
    data?: {
      action?: string;
      s?: string;
    };
  };
  /** Cookies are not accepted for reCAPTCHA v2 tasks. */
  cookies?: never;
  /** User-agent pinning is not accepted for reCAPTCHA v2 tasks. */
  userAgent?: never;
}

export interface CloudflareCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
}

export interface RecaptchaV3Task {
  type: "recaptcha_v3";
  url: string;
  proxy: string;
  params: {
    siteKey: string;
    enterprise?: boolean;
    data?: {
      action?: string;
      s?: string;
    };
  };
  cookies?: RecaptchaCookie[];
}

export interface CloudflareTurnstileTask {
  type: "cloudflare_turnstile";
  url: string;
  proxy: string;
  params: {
    siteKey: string;
    data?: {
      action?: string;
      cdata?: string;
    };
  };
  /** Never accepted for Turnstile tasks. */
  cookies?: never;
  /** Never accepted for Turnstile. */
  userAgent?: never;
}

export interface CloudflareBlockpageUrlParams {
  mode?: "url";
  html?: never;
  cookies?: CloudflareCookie[];
}

export interface CloudflareBlockpageHtmlParams {
  mode?: "html";
  html: string;
  cookies?: CloudflareCookie[];
}

export interface CloudflareBlockpageTask {
  type: "cloudflare_blockpage";
  url: string;
  proxy: string;
  params: CloudflareBlockpageUrlParams | CloudflareBlockpageHtmlParams;
  userAgent?: string;
  /** Block-page cookies belong under params.cookies. */
  cookies?: never;
}

export type SupportedTask =
  | RecaptchaV2Task
  | RecaptchaV3Task
  | CloudflareTurnstileTask
  | CloudflareBlockpageTask;

export interface RecaptchaV2Solution {
  /** Submit immediately as `g-recaptcha-response` from the same proxy egress. */
  token: string;
}

export interface RecaptchaV3Solution {
  token: string;
  /** Header names remain exactly as returned by the API, including lowercase sec-ch-* keys. */
  headers: Readonly<Record<string, string>>;
}

export interface CloudflareTurnstileSolution {
  token: string;
}

/**
 * The request that completed the block-page flow, returned only when the
 * flow submitted one. Replaying it is optional: in most cases the returned
 * `cf_clearance` cookie alone is enough to reach the protected content.
 */
export interface FinalRequest {
  url: string;
  method: string;
  body: string;
}

export interface CloudflareBlockpageSolution {
  cookies: readonly CloudflareCookie[];
  /**
   * Optional in both `url` and `html` mode. Try the cookies on their own
   * first; replay `finalRequest` only if the target still serves the
   * challenge without it.
   */
  finalRequest?: FinalRequest;
}

export interface SolutionByTaskType {
  recaptcha_v2: RecaptchaV2Solution;
  recaptcha_v3: RecaptchaV3Solution;
  cloudflare_turnstile: CloudflareTurnstileSolution;
  cloudflare_blockpage: CloudflareBlockpageSolution;
}

export interface TaskByType {
  recaptcha_v2: RecaptchaV2Task;
  recaptcha_v3: RecaptchaV3Task;
  cloudflare_turnstile: CloudflareTurnstileTask;
  cloudflare_blockpage: CloudflareBlockpageTask;
}

export interface TaskTiming {
  queuedMs: number;
  proxyVerifyMs: number;
  executionMs: number;
  /** Observed wall-clock time through retrieval, not solve latency. */
  totalMs: number;
}

export type BlockpageMode = "url" | "html";

export interface TaskContextByType {
  recaptcha_v2: undefined;
  recaptcha_v3: undefined;
  cloudflare_turnstile: undefined;
  cloudflare_blockpage: { mode: BlockpageMode };
}

export type TaskReference<TType extends SupportedTaskType = SupportedTaskType> =
  {
    taskId: string;
    type: TType;
    /** Preserve this value for strict block-page URL/HTML result validation after resumption. */
    context?: TaskContextByType[TType];
  };

export type TaskHandle<TType extends SupportedTaskType = SupportedTaskType> =
  TaskReference<TType> & {
    status: "queued";
  };

export interface RawTaskHandle {
  taskId: string;
  status: "queued";
}

export type RawTaskReference = string | { taskId: string };

export interface QueuedTaskResult<TType extends SupportedTaskType> {
  taskId: string;
  type: TType;
  status: "queued";
  raw: Readonly<Record<string, unknown>>;
}

export interface ProcessingTaskResult<TType extends SupportedTaskType> {
  taskId: string;
  type: TType;
  status: "processing";
  raw: Readonly<Record<string, unknown>>;
}

export interface CompletedTaskResult<TType extends SupportedTaskType> {
  taskId: string;
  type: TType;
  status: "completed";
  success: true;
  data: Readonly<SolutionByTaskType[TType]>;
  timing: Readonly<TaskTiming>;
  /** Redacted structural response copy. Use raw methods when exact wire data is required. */
  raw: Readonly<Record<string, unknown>>;
}

export interface FailedTaskResult<TType extends SupportedTaskType> {
  taskId: string;
  type: TType;
  status: "failed";
  success: false;
  error: string;
  message: string;
  timing: Readonly<TaskTiming>;
  /** Redacted structural response copy. */
  raw: Readonly<Record<string, unknown>>;
}

export type TaskResult<TType extends SupportedTaskType = SupportedTaskType> =
  | QueuedTaskResult<TType>
  | ProcessingTaskResult<TType>
  | CompletedTaskResult<TType>
  | FailedTaskResult<TType>;

export interface RawQueuedTaskResult extends Record<string, unknown> {
  task_id: string;
  status: "queued";
}

export interface RawProcessingTaskResult extends Record<string, unknown> {
  task_id: string;
  status: "processing";
}

export interface RawCompletedTaskResult<TResult = unknown> extends Record<
  string,
  unknown
> {
  task_id: string;
  status: "completed";
  success: true;
  data: TResult;
  timing: RawTaskTiming;
}

export interface RawFailedTaskResult extends Record<string, unknown> {
  task_id: string;
  status: "failed";
  success: false;
  error: string;
  message: string;
  timing: RawTaskTiming;
}

export interface RawTaskTiming extends Record<string, unknown> {
  queued_ms: number;
  proxy_verify_ms: number;
  execution_ms: number;
  total_ms: number;
}

export type RawTaskResult<TResult = unknown> =
  | RawQueuedTaskResult
  | RawProcessingTaskResult
  | RawCompletedTaskResult<TResult>
  | RawFailedTaskResult;

export interface AccountBalance {
  /** Remaining balance expressed in `currency` units, for example 12.5 for $12.50. */
  balance: number;
  /** ISO 4217 currency code, for example "USD". */
  currency: string;
  /** Exact response body. */
  raw: Readonly<Record<string, unknown>>;
}

export type RetryKind =
  | "same_request"
  | "new_task"
  | "different_proxy"
  | "configuration_change"
  | "never";

export type ResolvrEvent =
  | {
      type: "task.create.started";
      taskType: string;
      timestamp: number;
    }
  | {
      type: "task.created";
      taskType: string;
      taskId: string;
      status: "queued";
      timestamp: number;
    }
  | {
      type: "task.retrieve.started";
      taskType?: string;
      taskId: string;
      timestamp: number;
    }
  | {
      type: "request.retry";
      operation: "retrieve";
      taskId: string;
      attempt: number;
      delayMs: number;
      reason: "transport" | "timeout" | "rate_limit" | "server";
      httpStatus?: number;
      timestamp: number;
    }
  | {
      type: "request.retry";
      operation: "balance";
      attempt: number;
      delayMs: number;
      reason: "transport" | "timeout" | "rate_limit" | "server";
      httpStatus?: number;
      timestamp: number;
    }
  | {
      type: "balance.retrieve.started";
      timestamp: number;
    }
  | {
      type: "balance.retrieved";
      balance: number;
      currency: string;
      timestamp: number;
    }
  | {
      type: "task.state";
      taskType?: string;
      taskId: string;
      status: "queued" | "processing" | "completed" | "failed";
      timing?: Readonly<TaskTiming>;
      errorCode?: string;
      timestamp: number;
    };

export interface ResolvrClientOptions {
  apiKey: string;
  baseUrl?: string;
  requestTimeoutMs?: number;
  solveTimeoutMs?: number;
  onEvent?: (event: ResolvrEvent) => void;
}

export interface RequestOptions {
  signal?: AbortSignal;
  requestTimeoutMs?: number;
}

export interface SolveOptions extends RequestOptions {
  solveTimeoutMs?: number;
}
