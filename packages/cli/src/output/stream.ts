import { colors } from "./colors.js";

export function printStreamChunk(chunk: string): void {
  process.stdout.write(chunk);
}

export function printStreamDone(): void {
  process.stdout.write("\n");
}

export function printAssistantLabel(): void {
  process.stdout.write(colors.cyanBold("Assistant: "));
}

export function printUserLabel(): void {
  process.stdout.write(colors.greenBold("You: "));
}

export function printSystemMessage(message: string): void {
  process.stderr.write(colors.dim(message) + "\n");
}
