import { Command } from "commander";
import { verify } from "@divinci-ai/trustbench-verifier";
import type { VerifyResult } from "@divinci-ai/trustbench-verifier";
import { isJsonMode } from "../../output/formatter.js";
import { withSpinner } from "../../output/spinner.js";
import { colors } from "../../output/colors.js";
import { handleCommandError } from "../../utils/errors.js";
import {
  resolveTrustHttp,
  trustGet,
  trustGetPublicBytes,
  wellKnownUrlFor,
} from "./_client.js";

// Derived from the verifier's own result type so a renamed/misspelled field is
// a tsc error, not a silently missing output line. The --remote server returns
// the verifier's VerifyResult spread (signedBy = { keyId, signer }), so the
// server and local paths share this shape. `signerKeyId` is the flat field of
// the run-document serializer; accepted as a fallback only.
type VerifyResultLike = Pick<VerifyResult, "verified"> &
  Partial<Pick<VerifyResult, "signatureValid" | "outputsHashMatches" | "benchmarkContentHashMatches" | "warnings" | "errors" | "signedBy">> & {
    signerKeyId?: string;
  };

function reportVerify(r: VerifyResultLike, runId: string, mode: string): void {
  if (!r.verified) process.exitCode = 1;

  if (isJsonMode()) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  const mark = r.verified ? colors.green("✔ VERIFIED") : colors.red("✗ FAILED");
  // eslint-disable-next-line no-console
  console.log(`${mark}  ${colors.cyanBold(runId)}  ${colors.dim(`(${mode})`)}`);

  const check = (label: string, val: boolean | null | undefined): void => {
    if (val === null || val === undefined) return;
    // eslint-disable-next-line no-console
    console.log(`  ${val ? colors.green("✔") : colors.red("✗")} ${label}`);
  };
  check("signature valid", r.signatureValid);
  check("outputs hash matches", r.outputsHashMatches);
  check("benchmark content hash matches", r.benchmarkContentHashMatches);

  const signerKeyId = r.signedBy?.keyId ?? r.signerKeyId;
  if (signerKeyId) {
    // eslint-disable-next-line no-console
    console.log(colors.dim(`  signer: ${signerKeyId}`));
  }
  for (const w of r.warnings ?? []) {
    // eslint-disable-next-line no-console
    console.log(colors.yellow(`  ⚠ ${w}`));
  }
  for (const e of r.errors ?? []) {
    // eslint-disable-next-line no-console
    console.log(colors.red(`  ✗ ${e}`));
  }
}

export function registerTrustVerifyCommand(parent: Command): void {
  parent
    .command("verify <run-id>")
    .description(
      "Verify the cryptographic signature and integrity of a TrustBench run"
    )
    .option("--strict", "Fail on any warning, not just hard errors", false)
    .option(
      "--remote",
      "Use the server-side verifier (default: local via @divinci-ai/trustbench-verifier)",
      false
    )
    .action(async (runId: string, opts, cmd) => {
      try {
        const http = await resolveTrustHttp(cmd.optsWithGlobals());

        if (opts.remote) {
          // Server-side verification — works for the owner's private runs too.
          const path =
            `/v1/trustbench/runs/${encodeURIComponent(runId)}/verify` +
            (opts.strict ? "?strict=1" : "");
          const result = await withSpinner("Verifying (server-side)...", () =>
            trustGet<VerifyResultLike>(http, path)
          );
          reportVerify(result, runId, "server");
          return;
        }

        // Local, independent verification: pull the PUBLIC signed manifest +
        // outputs and verify offline against the well-known key registry. This
        // is the whole point of TrustBench — anyone can reproduce it.
        let manifest: unknown;
        try {
          manifest = await withSpinner("Fetching public manifest...", () =>
            trustGet<unknown>(
              http,
              `/v1/trustbench/public/runs/${encodeURIComponent(runId)}/manifest`
            )
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("HTTP 404")) {
            throw new Error(
              `No public manifest for ${runId}. Local verification needs a PUBLIC, ` +
                `complete run. To verify your own private run, use: ` +
                `divinci trust verify ${runId} --remote`
            );
          }
          throw e;
        }

        // Outputs are optional for signature verification; fetch best-effort so
        // we can also confirm the outputsHash when present.
        const outputs = await trustGetPublicBytes(
          http,
          `/v1/trustbench/public/runs/${encodeURIComponent(runId)}/outputs`
        );

        const result = await withSpinner("Verifying signature...", () =>
          verify(manifest, {
            wellKnownUrl: wellKnownUrlFor(http),
            outputs: outputs ?? undefined,
            strict: Boolean(opts.strict),
          })
        );
        reportVerify(result, runId, "local");
      } catch (error) {
        handleCommandError(error);
      }
    });
}
