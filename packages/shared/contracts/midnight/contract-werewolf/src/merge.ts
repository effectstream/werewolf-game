// Merge all .compact files in this folder into go-fish.compact.txt.
const dirUrl = new URL(".", import.meta.url);
const dirPath = decodeURIComponent(dirUrl.pathname);
const outputName = "werewolf.compact.txt";

const compactFiles: string[] = [];

for await (const entry of Deno.readDir(dirPath)) {
  if (!entry.isFile) continue;
  if (!entry.name.endsWith(".compact")) continue;
  compactFiles.push(entry.name);
}

compactFiles.sort();

const parts: string[] = [];

for (const name of compactFiles) {
  const filePath = `${dirPath}${dirPath.endsWith("/") ? "" : "/"}${name}`;
  const contents = await Deno.readTextFile(filePath);
  const startMarker = `<file=${name}>`;
  const endMarker = `</file=${name}>`;
  parts.push(`${startMarker}\n${contents.trimEnd()}\n${endMarker}`);
}

const merged = parts.filter(Boolean).join("\n\n") + "\n";
const outputPath = `${dirPath}${dirPath.endsWith("/") ? "" : "/"}${outputName}`;

await Deno.writeTextFile(outputPath, merged);
console.log(
  `Merged ${compactFiles.length} files into ${outputName}: ${
    compactFiles.join(
      ", ",
    )
  }`,
);
