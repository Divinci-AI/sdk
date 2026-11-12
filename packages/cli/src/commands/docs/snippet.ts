import { Command } from "commander";
import { output, isJsonMode } from "../../output/formatter.js";
import { handleCommandError } from "../../utils/errors.js";

export type SnippetKind = "npm" | "script" | "astro";

/**
 * Produce the copy-paste embed snippet for the open-source "Ask Divinci" widget
 * (@divinci-ai/embed-chat-ui) bound to a Release. Pure so it's unit-testable and
 * usable from the web flow too. `npm` = bundler/framework, `script` = a CDN
 * module script for plain HTML, `astro` = a Starlight Footer-override component.
 */
export function embedSnippet(opts: {
  releaseId: string;
  apiUrl?: string;
  kind?: SnippetKind;
}): string {
  const releaseId = opts.releaseId;
  const apiUrl = (opts.apiUrl || "https://api.divinci.app").replace(/\/+$/, "");
  const kind = opts.kind || "npm";

  if (kind === "script") {
    return [
      `<script type="module">`,
      `  import { mount } from "https://esm.sh/@divinci-ai/embed-chat-ui";`,
      `  mount(document.body, {`,
      `    releaseId: ${JSON.stringify(releaseId)},`,
      `    apiUrl: ${JSON.stringify(apiUrl)},`,
      `  });`,
      `</script>`,
    ].join("\n");
  }

  if (kind === "astro") {
    return [
      `// 1. npm install @divinci-ai/embed-chat-ui @divinci-ai/client`,
      `// 2. src/components/DocsAssistant.astro (mount in a Starlight Footer override):`,
      `<script>`,
      `  import { mount } from "@divinci-ai/embed-chat-ui";`,
      `  mount(document.body, {`,
      `    releaseId: ${JSON.stringify(releaseId)},`,
      `    apiUrl: ${JSON.stringify(apiUrl)},`,
      `  });`,
      `</script>`,
      `<!-- Map your theme tokens to --divinci-* on #divinci-docs-assistant. -->`,
    ].join("\n");
  }

  // npm / bundler / framework (React, Vue, Svelte, vanilla)
  return [
    `# Install`,
    `npm install @divinci-ai/embed-chat-ui @divinci-ai/client`,
    ``,
    `# Mount once, anywhere on your site:`,
    `import { mount } from "@divinci-ai/embed-chat-ui";`,
    ``,
    `mount(document.body, {`,
    `  releaseId: ${JSON.stringify(releaseId)},`,
    `  apiUrl: ${JSON.stringify(apiUrl)},`,
    `});`,
  ].join("\n");
}

export function registerDocsSnippetCommand(parent: Command): void {
  parent
    .command("snippet <releaseId>")
    .description("Print the embed snippet for the Ask-Divinci widget bound to a Release")
    .option("--api-url <url>", "Divinci API origin", "https://api.divinci.app")
    .option("--kind <kind>", "Snippet flavor: npm | script | astro", "npm")
    .action((releaseId, opts, cmd) => {
      try {
        const globalOpts = cmd.optsWithGlobals();
        const kind = String(opts.kind) as SnippetKind;
        if (!["npm", "script", "astro"].includes(kind)) {
          throw new Error(`Invalid --kind "${kind}" (expected npm | script | astro)`);
        }
        const apiUrl = globalOpts.apiUrl || opts.apiUrl;
        const snippet = embedSnippet({ releaseId, apiUrl, kind });
        // Raw text so it's pipe/copy-friendly; --json wraps it for tooling.
        if (isJsonMode()) output({ releaseId, apiUrl, kind, snippet });
        else output(snippet);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
