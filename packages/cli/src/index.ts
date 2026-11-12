import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setColorsEnabled } from "./output/colors.js";
import { setQuietMode } from "./output/spinner.js";
import { setJsonMode, setOutputQuietMode } from "./output/formatter.js";

/**
 * Read the CLI's version from its own package.json at runtime so
 * `divinci --version` and the published package version stay in lockstep.
 * Previously hardcoded — got skewed during the 0.2.0 release because
 * changesets only bumps package.json, not source-code constants.
 */
function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/src/index.js → <pkg-root>/package.json    (published install)
  // src/index.ts via tsx → <pkg-root>/package.json (local dev)
  const candidates = [
    join(here, "..", "..", "package.json"),
    join(here, "..", "package.json"),
  ];
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as { name?: string; version?: string };
      if (pkg.name === "@divinci-ai/cli" && pkg.version) {
        return pkg.version;
      }
    } catch {
      // try next candidate
    }
  }
  return "unknown";
}

// Auth commands
import { registerLoginCommand } from "./commands/auth/login.js";
import { registerLogoutCommand } from "./commands/auth/logout.js";
import { registerStatusCommand } from "./commands/auth/status.js";

// Chat commands
import { registerChatCommand } from "./commands/chat/index.js";

// Terms of Service commands
import { registerTermsCommand } from "./commands/terms/index.js";
import { registerModelEditsCommand } from "./commands/model-edits/index.js";
import { registerPrivacyCommand } from "./commands/privacy/index.js";
import { registerBugReportCommand } from "./commands/bug-report/index.js";
import { setTelemetryContext } from "./utils/errors.js";
import { isReportingEnabled, flushPendingReports } from "./telemetry/error-report.js";

// RAG commands
import { registerRagSearchCommand } from "./commands/rag/search.js";
import { registerRagFilesCommand } from "./commands/rag/files.js";
import { registerRagSetSourceUrlCommand } from "./commands/rag/source-url.js";
import { registerRagStatusCommand } from "./commands/rag/status.js";
import { registerRagUploadCommand } from "./commands/rag/upload.js";
import { registerRagEstimateCommand } from "./commands/rag/estimate.js";
import { registerRagCrawlCommand } from "./commands/rag/crawl.js";
import { registerRagCrawlStatusCommand } from "./commands/rag/crawl-status.js";
import { registerRagTargetsCommand } from "./commands/rag/targets.js";
import { registerRagReindexCommand } from "./commands/rag/reindex.js";
import { registerRagConfigCommand } from "./commands/rag/config.js";
import { registerRagModelsCommand } from "./commands/rag/models.js";
import { registerRagGroupsCommand } from "./commands/rag/groups.js";
import { registerRagSetTreeSearchModelCommand } from "./commands/rag/set-tree-search-model.js";
import { registerRagSetPageIndexHostCommand } from "./commands/rag/set-pageindex-host.js";
import { registerRagHealthCommand } from "./commands/rag/health.js";
import { registerRagEventsCommand } from "./commands/rag/events.js";
import { registerRagTestRetrievalCommand } from "./commands/rag/test-retrieval.js";
import { registerRagChunksCommand } from "./commands/rag/chunks.js";
import { registerRagSynthesizeCommand } from "./commands/rag/synthesize/index.js";
import {
  registerRagDedupeChunksCommand,
  registerRagDedupeFilesCommand,
  registerRagScanArtifactsCommand,
} from "./commands/rag/dedupe.js";
import { registerRagBackfillChunksCountCommand } from "./commands/rag/backfill-chunks-count.js";
import { registerRagProductsCommand } from "./commands/rag/products.js";
import { registerRagD1ProvisionCommand } from "./commands/rag/d1-provision.js";
import { registerArenaPresetUpdateVariantCommand } from "./commands/arena-preset/update-variant.js";
import { registerArenaPresetListCommand } from "./commands/arena-preset/list.js";
import { registerArenaPresetExportCommand } from "./commands/arena-preset/export.js";
import { registerArenaPresetCloneCommand } from "./commands/arena-preset/clone.js";

// Release commands
import { registerReleaseListCommand } from "./commands/release/list.js";

