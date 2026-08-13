import { createCipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const key = Buffer.from(process.env.TEMARIA_DATA_KEY ?? "", "base64");
if (key.length !== 32) {
  throw new Error("Define TEMARIA_DATA_KEY con 32 bytes codificados en base64.");
}

const magic = Buffer.from("TEMARIA1");
const files = [
  ["src/data/corpus.json", "private-data/corpus.enc"],
  [
    "src/data/official-assessments.json",
    "private-data/official-assessments.enc",
  ],
];

for (const [source, destination] of files) {
  const plaintext = await readFile(source);
  JSON.parse(plaintext.toString("utf8"));
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const output = Buffer.concat([magic, nonce, cipher.getAuthTag(), ciphertext]);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, output);
  console.log(`Encrypted ${source} -> ${destination} (${output.length} bytes)`);
}
