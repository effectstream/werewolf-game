// Merge all .compact files in this folder into go-fish.compact.txt.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const dirPath = fileURLToPath(new URL(".", import.meta.url));
const outputName = "werewolf.compact.txt";

const compactFiles: string[] = [];

for (const entry of await readdir(dirPath, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (!entry.name.endsWith(".compact")) continue;
  compactFiles.push(entry.name);
}

compactFiles.sort();

const parts: string[] = [];

for (const name of compactFiles) {
  const filePath = `${dirPath}${dirPath.endsWith("/") ? "" : "/"}${name}`;
  const contents = await readFile(filePath, "utf-8");
  const startMarker = `<file=${name}>`;
  const endMarker = `</file=${name}>`;
  parts.push(`${startMarker}\n${contents.trimEnd()}\n${endMarker}`);
}

const merged = parts.filter(Boolean).join("\n\n") + "\n";
const outputPath = `${dirPath}${dirPath.endsWith("/") ? "" : "/"}${outputName}`;

await writeFile(outputPath, merged);
console.log(
  `Merged ${compactFiles.length} files into ${outputName}: ${
    compactFiles.join(
      ", ",
    )
  }`,
);
