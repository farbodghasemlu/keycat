import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const widgetPath = resolve(scriptDir, "../dist/widget.js");
const sriPath = resolve(scriptDir, "../dist/widget.js.sri");

const bytes = await readFile(widgetPath);
const digest = createHash("sha384").update(bytes).digest("base64");
const integrity = `sha384-${digest}`;

await writeFile(sriPath, `${integrity}\n`, "utf8");
console.log(`packages/sdk dist/widget.js SRI: ${integrity}`);
