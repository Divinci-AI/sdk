import { input } from "@inquirer/prompts";
import type { BaaAgreement, HipaaCreationAssent } from "@divinci-ai/types";
import { colors } from "../../output/colors.js";
import { isJsonMode } from "../../output/formatter.js";

/**
 * The consent step of `divinci workspace create --hipaa`.
 *
 * Starting a workspace HIPAA-scoped is much easier than converting one that has
 * been running, so the choice is offered at creation. It is NOT a flag that
 * flips a bit: it records acceptance of the Business Associate Agreement, and
 * the workspace is scoped because that was recorded. So nothing here may infer
 * assent — every path ends in either an explicit typed confirmation (a person
 * at a terminal) or all three `--baa-*` values supplied by the caller, one of
 * which is the hash of the exact text being accepted.
 */

/** Phrase a person types to accept. Deliberately not a bare "y". */
export const ACCEPT_PHRASE = "I ACCEPT";

export interface HipaaFlags {
  hipaa?: boolean;
  baaSignerTitle?: string;
  baaOrgLegalName?: string;
  baaVersionHash?: string;
  host?: string;
}

/**
 * What scoping a workspace changes, stated BEFORE the person accepts.
 *
 * The chat-pause line is driven by the server's `chatBlockedUntilVendorBaa`
 * (derived from the covered-provider list), not hard-coded: once the first
 * vendor BAA is executed it must stop telling people their chat will pause.
 * Only an explicit `false` removes it; an older server could only mean "blocked".
 */
export function hipaaConsequences(agreement: Pick<BaaAgreement, "chatBlockedUntilVendorBaa">): readonly string[] {
  const lines = [
    "De-identification is forced on for this workspace and cannot be switched off, including per release.",
    "If de-identification cannot run, chat requests are refused rather than sent unprotected.",
    "Only model providers covered by a Business Associate Agreement may be used.",
  ];
  if (agreement.chatBlockedUntilVendorBaa !== false) {
    lines[2] += " While no provider is covered yet, chat is paused for this workspace.";
  }
  return lines;
}

/** Reject flag combinations that cannot mean what the caller hopes. Throws. */
export function assertHipaaFlagsCoherent(opts: HipaaFlags): void {
  const hasBaaFlag = Boolean(opts.baaSignerTitle || opts.baaOrgLegalName || opts.baaVersionHash);
  if (hasBaaFlag && !opts.hipaa) {
    // Silently dropping these would create an UNSCOPED workspace for someone
    // who plainly meant a scoped one.
    throw new Error("--baa-* options only apply with --hipaa. Add --hipaa, or remove them.");
  }
  if (opts.hipaa && opts.host) {
    throw new Error(
      "--hipaa cannot be combined with --host: --host reuses an existing workspace, which may " +
        "not be HIPAA-scoped. Create the HIPAA workspace without --host.",
    );
  }
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !isJsonMode();
}

/** Print the agreement the way both `workspace baa` and the create flow show it. */
export function printAgreement(agreement: BaaAgreement): void {
  console.warn("");
  console.warn(colors.cyanBold(`=== ${agreement.title} (v${agreement.version}) ===`));
  console.warn(colors.dim(`version hash: ${agreement.versionHash}`));
  console.warn("");
  console.warn(agreement.content);
  console.warn("");
}

/**
 * Turn flags (and, at a terminal, prompts) into validated assent.
 * Throws — never returns partial or implied assent.
 */
export async function resolveHipaaAssent(
  agreement: BaaAgreement,
  opts: HipaaFlags,
  interactive: boolean = isInteractive(),
): Promise<HipaaCreationAssent> {
  if (!agreement.available) {
    throw new Error(
      "The Business Associate Agreement is not yet available for acceptance, so a HIPAA workspace " +
        "cannot be created right now. Nothing was created. Contact support to enable HIPAA-scoped features.",
    );
  }

  // A supplied hash proves which text the caller saw. A mismatch means the
  // agreement changed since — recording assent to bytes they never read is the
  // exact failure the hash exists to prevent.
  if (opts.baaVersionHash && opts.baaVersionHash !== agreement.versionHash) {
    throw new Error(
      "--baa-version-hash does not match the current agreement (it has been updated). " +
        "Run `divinci workspace baa` to review the current version and its hash.",
    );
  }

  if (!interactive) {
    const missing = [
      !opts.baaSignerTitle?.trim() && "--baa-signer-title",
      !opts.baaOrgLegalName?.trim() && "--baa-org-legal-name",
      !opts.baaVersionHash && "--baa-version-hash",
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new Error(
        `Not running at a terminal, so assent cannot be prompted for. Missing: ${missing.join(", ")}. ` +
          "Review the agreement with `divinci workspace baa`, then pass all three explicitly.",
      );
    }
    return {
      versionHash: agreement.versionHash,
      signerTitle: opts.baaSignerTitle!.trim(),
      organizationLegalName: opts.baaOrgLegalName!.trim(),
    };
  }

  printAgreement(agreement);
  console.warn(colors.yellow("What this changes for the workspace:"));
  for (const line of hipaaConsequences(agreement)) console.warn(`  - ${line}`);
  console.warn("");

  const organizationLegalName = (
    opts.baaOrgLegalName?.trim() ||
    (await input({ message: "Legal name of your organization:" })).trim()
  );
  const signerTitle = (
    opts.baaSignerTitle?.trim() || (await input({ message: "Your title:" })).trim()
  );
  if (!organizationLegalName || !signerTitle) {
    throw new Error("Your title and your organization's legal name are both required to accept.");
  }

  const typed = await input({
    message: `Type "${ACCEPT_PHRASE}" to confirm you have read the agreement and are authorized to bind ${organizationLegalName}:`,
  });
  if (typed.trim() !== ACCEPT_PHRASE) {
    throw new Error("Agreement not accepted. Nothing was created.");
  }

  return { versionHash: agreement.versionHash, signerTitle, organizationLegalName };
}
