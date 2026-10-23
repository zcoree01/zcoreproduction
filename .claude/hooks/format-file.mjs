// PostToolUse hook: formats the file Claude just wrote/edited with Prettier.
// Reads the hook payload from stdin; never blocks the tool call (always exits 0).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

async function main() {
  const payload = JSON.parse(readStdin() || "{}");
  const filePath = payload?.tool_input?.file_path ?? payload?.tool_response?.filePath;
  if (typeof filePath !== "string" || !existsSync(filePath)) return;

  const relative = path.relative(projectDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return; // outside repo

  const prettier = await import("prettier");
  const ignorePath = path.join(projectDir, ".prettierignore");
  const info = await prettier.getFileInfo(filePath, {
    ignorePath: existsSync(ignorePath) ? ignorePath : undefined,
    resolveConfig: true,
  });
  if (info.ignored || !info.inferredParser) return;

  const options = (await prettier.resolveConfig(filePath)) ?? {};
  const source = readFileSync(filePath, "utf8");
  const formatted = await prettier.format(source, { ...options, filepath: filePath });
  if (formatted !== source) writeFileSync(filePath, formatted);
}

main().catch((error) => {
  process.stderr.write(
    `prettier hook: ${error instanceof Error ? error.message : String(error)}\n`,
  );
});
