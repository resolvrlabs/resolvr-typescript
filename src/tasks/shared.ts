import type { CloudflareCookie, RecaptchaCookie } from "../types.js";
import {
  isRecord,
  optionalBoolean,
  optionalString,
  requireResponseRecord,
  requireResponseString,
  requireString,
} from "../validation.js";
import { ResolvrProtocolError, ResolvrValidationError } from "../errors.js";

export function serializeRecaptchaCookies(
  value: unknown,
  path: string,
): Record<string, unknown>[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ResolvrValidationError(`${path} must be an array`);
  }
  return value.map((cookie, index) => {
    if (!isRecord(cookie)) {
      throw new ResolvrValidationError(`${path}[${index}] must be an object`);
    }
    const result: Record<string, unknown> = {
      name: requireString(cookie.name, `${path}[${index}].name`),
    };
    copyOptional(
      result,
      "value",
      optionalString(cookie.value, `${path}[${index}].value`),
    );
    copyOptional(
      result,
      "domain",
      optionalString(cookie.domain, `${path}[${index}].domain`),
    );
    copyOptional(
      result,
      "path",
      optionalString(cookie.path, `${path}[${index}].path`),
    );
    copyOptional(
      result,
      "secure",
      optionalBoolean(cookie.secure, `${path}[${index}].secure`),
    );
    copyOptional(
      result,
      "httpOnly",
      optionalBoolean(cookie.httpOnly, `${path}[${index}].httpOnly`),
    );
    copyOptional(
      result,
      "sameSite",
      optionalString(cookie.sameSite, `${path}[${index}].sameSite`),
    );
    return result;
  });
}

export function serializeCloudflareCookies(
  value: unknown,
  path: string,
): Record<string, unknown>[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ResolvrValidationError(`${path} must be an array`);
  }
  return value.map((cookie, index) => {
    if (!isRecord(cookie)) {
      throw new ResolvrValidationError(`${path}[${index}] must be an object`);
    }
    const result: Record<string, unknown> = {
      name: requireString(cookie.name, `${path}[${index}].name`),
      value: requireString(cookie.value, `${path}[${index}].value`, {
        allowEmpty: true,
      }),
    };
    copyOptional(
      result,
      "domain",
      optionalString(cookie.domain, `${path}[${index}].domain`),
    );
    copyOptional(
      result,
      "path",
      optionalString(cookie.path, `${path}[${index}].path`),
    );
    copyOptional(
      result,
      "secure",
      optionalBoolean(cookie.secure, `${path}[${index}].secure`),
    );
    copyOptional(
      result,
      "http_only",
      optionalBoolean(cookie.httpOnly, `${path}[${index}].httpOnly`),
    );
    copyOptional(
      result,
      "same_site",
      optionalString(cookie.sameSite, `${path}[${index}].sameSite`),
    );
    return result;
  });
}

export function parseCloudflareCookies(value: unknown): CloudflareCookie[] {
  if (!Array.isArray(value)) {
    throw new ResolvrProtocolError("response.data.cookies must be an array");
  }
  return value.map((item, index) => {
    const cookie = requireResponseRecord(
      item,
      `response.data.cookies[${index}]`,
    );
    const result: CloudflareCookie = {
      name: requireResponseString(
        cookie.name,
        `response.data.cookies[${index}].name`,
      ),
      value: requireResponseString(
        cookie.value,
        `response.data.cookies[${index}].value`,
        { allowEmpty: true },
      ),
    };
    copyResponseOptional(
      result,
      "domain",
      cookie.domain,
      `response.data.cookies[${index}].domain`,
      "string",
    );
    copyResponseOptional(
      result,
      "path",
      cookie.path,
      `response.data.cookies[${index}].path`,
      "string",
    );
    copyResponseOptional(
      result,
      "secure",
      cookie.secure,
      `response.data.cookies[${index}].secure`,
      "boolean",
    );
    copyResponseOptional(
      result,
      "httpOnly",
      cookie.http_only,
      `response.data.cookies[${index}].http_only`,
      "boolean",
    );
    copyResponseOptional(
      result,
      "sameSite",
      cookie.same_site,
      `response.data.cookies[${index}].same_site`,
      "string",
    );
    return result;
  });
}

function copyOptional(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value !== undefined) target[key] = value;
}

function copyResponseOptional(
  target: CloudflareCookie | RecaptchaCookie,
  key: keyof CloudflareCookie,
  value: unknown,
  path: string,
  type: "string" | "boolean",
): void {
  if (value === undefined) return;
  if (typeof value !== type) {
    throw new ResolvrProtocolError(`${path} must be a ${type}`);
  }
  (target as unknown as Record<string, unknown>)[key] = value;
}