// TrustBench commands (v1 — skeletons, see strategy/implementation/2026-04-26-trustbench-v1-implementation-plan.md)
import { registerTrustRunCommand } from "./commands/trust/run.js";
import { registerTrustVerifyCommand } from "./commands/trust/verify.js";
import { registerTrustListCommand } from "./commands/trust/list.js";
import { registerTrustGetCommand } from "./commands/trust/get.js";
import { registerTrustOutputsCommand } from "./commands/trust/outputs.js";
import { registerTrustLeaderboardCommand } from "./commands/trust/leaderboard.js";
import { registerTrustBenchmarksCommand } from "./commands/trust/benchmarks.js";
import { registerTrustSetVisibilityCommand } from "./commands/trust/set-visibility.js";
import { registerComplianceAnnexIvCommand } from "./commands/compliance/annex-iv.js";
import { registerComplianceAnswerCommands } from "./commands/compliance/answers.js";

// Hosted Hermes Agents (Divinci-hosted, isolated NousResearch/hermes-agent)
import { registerHermesCreateCommand } from "./commands/hermes/create.js";
import { registerHermesListCommand } from "./commands/hermes/list.js";
import { registerHermesChatCommand } from "./commands/hermes/chat.js";
import { registerHermesDeleteCommand } from "./commands/hermes/delete.js";
import { registerHermesKeyCommand } from "./commands/hermes/key.js";
// `get` and `update` were written but never mounted, so `divinci hermes update`
// simply did not exist despite the code being present and type-checked — the
// same "written but never wired" failure as slack.homeChannelId. Mounted here.
import { registerHermesGetCommand } from "./commands/hermes/get.js";
import { registerHermesUpdateCommand } from "./commands/hermes/update.js";
import { registerHermesProactiveCommand } from "./commands/hermes/proactive.js";
import { registerReleaseGetCommand } from "./commands/release/get.js";
import { registerReleaseCreateCommand } from "./commands/release/create.js";
import { registerReleaseUpdateCommand } from "./commands/release/update.js";
import { registerReleaseDeleteCommand } from "./commands/release/delete.js";
import { registerReleasePublishCommand } from "./commands/release/publish.js";
import { registerReleaseDeriveThemeCommand } from "./commands/release/derive-theme.js";
import { registerReleaseCreateFromMcpCommand } from "./commands/release/create-from-mcp.js";
import { registerReleaseCloneCommand } from "./commands/release/clone.js";
import { registerDocsCommands } from "./commands/docs/index.js";

// Audio commands
import { registerAudioListCommand } from "./commands/audio/list.js";
import { registerAudioGetCommand } from "./commands/audio/get.js";
import { registerAudioUploadUrlCommand } from "./commands/audio/upload-url.js";
import { registerAudioDeleteCommand } from "./commands/audio/delete.js";
import { registerAudioGenerateRagCommand } from "./commands/audio/generate-rag.js";

// Training data commands
import { registerTrainingDataGenerateCommand } from "./commands/training-data/generate.js";
import { registerTrainingDataListCommand } from "./commands/training-data/list.js";
import { registerTrainingDataStatusCommand } from "./commands/training-data/status.js";
import { registerTrainingDataExportCommand } from "./commands/training-data/export.js";
import { registerTrainingDataDeleteCommand } from "./commands/training-data/delete.js";
import { registerTrainingDataExportToRagCommand } from "./commands/training-data/export-to-rag.js";

