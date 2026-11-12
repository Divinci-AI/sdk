import { confirm } from "@inquirer/prompts";
import { ServerApiError, ServerHttpClient } from "@divinci-ai/server";
import { colors } from "../output/colors.js";

export interface TermsGateDetails {
  tosId: string;
  version: number;
  title?: string;
  content?: string;
  releaseId?: string;
}

/**
 * Extract the Terms of Service gate from a 403 TERMS_NOT_ACCEPTED error.
 * Returns null when the error is anything else.
 */
export function getTermsGateFromError(error: unknown): TermsGateDetails | null {
  if (!(error instanceof ServerApiError)) return null;
  if (error.code !== "TERMS_NOT_ACCEPTED") return null;
  const details = error.details as Partial<TermsGateDetails> | undefined;
  if (!details?.tosId || typeof details.version !== "number") return null;
  return {
    tosId: details.tosId,
    version: details.version,
    title: details.title,
    content: details.content,
    releaseId: details.releaseId,
  };
}

/**
 * Interactive Terms of Service acceptance: prints the terms, asks for
 * confirmation, records acceptance server-side. Returns true when accepted.
 *
 * Non-TTY (scripts/CI) never prompts — returns false so the caller can fail
 * with a hint to run `divinci terms accept`.
 */
export async function promptAndAcceptTerms(
  httpClient: ServerHttpClient,
  gate: TermsGateDetails,
): Promise<boolean> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    return false;
  }

  console.log("");
  console.log(colors.cyanBold(`=== ${gate.title || "Terms of Service"} (v${gate.version}) ===`));
  console.log("");
  console.log(gate.content || "(no content provided — view in the web app)");
  console.log("");

  const accepted = await confirm({
    message: `Do you accept these Terms of Service (v${gate.version})?`,
    default: false,
  });
  if (!accepted) return false;

  await acceptTerms(httpClient, gate);
  console.log(colors.dim(`Accepted Terms of Service v${gate.version}.`));
  return true;
}

/**
 * Record acceptance server-side via the public release-scoped endpoint
 * (works with the CLI's OAuth Bearer identity).
 */
export async function acceptTerms(
  httpClient: ServerHttpClient,
  gate: Pick<TermsGateDetails, "tosId" | "version" | "releaseId">,
): Promise<void> {
  if (!gate.releaseId) {
    throw new Error(
      "Cannot accept: the gate did not include a releaseId. Accept in the web app instead.",
    );
  }
  await httpClient.post(
    `/white-label-release/${gate.releaseId}/terms-of-service/accept`,
    { tosId: gate.tosId, version: gate.version },
  );
}
