/**
 * Injected stylesheet for the embed widget. All theme values are --divinci-*
 * custom properties scoped to #divinci-docs-assistant, with neutral-dark
 * defaults below — a host (e.g. a Starlight docs site) maps them to its own
 * theme tokens. Extracted verbatim from the sdk.divinci.ai docs widget; the only
 * transforms were renaming Starlight's sl- tokens to divinci- and quoting
 * backticks in comments.
 */
export const STYLES = String.raw`
  /* --- default theme tokens (host overrides these) ---
     :where() gives these ZERO specificity, so a host's plain
     #divinci-docs-assistant { --divinci-*: var(--sl-*) } map always wins, even
     though the package injects its <style> after the page's stylesheet. */
  :where(#divinci-docs-assistant) {
    --divinci-color-accent: #635bff;
    --divinci-color-accent-high: #a5b4fc;
    --divinci-color-bg: #0d0e12;
    --divinci-color-black: #16181d;
    --divinci-color-white: #ffffff;
    --divinci-color-gray-2: #c2c7d0;
    --divinci-color-gray-3: #9aa0ab;
    --divinci-color-gray-4: #6b7280;
    --divinci-color-gray-5: #3b3f47;
    --divinci-color-gray-6: #23262d;
    --divinci-color-gray-7: #16181d;
    --divinci-font: system-ui, -apple-system, "Segoe UI", sans-serif;
    --divinci-font-mono: ui-monospace, "SF Mono", Menlo, monospace;
    --divinci-text-base: 1rem;
    --divinci-text-sm: 0.875rem;
    --divinci-text-xs: 0.8rem;
    --divinci-shadow-md: 0 4px 14px rgba(0, 0, 0, 0.3);
    --divinci-shadow-lg: 0 10px 40px rgba(0, 0, 0, 0.35);
    --divinci-nav-height: 4rem;
    --divinci-sidebar-width: 18.75rem;
  }
  #divinci-docs-assistant {
    --da-radius: 0.9rem;
    font-family: var(--divinci-font, inherit);
  }

  /* Launcher and panel are each independently fixed to the same corner, so the
     launcher never participates in the panel's layout (otherwise it floats up
     above the open panel and overlaps page content). Only one shows at a time. */
  .da-launcher {
    position: fixed;
    right: 1.25rem;
    bottom: 1.25rem;
    z-index: 1000;
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.35rem 1rem 0.35rem 0.4rem;
    border: 1px solid var(--divinci-color-accent);
    border-radius: 999px;
    background: var(--divinci-color-accent);
    color: var(--divinci-color-white);
    font-size: var(--divinci-text-sm);
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--divinci-shadow-md);
    transition: transform 0.12s ease, filter 0.12s ease;
  }
  .da-launcher:hover { filter: brightness(1.08); transform: translateY(-1px); }
  .da-launcher[aria-expanded="true"] { display: none; }
  /* Same trap as .da-icon-btn: 'display:inline-flex' above beats the UA
     [hidden] rule, so setting launcher.hidden = true (the full-height dock
     path) silently did nothing. Masked until now by the aria-expanded rule. */
  .da-launcher[hidden] { display: none; }

  .da-panel {
    /* Full-height right-side dock, pinned BELOW the docs header (Starlight sets
       --divinci-nav-height) so it never overlaps the site nav. */
    position: fixed;
    top: var(--divinci-nav-height, 3.5rem);
    right: 0;
    bottom: 0;
    z-index: 1001;
    display: flex;
    flex-direction: column;
    width: min(24rem, 100vw);
    border: 0;
    border-left: 1px solid var(--divinci-color-gray-5);
    border-radius: 0;
    background: var(--divinci-color-bg);
    box-shadow: var(--divinci-shadow-lg, 0 10px 40px rgba(0,0,0,0.35));
    overflow: hidden;
  }
  .da-panel[hidden] { display: none; }

  .da-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.7rem 0.85rem;
    border-bottom: 1px solid var(--divinci-color-gray-5);
    background: var(--divinci-color-gray-7, var(--divinci-color-black));
  }
  .da-avatar {
    position: relative;
    flex: 0 0 auto;
    width: 2rem;
    height: 2rem;
  }
  .da-avatar img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    background: var(--divinci-color-black);
  }
  /* Live indicator — reflects a real /health probe (green=live, red=offline,
     gray=checking), like the Divinci agent's status dot. */
  .da-status {
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 50%;
    border: 2px solid var(--divinci-color-gray-7, var(--divinci-color-black));
    background: var(--divinci-color-gray-4);
    transition: background 0.2s ease;
  }
  .da-status[data-live="true"] {
    background: #3fb950;
    box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.55);
    animation: da-status-pulse 2.4s infinite;
  }
  .da-status[data-live="false"] { background: #f85149; }
  @keyframes da-status-pulse {
    0% { box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.5); }
    70% { box-shadow: 0 0 0 0.4rem rgba(63, 185, 80, 0); }
    100% { box-shadow: 0 0 0 0 rgba(63, 185, 80, 0); }
  }

  /* Launcher reuses the same avatar (robot logo + live dot) as the open
     panel's header, with a small chat-icon badge top-right so it still reads
     as "open a chat". */
  .da-avatar--launcher {
    width: 1.7rem;
    height: 1.7rem;
  }
  .da-avatar--launcher .da-status {
    /* ring blends into the purple launcher pill instead of the dark header */
    border-color: var(--divinci-color-accent);
  }
  .da-title { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; }
  .da-title strong { color: var(--divinci-color-white); font-size: var(--divinci-text-base, 1rem); }

  .da-icon-btn {
    display: inline-flex;
    padding: 0.3rem;
    border: 0;
    border-radius: 0.4rem;
    background: none;
    color: var(--divinci-color-gray-2);
    cursor: pointer;
  }
  .da-icon-btn:hover { background: var(--divinci-color-gray-6); color: var(--divinci-color-white); }
  /* '.da-icon-btn{display:inline-flex}' beats the UA [hidden] rule, so without
     this the header's conditional buttons are ALWAYS visible no matter what
     the JS sets. That is how the on-device bolt shipped showing for every
     visitor while localToggleState() correctly returned show:false — the
     attribute was set faithfully and simply had no effect. Same trap as
     .da-handoff below. */
  .da-icon-btn[hidden] { display: none; }
  /* On-device toggle active state: accent the lightning bolt when routing local. */
  .da-local-toggle--on { color: var(--divinci-color-accent, #6c5ce7); }
  .da-local-toggle--on:hover { color: var(--divinci-color-accent, #6c5ce7); }
  /* Sound toggle active state: accent the speaker while replies are read aloud. */
  .da-sound-toggle--on { color: var(--divinci-color-accent, #6c5ce7); }
  .da-sound-toggle--on:hover { color: var(--divinci-color-accent, #6c5ce7); }

  .da-messages {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .da-msg { display: flex; gap: 0.45rem; align-items: flex-end; }
  .da-msg-user { justify-content: flex-end; }
  .da-msg-col {
    display: flex;
    flex-direction: column;
    min-width: 0;
    /* fit-content (capped at 80%) so the column sizes to its content's preferred
       width and wraps there — without it, the flex row collapses a long markdown
       reply (with a <ul>) to min-content, one word per line. */
    width: fit-content;
    max-width: 80%;
  }
  /* Assistant column stretches its bubble/sources to the resolved width; the
     user column hugs its (short) bubble on the right. */
  .da-msg-assistant .da-msg-col { align-items: stretch; }
  .da-msg-user .da-msg-col { align-items: flex-end; }
  .da-bubble {
    max-width: 100%;
    padding: 0.55rem 0.75rem;
    border-radius: 0.7rem;
    font-size: var(--divinci-text-sm);
    line-height: 1.5;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  /* Per-message avatars (same 2rem size as the header robot). Robot on the left
     for the assistant; the visitor's IP — as a stacked, zero-padded octet block
     — on the right for the user (a transparent "we track by IP" signal). */
  .da-avatar--msg {
    flex: 0 0 auto;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    overflow: hidden;
    /* Pin beside the bubble top so the hover quick-menu + sources (which grow the
       message column below the bubble) don't push the avatar down. */
    align-self: flex-start;
  }
  .da-avatar--msg img {
    width: 100%; height: 100%;
    border-radius: 50%;
    object-fit: cover;
    background: var(--divinci-color-black);
  }
  .da-ip-avatar {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--divinci-color-accent);
    color: var(--divinci-color-white);
    font-family: var(--divinci-font-mono, ui-monospace, "SF Mono", Menlo, monospace);
    font-size: 0.5rem;
    line-height: 1.08;
    letter-spacing: 0.03em;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .da-ip-avatar span { display: block; }
  .da-ip-q { font-size: 0.72rem; }
  /* IP square doubles as a "Sign up" link: octets at rest, CTA on hover/focus. */
  .da-ip-avatar { text-decoration: none; cursor: pointer; }
  .da-ip-avatar:hover { filter: brightness(1.06); }
  .da-ip-avatar .da-ip-signup {
    display: none;
    text-align: center;
    font-size: 0.52rem;
    font-weight: 700;
    line-height: 1.05;
    padding: 0 1px;
  }
  .da-ip-avatar:hover .da-ip-octets,
  .da-ip-avatar:focus-visible .da-ip-octets { display: none; }
  .da-ip-avatar:hover .da-ip-signup,
  .da-ip-avatar:focus-visible .da-ip-signup { display: block; }
  .da-msg-assistant .da-bubble {
    background: var(--divinci-color-gray-6);
    color: var(--divinci-color-white);
    border-bottom-left-radius: 0.2rem;
  }
  .da-msg-user .da-bubble {
    background: var(--divinci-color-accent);
    color: var(--divinci-color-white);
    border-bottom-right-radius: 0.2rem;
  }
  .da-bubble a { color: var(--divinci-color-accent-high); }

  /* Conversation starters: clickable chips under the greeting in the empty
     state. Hidden once the first message is sent (and on restored threads). */
  .da-suggestions {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
    margin: 0.6rem 0 0.2rem calc(28px + 0.6rem); /* align under the greeting bubble (avatar + gap) */
    padding-right: 0.5rem;
  }
  .da-suggestions[hidden] { display: none; }
  .da-suggestion {
    max-width: 100%;
    text-align: left;
    font: inherit;
    font-size: var(--divinci-text-sm);
    line-height: 1.3;
    color: var(--divinci-color-accent-high);
    background: color-mix(in srgb, var(--divinci-color-accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--divinci-color-accent) 45%, transparent);
    border-radius: 999px;
    padding: 0.4rem 0.85rem;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
  }
  .da-suggestion:hover {
    background: color-mix(in srgb, var(--divinci-color-accent) 22%, transparent);
    border-color: var(--divinci-color-accent);
    transform: translateY(-1px);
  }
  .da-suggestion:focus-visible {
    outline: 2px solid var(--divinci-color-accent);
    outline-offset: 2px;
  }

  /* Rendered-markdown assistant replies: tighten default block spacing so the
     bubble reads like chat, not an article. white-space:normal because the
     markup carries its own structure (no source newlines to preserve). */
  /* display:block is load-bearing: the rendered markdown must stack its block
     children (<p>/<h*>/<ul>) vertically. A flex container (e.g. a leftover
     thinking-indicator class) would lay them out as ROW items — broken columns. */
  .da-bubble.da-md { display: block; white-space: normal; }
  /* Long unbreakable tokens (URLs in code, e.g. an embed <script src="…">) wrap
     instead of forcing horizontal overflow. */
  .da-md, .da-md p, .da-md code { overflow-wrap: anywhere; }
  .da-md p { margin: 0 0 0.5rem; }
  .da-md p:last-child { margin-bottom: 0; }
  .da-md ul, .da-md ol { margin: 0.25rem 0 0.5rem; padding-left: 1.2rem; }
  .da-md li { margin: 0.15rem 0; }
  .da-md h3, .da-md h4, .da-md h5 {
    margin: 0.6rem 0 0.3rem;
    line-height: 1.25;
    color: var(--divinci-color-white);
    font-weight: 600;
  }
  .da-md h3:first-child, .da-md h4:first-child, .da-md h5:first-child { margin-top: 0; }
  .da-md h3 { font-size: 1.02em; }
  .da-md h4 { font-size: 0.96em; }
  .da-md h5 { font-size: 0.9em; }
  .da-md code {
    padding: 0.05rem 0.3rem;
    border-radius: 0.3rem;
    background: var(--divinci-color-black);
    font-size: 0.82em;
  }

  /* On-device provenance badge — marks a turn generated on the visitor's
     device (delegated inference), distinct from a release-authored answer. */
  .da-ondevice {
    margin-top: 0.4rem;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--divinci-color-gray-2);
    background: var(--divinci-color-gray-6, rgba(127, 127, 127, 0.12));
    border: 1px solid var(--divinci-color-gray-5, rgba(127, 127, 127, 0.2));
    cursor: default;
    user-select: none;
  }

  /* Sources dropdown — structured per-source cards, not a raw markdown dump. */
  .da-sources {
    margin-top: 0.45rem;
    font-size: 0.72rem;
    color: var(--divinci-color-gray-3);
  }
  .da-sources summary {
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.15rem 0;
    color: var(--divinci-color-gray-2);
    font-weight: 600;
    list-style: none;
  }
  .da-sources summary::-webkit-details-marker { display: none; }
  .da-sources summary::before { content: "▸"; transition: transform 0.15s; }
  .da-sources[open] summary::before { transform: rotate(90deg); }
  .da-sources-list {
    margin: 0.4rem 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .da-source {
    padding: 0.45rem 0.55rem;
    border: 1px solid var(--divinci-color-gray-5);
    border-radius: 0.45rem;
    background: var(--divinci-color-black);
  }
  .da-source-title {
    font-weight: 600;
    color: var(--divinci-color-white);
    font-size: 0.76rem;
    margin-bottom: 0.2rem;
    word-break: break-word;
  }
  .da-source-title a { color: var(--divinci-color-accent-high); text-decoration: none; }
  .da-source-title a:hover { text-decoration: underline; }
  /* Numbered badge that matches the inline [N] citation chip. */
  .da-source-num {
    color: var(--divinci-color-accent-high);
    font-variant-numeric: tabular-nums;
    margin-right: 0.35rem;
  }
  .da-source-excerpt {
    margin: 0;
    color: var(--divinci-color-gray-2);
    line-height: 1.45;
  }
  /* Inline [N] citation chip inside an assistant message. */
  .da-cite {
    cursor: pointer;
    color: var(--divinci-color-accent-high);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    text-decoration: none;
    border-radius: 0.2rem;
    padding: 0 0.1rem;
  }
  .da-cite:hover { text-decoration: underline; }
  .da-cite:focus-visible { outline: 2px solid var(--divinci-color-accent); outline-offset: 1px; }
  /* Brief highlight when a citation scrolls its source into view. */
  .da-source-flash { animation: da-source-flash 1.4s ease-out; }
  @keyframes da-source-flash {
    0%, 25% { border-color: var(--divinci-color-accent); background: color-mix(in srgb, var(--divinci-color-accent) 22%, var(--divinci-color-black)); }
    100% { border-color: var(--divinci-color-gray-5); background: var(--divinci-color-black); }
  }
  @media (prefers-reduced-motion: reduce) {
    .da-source-flash { animation: none; }
  }

  .da-thinking { display: inline-flex; align-items: center; gap: 0.5rem; }
  /* Animated shimmer sweep across the label (Claude-Code-style "thinking"). */
  .da-thinking-label {
    font-size: var(--divinci-text-sm);
    font-weight: 500;
    background: linear-gradient(
      90deg,
      var(--divinci-color-gray-4) 0%,
      var(--divinci-color-gray-4) 35%,
      var(--divinci-color-white) 50%,
      var(--divinci-color-gray-4) 65%,
      var(--divinci-color-gray-4) 100%
    );
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
    animation: da-shimmer 1.5s linear infinite;
  }
  @keyframes da-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .da-thinking-label { animation: none; color: var(--divinci-color-gray-2); -webkit-text-fill-color: var(--divinci-color-gray-2); }
  }
  .da-typing { display: inline-flex; gap: 0.35rem; padding: 0.25rem 0; }
  .da-typing i {
    width: 0.6rem; height: 0.6rem; border-radius: 50%;
    background: var(--divinci-color-gray-2);
    animation: da-bounce 1.2s infinite ease-in-out;
  }
  .da-typing i:nth-child(2) { animation-delay: 0.15s; }
  .da-typing i:nth-child(3) { animation-delay: 0.3s; }
  @keyframes da-bounce { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }

  .da-handoff {
    padding: 0.35rem 0.85rem 0;
    /* flex-shrink:0 keeps this bar (a flex item of the panel) at content height so
       it isn't squeezed; messages (flex:1) takes the slack and scrolls. Layout
       props (height/padding) are toggled WITHOUT transition — layout-property
       transitions stall in this flex context; only transform/opacity animate. */
    display: block;
    flex-shrink: 0;
  }
  /* Collapse, in two reliable steps (layout-property transitions stall here):
       1. '.da-sliding' animates the content off to the right + fades it (transform
          + opacity — non-layout, these animate fine).
       2. '.da-collapsed' then zeroes the height + padding INSTANTLY (no transition),
          so the transcript reclaims the space. JS adds it after the slide finishes. */
  .da-handoff-inner { overflow: hidden; }
  .da-handoff.da-collapsed .da-handoff-inner { height: 0; }
  .da-handoff-content {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    transition: opacity 0.26s ease;
  }
  .da-handoff.da-sliding .da-handoff-content { opacity: 0; }
  .da-handoff.da-collapsed {
    padding-top: 0;
    padding-bottom: 0;
  }
  .da-handoff.da-sliding, .da-handoff.da-collapsed { pointer-events: none; }
  .da-handoff-head { display: flex; justify-content: flex-end; }
  .da-handoff-collapse {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.3rem;
    height: 1.3rem;
    padding: 0;
    border: 0;
    border-radius: 0.35rem;
    background: transparent;
    color: var(--divinci-color-gray-3);
    cursor: pointer;
  }
  .da-handoff-collapse:hover { background: var(--divinci-color-gray-6); color: var(--divinci-color-white); }
  .da-handoff-row {
    display: flex;
    flex-wrap: nowrap;
    gap: 0.4rem;
    justify-content: center;
    transition: transform 0.28s ease;
  }
  .da-handoff.da-sliding .da-handoff-row { transform: translateX(115%); }
  .da-handoff-label { display: inline-flex; align-items: center; gap: 0.35rem; }
  .da-handoff-desc {
    margin-top: 0.1rem;
    font-size: 0.64rem;
    font-weight: 400;
    line-height: 1.2;
    white-space: normal;
    text-align: center;
    opacity: 0.8;
  }
  /* Restore tab — floats at the bottom-right ABOVE the input (out of flow), so the
     collapsed handoff bar leaves no row behind and the transcript reclaims it all. */
  .da-handoff-restore {
    position: absolute;
    right: 0;
    bottom: 4.7rem; /* clears the input row (~4.2rem) + a little gap */
    z-index: 3;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.7rem;
    padding: 0;
    border: 1px solid var(--divinci-color-accent);
    border-radius: 999px 0 0 999px;
    background: var(--divinci-color-bg);
    color: var(--divinci-color-accent-high);
    cursor: pointer;
    transition: background 0.15s;
  }
  .da-handoff-restore:hover { background: color-mix(in srgb, var(--divinci-color-accent) 26%, transparent); }
  .da-handoff-restore[hidden] { display: none; }
  /* '.da-handoff{display:flex}' would otherwise beat the UA [hidden] rule, so the
     bar would always show. Honor the hidden attribute (set by maybeShowHandoff). */
  .da-handoff[hidden] { display: none; }
  .da-handoff-btn--alt {
    background: transparent;
    border-color: var(--divinci-color-gray-5);
    color: var(--divinci-color-white);
  }
  .da-handoff-btn--alt:hover { background: color-mix(in srgb, var(--divinci-color-white) 8%, transparent); }

  /* Code-editor handoff: the brief renders as a normal assistant message; these
     actions (copy / download / MCP snippets) are appended BELOW it, in the chat
     flow, aligned under the bubble (past the 2rem avatar + gap). */
  .da-handoff-actions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0.1rem 0 0.4rem 2.45rem;
  }
  .da-codegen-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
  .da-codegen-action {
    display: inline-flex; align-items: center; gap: 0.3rem;
    padding: 0.35rem 0.7rem; border-radius: 0.45rem;
    border: 1px solid var(--divinci-color-gray-5); background: var(--divinci-color-gray-6);
    color: var(--divinci-color-white); font-size: 0.78rem; cursor: pointer;
  }
  .da-codegen-action:hover { background: var(--divinci-color-gray-5); }
  .da-codegen-action--primary {
    background: var(--divinci-color-accent); border-color: var(--divinci-color-accent);
  }
  .da-codegen-action--primary:hover { background: var(--divinci-color-accent-high); }
  .da-codegen-hint { font-size: 0.74rem; color: var(--divinci-color-gray-3); margin: 0; }
  .da-mcp-details > summary {
    cursor: pointer; font-size: 0.74rem; color: var(--divinci-color-gray-2);
    list-style: none; padding: 0.15rem 0;
  }
  .da-mcp-details > summary::-webkit-details-marker { display: none; }
  .da-mcp-details > summary::before { content: "▸ "; }
  .da-mcp-details[open] > summary::before { content: "▾ "; }
  .da-mcp-details .da-codegen-actions { margin-top: 0.4rem; }
  .da-brief {
    max-height: 16rem;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 0;
    padding: 0.55rem 0.65rem;
    border-radius: 0.5rem;
    background: var(--divinci-color-gray-6);
    color: var(--divinci-color-white);
    font-family: var(--divinci-font-mono, ui-monospace, "SF Mono", Menlo, monospace);
    font-size: 0.72rem;
    line-height: 1.5;
  }
  .da-handoff-btn {
    flex: 1 1 0;
    min-width: 0;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.05rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--divinci-color-accent);
    border-radius: 0.85rem;
    background: color-mix(in srgb, var(--divinci-color-accent) 12%, transparent);
    color: var(--divinci-color-accent-high);
    font-size: var(--divinci-text-xs, 0.8rem);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.15s;
  }
  .da-handoff-btn:hover { background: color-mix(in srgb, var(--divinci-color-accent) 22%, transparent); }
  .da-handoff-btn:disabled { opacity: 0.6; cursor: default; }
  /* Expanded mode has room: more space between the buttons and from the edges. */
  .da-panel.da-expanded .da-handoff { padding-left: 1.5rem; padding-right: 1.5rem; }
  .da-panel.da-expanded .da-handoff-row { gap: 1.5rem; }
  .da-panel.da-expanded .da-handoff-btn { padding: 0.6rem 1.1rem; }
  .da-panel.da-expanded .da-handoff-desc { font-size: 0.72rem; }

  /* Turnstile is invisible (interaction-only); only reserve space + show a
     divider when Cloudflare actually injects a challenge iframe. */
  .da-turnstile:not(:empty) {
    display: flex;
    justify-content: center;
    padding: 0.6rem 0.7rem 0;
  }

  .da-input-row {
    display: flex;
    gap: 0.5rem;
    padding: 0.7rem;
    border-top: 1px solid var(--divinci-color-gray-5);
  }
  .da-input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--divinci-color-gray-5);
    border-radius: 0.6rem;
    background: var(--divinci-color-bg);
    color: var(--divinci-color-white);
    font-size: var(--divinci-text-sm);
  }
  .da-input:focus { outline: none; border-color: var(--divinci-color-accent); }
  .da-send {
    display: inline-flex;
    align-items: center;
    padding: 0 0.7rem;
    border: 0;
    border-radius: 0.6rem;
    background: var(--divinci-color-accent);
    color: var(--divinci-color-white);
    cursor: pointer;
  }
  .da-send:disabled { opacity: 0.5; cursor: default; }
  /* Stop mode: the send button becomes a square stop control while a turn runs. */
  .da-send[data-mode="stop"] { background: var(--divinci-color-gray-4); }

  /* A turn the user stopped — quietly de-emphasized, not an error. */
  .da-bubble.da-stopped { opacity: 0.7; font-style: italic; }

  /* ── Per-message quick actions (copy / read aloud / react) ──────────────── */
  .da-msg-actions {
    position: relative;
    display: flex;
    gap: 0.25rem;
    /* Reserve NO vertical space until hovered, so sources / the next row sit
       right under the bubble instead of being pushed down by a hidden toolbar. */
    height: 0;
    margin-top: 0;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease;
  }
  .da-msg:hover .da-msg-actions,
  .da-msg-actions:focus-within {
    height: auto;
    margin-top: 0.3rem;
    overflow: visible;
    opacity: 1;
    pointer-events: auto;
  }
  .da-msg-user .da-msg-actions { align-self: flex-end; } /* mirror to the user side */
  .da-msg-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.7rem;
    height: 1.7rem;
    padding: 0;
    border: 1px solid var(--divinci-color-gray-5);
    border-radius: 0.45rem;
    background: var(--divinci-color-black);
    color: var(--divinci-color-gray-2);
    cursor: pointer;
    line-height: 1;
  }
  .da-msg-action:hover { background: var(--divinci-color-gray-6); color: var(--divinci-color-white); }
  .da-msg-action[aria-pressed="true"] { color: var(--divinci-color-accent-high); border-color: var(--divinci-color-accent); }
  .da-msg-action--emoji { font-size: 0.95rem; }
  .da-emoji-pop {
    position: absolute;
    bottom: calc(100% + 0.3rem);
    left: 0;
    display: flex;
    gap: 0.15rem;
    padding: 0.25rem;
    background: var(--divinci-color-black);
    border: 1px solid var(--divinci-color-gray-5);
    border-radius: 0.5rem;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    z-index: 5;
  }
  .da-emoji-pop button {
    border: 0;
    background: transparent;
    cursor: pointer;
    font-size: 1.1rem;
    padding: 0.15rem 0.25rem;
    border-radius: 0.35rem;
    line-height: 1;
  }
  .da-emoji-pop button:hover { background: var(--divinci-color-gray-6); }
  .da-reaction-chip {
    align-self: flex-start;
    margin-top: 0.2rem;
    padding: 0.05rem 0.4rem;
    font-size: 0.95rem;
    line-height: 1.4;
    background: var(--divinci-color-gray-6);
    border: 1px solid var(--divinci-color-gray-5);
    border-radius: 1rem;
    cursor: pointer;
  }
  .da-msg-user .da-reaction-chip { align-self: flex-end; }

  /* Expanded: fill the center column, keep the left nav sidebar. Starlight shows
     that sidebar at >=50rem (--divinci-sidebar-width wide), so only offset there. */
  @media (min-width: 50rem) {
    .da-panel.da-expanded {
      left: var(--divinci-sidebar-width, 18.75rem);
      right: 0;
      width: auto;
    }
  }
  /* Below that the left sidebar collapses to a menu — nothing to preserve, so the
     expand control is meaningless; hide it (the dock is already full-width). */
  @media (max-width: 50rem) {
    #da-expand { display: none; }
  }

  @media (max-width: 30rem) {
    #divinci-docs-assistant { right: 0.75rem; bottom: 0.75rem; }
    /* On phones the dock spans the full width below the header. */
    .da-panel { left: 0; width: 100vw; }
  }
`;
