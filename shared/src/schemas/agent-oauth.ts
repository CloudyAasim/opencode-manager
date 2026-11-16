import { z } from "zod";
import type {
  ProviderOauthAuthorizeErrors,
  ProviderOauthCallbackErrors,
} from "@opencode-ai/sdk/v2/types";

/**
 * The agent's own words about a failed authorization.
 *
 * These are here and not in the versioned dialect because they are the agent's,
 * not ours: they are the names the agent gives its own failures, and a client
 * that was handed one of them would be holding a second dialect.
 *
 * So they are not exported from the package's barrel - the client cannot reach
 * for them even by accident. The server reads them at the boundary and says
 * what happened in its own words instead.
 */
export const PROVIDER_AUTH_ERROR_NAMES = [
  "BadRequest",
  "ProviderAuthOauthMissing",
  "ProviderAuthOauthCodeMissing",
  "ProviderAuthOauthCallbackFailed",
  "ProviderAuthValidationFailed",
] as const;

export type ProviderAuthErrorName = (typeof PROVIDER_AUTH_ERROR_NAMES)[number];

export const ProviderAuthErrorSchema = z.object({
  name: z.enum(PROVIDER_AUTH_ERROR_NAMES),
  data: z.object({
    providerID: z.string().optional(),
    field: z.string().optional(),
    message: z.string().optional(),
    kind: z.string().optional(),
  }),
});

export const InvalidRequestErrorSchema = z.object({
  _tag: z.literal("InvalidRequestError"),
  message: z.string(),
  kind: z.string().optional(),
  field: z.string().optional(),
});

export const OpenCodeOAuthErrorSchema = z.union([
  ProviderAuthErrorSchema,
  InvalidRequestErrorSchema,
]);

export type OpenCodeOAuthError = z.infer<typeof OpenCodeOAuthErrorSchema>;

export const OAUTH_ERROR_CODES = [
  ...PROVIDER_AUTH_ERROR_NAMES,
  "InvalidRequestError",
] as const;

export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];

export function oauthErrorCode(error: OpenCodeOAuthError): OAuthErrorCode {
  return "_tag" in error ? error._tag : error.name;
}

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type OpenCodeOAuthErrorMatchesAuthorize = Assert<
  MutuallyAssignable<OpenCodeOAuthError, ProviderOauthAuthorizeErrors[400]>
>;

export type OpenCodeOAuthErrorMatchesCallback = Assert<
  MutuallyAssignable<OpenCodeOAuthError, ProviderOauthCallbackErrors[400]>
>;
