import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import type { Outcome } from "./client";

export class PasskeyFailure extends Error {
  constructor(
    message = "Não foi possível usar a passkey. Tente novamente.",
    readonly kind: "unsupported" | "failed" = "failed",
  ) {
    super(message);
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Protocol options are ephemeral and validated before invoking the browser.
// The browser independently enforces RP ID/origin binding; UV is never optional.
export function validatePasskeyOptions(outcome: Outcome): void {
  try {
    if (
      typeof outcome.public_key !== "string" ||
      outcome.public_key.length > 16384
    )
      throw new Error();
    const options: unknown = JSON.parse(outcome.public_key);
    if (
      !object(options) ||
      typeof options.challenge !== "string" ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(options.challenge)
    )
      throw new Error();
    if (outcome.status === "enrollment_required") {
      if (
        !object(options.rp) ||
        typeof options.rp.id !== "string" ||
        !object(options.user) ||
        typeof options.user.id !== "string" ||
        !object(options.authenticatorSelection) ||
        options.authenticatorSelection.userVerification !== "required" ||
        options.authenticatorSelection.residentKey !== "required"
      )
        throw new Error();
    } else if (
      outcome.status !== "passkey_required" ||
      options.userVerification !== "required" ||
      typeof options.rpId !== "string" ||
      !Array.isArray(options.allowCredentials) ||
      !options.allowCredentials.length
    ) {
      throw new Error();
    }
  } catch {
    throw new PasskeyFailure(
      "O desafio da passkey é inválido. Entre novamente.",
    );
  }
}
export async function provePasskey(
  outcome: Outcome,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  validatePasskeyOptions(outcome);
  if (!window.isSecureContext || !browserSupportsWebAuthn())
    throw new PasskeyFailure(
      "Passkeys indisponíveis neste navegador. Use HTTPS (ou localhost) e um navegador compatível.",
      "unsupported",
    );
  const cancel = () => WebAuthnAbortService.cancelCeremony();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const result =
      outcome.status === "enrollment_required"
        ? await startRegistration({
            optionsJSON: JSON.parse(outcome.public_key ?? ""),
          })
        : await startAuthentication({
            optionsJSON: JSON.parse(outcome.public_key ?? ""),
          });
    signal.throwIfAborted();
    return JSON.stringify(result);
  } catch {
    throw new PasskeyFailure(
      "Verificação cancelada, expirada ou recusada. Tente novamente.",
    );
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