// QA commands
import { registerQASuitesListCommand, registerQASuitesGetCommand } from "./commands/qa/suites.js";
import { registerQASuitesSetScorersCommand } from "./commands/qa/set-scorers.js";
import { registerQASuitesCreateCommand, registerQATestsAddCommand } from "./commands/qa/suite-create.js";
import { registerQACopySuiteFromCommand } from "./commands/qa/copy-suite-from.js";
import { registerQAExternalRunCommand, registerQAExternalLiveCommands } from "./commands/qa/external-run.js";
import { registerQAMultiReleaseRunCommand } from "./commands/qa/multi-release-run.js";
import { registerQAEstimateRunCommand } from "./commands/qa/estimate-run.js";
import { registerQAArenaRunCommand } from "./commands/qa/arena-run.js";
import { registerQARunCommand } from "./commands/qa/run.js";
import { registerQARunsListCommand, registerQARunsGetCommand, registerQARunsCancelCommand } from "./commands/qa/runs.js";
import { registerQATrainFromRunCommand } from "./commands/qa/train-from-run.js";
import { registerQAPublishToTrustCommand } from "./commands/qa/publish-to-trust.js";
import { registerQAHeldOutCommand } from "./commands/qa/held-out.js";
import { registerQAPublishToTrustBatchCommand } from "./commands/qa/publish-to-trust-batch.js";
import { registerQAGenerateTestsCommand } from "./commands/qa/generate-tests.js";
import { registerQAAugmentTrainingSetCommand } from "./commands/qa/augment-training-set.js";
import { registerQACalibrateCommand } from "./commands/qa/calibrate.js";
import { registerQAExportEditedResponsesCommand } from "./commands/qa/export-edited-responses.js";
import { registerQASnapshotRagGroupCommand } from "./commands/qa/snapshot-rag-group.js";
import { registerQABackfillReleaseSnapshotsCommand } from "./commands/qa/backfill-release-snapshots.js";
import { registerQAExportCommand, registerQAImportCommand } from "./commands/qa/export-import.js";
import { registerQARegenerateCommand } from "./commands/qa/regenerate.js";
import { registerQAWinnerPickCommand } from "./commands/qa/winner-pick.js";
import { registerQAListRatingsCommand } from "./commands/qa/list-ratings.js";
import { registerQAListWinnerPicksCommand } from "./commands/qa/list-winner-picks.js";
import { registerQAAutoFixCommands } from "./commands/qa/auto-fix.js";

// Fine-tune commands
import { registerFineTuneListCommand } from "./commands/fine-tune/list.js";
import { registerFineTuneModelsCommand } from "./commands/fine-tune/models.js";
import { registerFineTuneGetCommand } from "./commands/fine-tune/get.js";
import { registerFineTuneCreateCommand } from "./commands/fine-tune/create.js";
import { registerFineTuneDeleteCommand } from "./commands/fine-tune/delete.js";
import { registerFineTuneStartCommand } from "./commands/fine-tune/start.js";
import { registerFineTuneStatusCommand } from "./commands/fine-tune/status.js";
import { registerFineTuneCancelCommand } from "./commands/fine-tune/cancel.js";
import { registerFineTuneExportToQACommand } from "./commands/fine-tune/export-to-qa.js";
import { registerFineTuneCopyFromCommand } from "./commands/fine-tune/copy-from.js";
import { registerStylePatternCommands } from "./commands/style-pattern/index.js";

// Config commands
import { registerConfigGetCommand } from "./commands/config/get.js";
import { registerConfigSetTitleCommand } from "./commands/config/set-title.js";
import { registerConfigSetDescriptionCommand } from "./commands/config/set-description.js";
import { registerConfigExportCommand } from "./commands/config/export.js";

// Workspace commands
import { registerWorkspaceListCommand } from "./commands/workspace/list.js";
import { registerWorkspaceGetCommand } from "./commands/workspace/get.js";
import { registerWorkspaceMcpSettingsCommand } from "./commands/workspace/mcp-settings.js";
import { registerWorkspaceUseCommand } from "./commands/workspace/use.js";
import { registerWorkspaceCreateCommand } from "./commands/workspace/create.js";
import { registerWorkspaceBaaCommand } from "./commands/workspace/baa.js";
import { registerWorkspaceUpdateCommand } from "./commands/workspace/update.js";
import { registerWorkspaceDeleteCommand } from "./commands/workspace/delete.js";
import { registerWorkspaceCloneCommand } from "./commands/workspace/clone.js";
import { registerWorkspaceInviteCommand } from "./commands/workspace/invite.js";

// Group commands
import { registerGroupCreateCommand } from "./commands/group/create.js";
import { registerGroupListCommand } from "./commands/group/list.js";
import { registerGroupGetCommand } from "./commands/group/get.js";
import { registerGroupUpdateCommand } from "./commands/group/update.js";
import { registerGroupDeleteCommand } from "./commands/group/delete.js";
import { registerGroupInviteCommand } from "./commands/group/invite.js";
import { registerGroupRemoveUserCommand } from "./commands/group/remove-user.js";

// Permission commands
import { registerPermissionsListCommand } from "./commands/permissions/list.js";
import { registerPermissionsMineCommand } from "./commands/permissions/mine.js";
import { registerPermissionsGrantCommand } from "./commands/permissions/grant.js";
import { registerPermissionsRevokeCommand } from "./commands/permissions/revoke.js";

