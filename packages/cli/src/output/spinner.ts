import ora, { type Ora } from "ora";

let quietMode = false;

export function setQuietMode(enabled: boolean): void {
  quietMode = enabled;
}

export function createSpinner(text: string): Ora {
  return ora({
    text,
    isSilent: quietMode,
    stream: process.stderr,
    // Progress goes to stderr, never stdout.
    //
    // ora defaults to stdout, so `divinci model-edits describe X --json` emitted
    // "- Describing X" and "✔ Describing X" AHEAD of the JSON document, and
    // every parser choked on the first byte. stdout is the data channel; a
    // spinner is not data. On a TTY the user sees no difference, because both
    // streams land on the same terminal.
  });
}

export async function withSpinner<T>(text: string, fn: () => Promise<T>): Promise<T> {
  const spinner = createSpinner(text);
  spinner.start();
  try {
    const result = await fn();
    spinner.succeed();
    return result;
  } catch (error) {
    spinner.fail();
    throw error;
  }
}
