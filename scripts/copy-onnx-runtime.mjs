import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "node_modules", "onnxruntime-web", "dist");
const target = join(root, "public", "onnxruntime");
const files = [
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
];

await mkdir(target, { recursive: true });
await Promise.all(
  files.map((file) => copyFile(join(source, file), join(target, file))),
);
console.log(`ONNX runtime copied to ${target}.`);