// BYOK commands (provider credentials per whitelabel)
import {
  registerNotificationsCommands,
  registerFlaggerCommands,
} from "./commands/notifications/index.js";
import { registerAnalyticsCommands } from "./commands/analytics/index.js";
import { registerUserSkillsCommands } from "./commands/user-skills/index.js";
import { registerMetricsCommands } from "./commands/metrics/index.js";
import { registerPhoneCommands } from "./commands/phone/index.js";
import { registerRedTeamCommands } from "./commands/red-team/index.js";
import { registerConnectorsCommands } from "./commands/connectors/index.js";
import { registerExternalToolsCommands } from "./commands/external-tools/index.js";
import { registerFeedbackCommands } from "./commands/feedback/index.js";
import { registerByokCreateCommand } from "./commands/byok/create.js";
import { registerByokListCommand } from "./commands/byok/list.js";
import { registerByokGetCommand } from "./commands/byok/get.js";
import { registerByokRotateCommand } from "./commands/byok/rotate.js";
import { registerByokDeleteCommand } from "./commands/byok/delete.js";
import { registerByokTestCommand } from "./commands/byok/test.js";

// API key commands (long-lived workspace tokens for daemons / CI)
import { registerApiKeyCreateCommand } from "./commands/api-key/create.js";
import { registerApiKeyListCommand } from "./commands/api-key/list.js";
import { registerApiKeyDeleteCommand } from "./commands/api-key/delete.js";
import { registerApiKeyRotateCommand } from "./commands/api-key/rotate.js";
import { registerApiKeyUpdateCommand } from "./commands/api-key/update.js";
import { registerApiKeyRequestLimitCommand } from "./commands/api-key/request-limit.js";

// Platform-admin commands
import { registerAdminRateLimitRequestsListCommand } from "./commands/admin/rate-limit-requests/list.js";
import { registerAdminRateLimitRequestsDecideCommand } from "./commands/admin/rate-limit-requests/decide.js";

