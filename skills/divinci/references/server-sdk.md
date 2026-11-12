# Node.js SDK reference (`@divinci-ai/server`)

Full platform access for backends and automation. Node 18+.

```bash
npm install @divinci-ai/server
```

```typescript
import { DivinciServer } from "@divinci-ai/server";
const divinci = new DivinciServer({ apiKey: process.env.DIVINCI_API_KEY });
```

Keep the API key server-side only (env var / secret manager — never in
client bundles or source control).

## Namespaces

`workspaces` · `releases` · `rag` · `transcripts` (`ai-chats`) · `apiKeys` ·
`hermesAgents` · `arena` · `fineTune` · `trainingData` · `qa` · `redTeam` ·
`audio` · `byok` · `connectors` · `groups` · `permissions` ·
`notifications` · `analytics` · `metrics` · `feedback` · `mcpServers` ·
`skills` · `terms` · `phoneUsage` · `usage` · `x402`

Each namespace mirrors the REST surface with typed methods
(`list`/`get`/`create`/`update`/`delete` plus domain-specific verbs).
Full per-namespace docs: https://sdk.divinci.ai/server/overview

## Common workflows

### Workspace + release provisioning

```typescript
const workspace = await divinci.workspaces.create({
  name: "Customer Support",
  description: "AI-powered support assistant",
});

const release = await divinci.releases.create({
  workspaceId: workspace._id,
  name: "Support Bot v1",
  systemPrompt: "You are a helpful support agent…",
  config: { model: "gpt-4o", temperature: 0.7 },
});

const analytics = await divinci.releases.getAnalytics(release._id, {
  startDate: new Date("2026-01-01"),
  endDate: new Date(),
});
```

### RAG ingestion

```typescript
await divinci.rag.uploadDocument({
  workspaceId: workspace._id,
  ragVectorId: "rag_xyz",
  file: fs.createReadStream("./knowledge.pdf"),
});
```

For large files, prefer fire-and-forget upload and poll processing status
rather than holding the request open — edge proxies time out long
synchronous embedding runs (~2 min). Watch the vector's `chunkSources[]`
(done), `pendingChunkSources[]` (in-flight), and `failedChunkSources[]`
(failed, with reasons) for your document id; poll every 5–10 s.

### Batch transcript ingestion — REMOVED 2026-08-07

`transcripts.ingestBatch` no longer exists: it throws, and the endpoint answers
410. It was the only write path that skipped moderation, de-identification and
inference, and it accepted a caller-supplied message role — a `system` message
written that way was replayed to the model as a real instruction on later turns.

There is no replacement. If you run inference outside Divinci, persist it
yourself. Use `transcripts.addMessage` to have Divinci generate and record a
turn through the full pipeline.

### Red-team a deployed release

```typescript
const plan = await divinci.redTeam.plan(workspace._id);
const batch = await divinci.redTeam.run(workspace._id, {
  releaseId: release._id,
  category: "prompt-injection",
  systemPrompt: "You are a support agent…",
});
if (!batch.measured) {
  throw new Error("category was not fully measured — do not cite the rate");
}
```

One category per `run()` (a full sweep is 32 billed model calls). Use
`runSweep()` to walk them sequentially. Attack-success rates are
**lower-is-better**; `measured: false` means the 0.0 is not a score.
Docs: https://sdk.divinci.ai/server/red-team/

### API key management

```typescript
const key = await divinci.apiKeys.create({
  workspaceId: workspace._id,
  name: "ci-ingest",
});
// The secret is returned once at creation — store it immediately.
```

## Error handling

Methods throw typed `DivinciError` subclasses carrying HTTP `status` and a
structured body. Branch on class/status, not message text. 429s include
retry information; implement backoff for bulk ingestion loops.
