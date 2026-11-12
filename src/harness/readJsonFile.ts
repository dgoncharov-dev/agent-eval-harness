import { readFile } from "node:fs/promises";

// Reads and parses a JSON file; `what` names the file's role in the error message.
export async function readJsonFile(path: string, what: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new Error(`Cannot read ${what} file: ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what} file is not valid JSON: ${path}`);
  }
}
