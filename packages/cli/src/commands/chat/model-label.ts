/** Human-readable label for the model/assistant that served a transcript message. */
export function formatServedModelLabel(name: string): string {
  if (!name) {
    return "(unknown)";
  }
  const vertex = name.match(
    /^projects\/([^/]+)\/locations\/([^/]+)\/models\/([^/@]+)(?:@(\d+))?$/,
  );
  if (vertex) {
    const [, , location, modelId, version] = vertex;
    const ver = version ? `@${version}` : "";
    return `vertex-finetune:${modelId}${ver} (${location})`;
  }
  return name;
}
