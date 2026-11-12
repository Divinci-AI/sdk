/**
 * Signing a TrustBench run from a suite, and changing a suite's held-out mark,
 * go through the workspace's /white-label routes, which need a signed-in
 * member. The public-api refuses an API key there (writes do not pass
 * agentOrUserAuth with a key; held-out.ts refuses a key outright when
 * clearing), so an API-key-only profile is told up front instead of sending
 * `Bearer undefined` and reading a bare 401.
 */
export const SIGNED_IN_ONLY =
  "This command needs a signed-in workspace member: run `divinci login`. " +
  "Workspace API keys cannot sign TrustBench runs or change a held-out mark.";
