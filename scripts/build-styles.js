import {readFileSync, watch, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "src/styles.css");
const target = resolve(root, "src/styles.generated.js");

function build() {
    const css = readFileSync(source, "utf8");
    writeFileSync(target, `// Generated from styles.css. Do not edit manually.\nexport const STYLES = ${JSON.stringify(css)};\n`);
    console.log("Generated src/styles.generated.js");
}

build();

if (process.argv.includes("--watch")) {
    watch(source, build);
}
