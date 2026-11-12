/**
 * @divinci-ai/types
 *
 * TypeScript type definitions for the Divinci AI SDK
 */

// Core types
export * from "./common.js";
export * from "./errors.js";

// Resource types
export * from "./chat.js";
export * from "./release.js";
export * from "./terms.js";
export * from "./workspace.js";
export * from "./user.js";
export * from "./rag.js";
export * from "./api-key.js";
export * from "./arena.js";
export * from "./meta-harness.js";
export * from "./feedback.js";

// Configuration types
export * from "./config.js";

// Zod schemas for runtime validation
// Import as: import { schemas } from "@divinci-ai/types"
// Or: import { ChatMessageSchema, UserSchema } from "@divinci-ai/types/schemas"
//
// NOTE: deliberately `import * as` + `export {}` rather than the shorter
// namespace re-export form. tsc emits that form verbatim, and Babel rejects it
// without @babel/plugin-transform-export-namespace-from. Playwright transforms
// this file with Babel — it is a workspace link, so it resolves outside
// node_modules and is not excluded — which fails the whole test run. The two
// forms are equivalent for consumers.
import * as schemas from "./schemas/index.js";

export { schemas };

// Validation utilities
// Import as: import { validate, validateOrThrow } from "@divinci-ai/types/validation"
export * from "./validation/index.js";

// Type guards
// Import as: import { isChatMessage, isUser } from "@divinci-ai/types/guards"
export * from "./guards.js";