// API passthrough
import { registerApiCommand } from "./commands/api.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("divinci")
    .description("Official Divinci AI CLI")
    .version(readPackageVersion())
    .option("--api-key <key>", "Override API key")
    .option("--workspace <id>", "Override workspace ID")
    .option("--json", "Output as JSON (for scripting)")
    .option("--no-color", "Disable colored output")
    .option("--quiet", "Minimal output")
    .option("--verbose", "Debug output")
    .option("--profile <name>", "Named profile", "default")
    .option("--api-url <url>", "Override API base URL")
    .hook("preAction", (_thisCommand, actionCommand) => {
      const opts = actionCommand.optsWithGlobals();
      if (opts.json) setJsonMode(true);
      if (opts.color === false) setColorsEnabled(false);
      if (opts.quiet) {
        setQuietMode(true);
        setOutputQuietMode(true);
      }
    });

  // Auth command group
  const auth = program.command("auth").description("Authentication management");
  registerLoginCommand(auth);
  registerLogoutCommand(auth);
  registerStatusCommand(auth);

  // Chat command (with REPL as default action + subcommands)
  registerChatCommand(program);

  // Terms of Service (view + accept a release's versioned terms)
  registerTermsCommand(program);
  registerModelEditsCommand(program);
  registerPrivacyCommand(program);
  registerBugReportCommand(program);

  // RAG command group
  const rag = program.command("rag").description("Knowledge base and RAG operations");
  registerRagSearchCommand(rag);
  registerRagFilesCommand(rag);
  registerRagSetSourceUrlCommand(rag);
  registerRagStatusCommand(rag);
  registerRagUploadCommand(rag);
  registerRagEstimateCommand(rag);
  registerRagCrawlCommand(rag);
  registerRagCrawlStatusCommand(rag);
  registerRagTargetsCommand(rag);
  registerRagReindexCommand(rag);
  registerRagConfigCommand(rag);
  registerRagModelsCommand(rag);
  registerRagGroupsCommand(rag);
  registerRagSetTreeSearchModelCommand(rag);
  registerRagSetPageIndexHostCommand(rag);
  registerRagHealthCommand(rag);
  registerRagEventsCommand(rag);
  registerRagTestRetrievalCommand(rag);
  registerRagChunksCommand(rag);
  registerRagSynthesizeCommand(rag);
  registerRagDedupeChunksCommand(rag);
  registerRagDedupeFilesCommand(rag);
  registerRagScanArtifactsCommand(rag);
  registerRagBackfillChunksCountCommand(rag);
  registerRagProductsCommand(rag);
  registerRagD1ProvisionCommand(rag);

  // Arena preset management
  const arenaPreset = program.command("arena-preset").description("Arena preset management");
  registerArenaPresetUpdateVariantCommand(arenaPreset);
  registerArenaPresetListCommand(arenaPreset);
  registerArenaPresetExportCommand(arenaPreset);
  registerArenaPresetCloneCommand(arenaPreset);

  // Release command group
  const release = program.command("release").description("Release management");
  registerReleaseListCommand(release);
  registerReleaseGetCommand(release);
  registerReleaseCreateCommand(release);
  registerReleaseUpdateCommand(release);
  registerReleaseDeleteCommand(release);
  registerReleasePublishCommand(release);
  registerReleaseDeriveThemeCommand(release);
  registerReleaseCreateFromMcpCommand(release);
  registerReleaseCloneCommand(release);

  // Divinci Docs — embed the assistant on existing docs (Mode A) / generate a
  // docs site (Mode B), composing the release + rag primitives above.
  registerDocsCommands(program);

  // TrustBench command group (v1 — runner skeletons; backend ships 2026-05-09)
  const trust = program
    .command("trust")
    .description(
      "TrustBench — attested AI evaluations with cryptographically signed run logs"
    );
  registerTrustRunCommand(trust);
  registerTrustVerifyCommand(trust);
  registerTrustListCommand(trust);
  registerTrustBenchmarksCommand(trust);
  registerTrustSetVisibilityCommand(trust);
  registerTrustGetCommand(trust);
  registerTrustOutputsCommand(trust);
  registerTrustLeaderboardCommand(trust);

  // Compliance command group — regulator-facing documentation artifacts.
  const compliance = program
    .command("compliance")
    .description(
      "Compliance artifacts — EU AI Act Annex IV technical documentation"
    );
  registerComplianceAnnexIvCommand(compliance);
  registerComplianceAnswerCommands(compliance);

  // Red-team a DEPLOYED release (same corpus as TrustBench red-team benches)
  const redTeam = program
    .command("red-team")
    .alias("redteam")
    .description(
      "Red-team a deployed release — prompt injection, jailbreak, leak, exfil, harmful content, indirect injection, scope",
    );
  registerRedTeamCommands(redTeam);

  // Hosted Hermes Agents command group
  const hermes = program
    .command("hermes")
    .description(
      "Hosted Hermes agents — isolated NousResearch/hermes-agent containers, " +
        "with platform (Vertex/Cloudflare) or BYOK models",
    );
  registerHermesCreateCommand(hermes);
  registerHermesListCommand(hermes);
  registerHermesGetCommand(hermes);
  registerHermesChatCommand(hermes);
  registerHermesUpdateCommand(hermes);
  registerHermesProactiveCommand(hermes);
  registerHermesKeyCommand(hermes);
  registerHermesDeleteCommand(hermes);

  // Audio command group
  const audio = program.command("audio").description("Audio transcript management");
  registerAudioListCommand(audio);
  registerAudioGetCommand(audio);
  registerAudioUploadUrlCommand(audio);
  registerAudioDeleteCommand(audio);
  registerAudioGenerateRagCommand(audio);

  // Training data command group
  const trainingData = program.command("training-data").description("Generate training data from RAG files");
  registerTrainingDataGenerateCommand(trainingData);
  registerTrainingDataListCommand(trainingData);
  registerTrainingDataStatusCommand(trainingData);
  registerTrainingDataExportCommand(trainingData);
  registerTrainingDataExportToRagCommand(trainingData);
  registerTrainingDataDeleteCommand(trainingData);

  // QA command group
  const qa = program.command("qa").description("Quality assurance test suites and validation");
  const qaSuites = qa.command("suites").description("Manage QA test suites");
  registerQASuitesListCommand(qaSuites);
  registerQASuitesGetCommand(qaSuites);
  registerQASuitesSetScorersCommand(qaSuites);
  registerQASuitesCreateCommand(qaSuites);
  registerQACopySuiteFromCommand(qa);
  registerQAExternalRunCommand(qa);
  registerQAExternalLiveCommands(qa);
  registerQAMultiReleaseRunCommand(qa);
  registerQAEstimateRunCommand(qa);
  registerQAArenaRunCommand(qa);
  registerQAPublishToTrustCommand(qa);
  registerQAHeldOutCommand(qa);
  registerQAPublishToTrustBatchCommand(qa);
  registerQARunCommand(qa);
  const qaRuns = qa.command("runs").description("Browse and inspect run results");
  registerQARunsListCommand(qaRuns);
  registerQARunsGetCommand(qaRuns);
  registerQARunsCancelCommand(qaRuns);
  registerQAAutoFixCommands(qa);
  registerQATrainFromRunCommand(qaRuns);
  const qaTests = qa.command("tests").description("Manage and generate QA test cases");
  registerQAGenerateTestsCommand(qaTests);
  registerQATestsAddCommand(qaTests);
  registerQAAugmentTrainingSetCommand(qa);
  registerQACalibrateCommand(qa);
  registerQAExportEditedResponsesCommand(qa);
  registerQASnapshotRagGroupCommand(qa);
  registerQABackfillReleaseSnapshotsCommand(qa);
  registerQAExportCommand(qa);
  registerQAImportCommand(qa);
  registerQARegenerateCommand(qa);
  registerQAWinnerPickCommand(qa);
  registerQAListRatingsCommand(qa);
  registerQAListWinnerPicksCommand(qa);

  // Fine-tune command group
  const fineTune = program.command("fine-tune").description("Fine-tuning management");
  registerFineTuneListCommand(fineTune);
  registerFineTuneModelsCommand(fineTune);
  registerFineTuneGetCommand(fineTune);
  registerFineTuneCreateCommand(fineTune);
  registerFineTuneDeleteCommand(fineTune);
  registerFineTuneStartCommand(fineTune);
  registerFineTuneStatusCommand(fineTune);
  registerFineTuneCancelCommand(fineTune);
  registerFineTuneExportToQACommand(fineTune);
  registerFineTuneCopyFromCommand(fineTune);

  // Style-pattern command group
  registerStylePatternCommands(program);

  // Config command group
  const configCmd = program.command("config").description("Workspace configuration");
  registerConfigGetCommand(configCmd);
  registerConfigSetTitleCommand(configCmd);
  registerConfigSetDescriptionCommand(configCmd);
  registerConfigExportCommand(configCmd);

  // Workspace command group
  const workspace = program
    .command("workspace")
    .alias("ws")
    .description("Workspace management");
  registerWorkspaceListCommand(workspace);
  registerWorkspaceGetCommand(workspace);
  registerWorkspaceMcpSettingsCommand(workspace);
  registerWorkspaceUseCommand(workspace);
  registerWorkspaceCreateCommand(workspace);
  registerWorkspaceBaaCommand(workspace);
  registerWorkspaceUpdateCommand(workspace);
  registerWorkspaceDeleteCommand(workspace);
  registerWorkspaceCloneCommand(workspace);
  registerWorkspaceInviteCommand(workspace);

  // Group command group
  const group = program.command("group").description("User group management");
  registerGroupCreateCommand(group);
  registerGroupListCommand(group);
  registerGroupGetCommand(group);
  registerGroupUpdateCommand(group);
  registerGroupDeleteCommand(group);
  registerGroupInviteCommand(group);
  registerGroupRemoveUserCommand(group);

  // Permission command group
  const permissions = program.command("permissions").description("Permission management");
  registerPermissionsListCommand(permissions);
  registerPermissionsMineCommand(permissions);
  registerPermissionsGrantCommand(permissions);
  registerPermissionsRevokeCommand(permissions);

  // BYOK command group (provider credentials per whitelabel — Neo4j, OpenAI, etc.)
  const byok = program.command("byok").description("Bring-your-own-key provider credentials (Neo4j, OpenAI, Anthropic, etc.)");
  registerByokCreateCommand(byok);
  registerByokListCommand(byok);
  registerByokGetCommand(byok);
  registerByokRotateCommand(byok);
  registerByokTestCommand(byok);
  registerByokDeleteCommand(byok);

  // API key command group (long-lived workspace tokens for daemons / CI;
  // OAuth-gated, secret returned exactly once on create/rotate)
  const apiKey = program
    .command("api-key")
    .description("Manage workspace API keys (long-lived tokens for daemons / CI)");
  registerApiKeyCreateCommand(apiKey);
  registerApiKeyListCommand(apiKey);
  registerApiKeyRotateCommand(apiKey);
  registerApiKeyUpdateCommand(apiKey);
  registerApiKeyDeleteCommand(apiKey);
  registerApiKeyRequestLimitCommand(apiKey);

  // Platform-admin command group. OAuth-only ; platform-admin role
  // gate enforced server-side (see api/v1/routes/admin-*.ts).
  const admin = program
    .command("admin")
    .description("Platform-admin operations (requires platform-admin role server-side)");
  const adminRateLimitRequests = admin
    .command("rate-limit-requests")
    .description("Review + decide rate-limit upgrade requests");
  registerAdminRateLimitRequestsListCommand(adminRateLimitRequests);
  registerAdminRateLimitRequestsDecideCommand(adminRateLimitRequests);

  // Notifications command group (notifications + delivery channels/triggers)
  const notifications = program
    .command("notifications")
    .description("Workspace notifications, delivery channels (email/webhook), and triggers");
  registerNotificationsCommands(notifications);

  // User-skills command group (end-user-owned skill instances: email-user, etc.)
  const userSkills = program
    .command("user-skills")
    .description("Your user-owned skill instances (e.g. email-user) — installed per user, not per release");
  registerUserSkillsCommands(userSkills);

  // Custom notification flaggers (LLM-driven custom notifications)
  const flagger = program
    .command("flagger")
    .description("Custom LLM-driven notification flaggers (create/test custom notifications)");
  registerFlaggerCommands(flagger);

  // Analytics command group (product analytics for AI releases)
  const analytics = program
    .command("analytics")
    .description("Product analytics: metrics, trends, experiments, funnel");
  registerAnalyticsCommands(analytics);

  // Metrics command group (pipeline telemetry + custom alert configs + usage)
  const metrics = program
    .command("metrics")
    .description("Pipeline telemetry, custom metric alerts, usage + billing");
  registerMetricsCommands(metrics);

  // Phone command group (unbilled voice-call + SMS/MMS usage)
  const phone = program
    .command("phone")
    .description("Voice-call and SMS/MMS usage — see the Phone Billing guide for the full billing model");
  registerPhoneCommands(phone);

  // Connectors command group (web_crawl → RAG vector, recurring sync)
  const connectors = program
    .command("connectors")
    .description("Data connectors — crawl a website or sync a WordPress install into a RAG vector, optionally recurring");
  registerConnectorsCommands(connectors);

  const externalTools = program
    .command("external-tools")
    .description("Third-party RAG ecosystem — register your own parser or retriever endpoint");
  registerExternalToolsCommands(externalTools);

  // Feedback command group (admin-tier read of message feedback)
  const feedback = program
    .command("feedback")
    .description("Read end-user ratings on chat messages (admin). NOT for reporting CLI problems — use `divinci bug-report`");
  registerFeedbackCommands(feedback);

  // API passthrough
  registerApiCommand(program);

  return program;
}

export function run(argv: string[]): void {
  const program = createProgram();

  // Give the error funnel the command NAME and the target API, so a queued
  // report can say what failed and where without re-parsing argv. Arguments are
  // deliberately never captured — they carry paths, ids and prompt text.
  program.hook("preAction", (thisCommand, actionCommand) => {
    const names: string[] = [];
    for (let c: Command | null = actionCommand; c && c !== program; c = c.parent) {
      names.unshift(c.name());
    }
    const opts = actionCommand.optsWithGlobals() as { apiUrl?: string };
    setTelemetryContext({
      command: names.join(" ") || actionCommand.name(),
      apiUrl: opts.apiUrl ?? process.env.DIVINCI_API_URL ?? "https://api.divinci.app",
      cliVersion: program.version() ?? "0.0.0",
    });
    void thisCommand;
  });

  // Flush anything a previous run queued. Fire-and-forget: it must never delay
  // the command, and a report that does not make it stays queued for next time,
  // which makes this self-healing rather than lossy.
  if (isReportingEnabled()) {
    void flushPendingReports(
      process.env.DIVINCI_API_URL ?? "https://api.divinci.app",
    );
  }

  program.parseAsync(argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
