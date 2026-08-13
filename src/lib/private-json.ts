import "server-only";

import { createDecipheriv } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const encryptedMagic = Buffer.from("TEMARIA1");

function decryptPrivateJson(payload: Buffer) {
  const encodedKey = process.env.TEMARIA_DATA_KEY;
  if (!encodedKey) {
    throw new Error("TEMARIA_DATA_KEY no está configurada.");
  }

  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("TEMARIA_DATA_KEY no es una clave AES-256 válida.");
  }
  if (!payload.subarray(0, encryptedMagic.length).equals(encryptedMagic)) {
    throw new Error("El archivo privado cifrado no tiene un formato válido.");
  }

  const nonceStart = encryptedMagic.length;
  const nonce = payload.subarray(nonceStart, nonceStart + 12);
  const tag = payload.subarray(nonceStart + 12, nonceStart + 28);
  const ciphertext = payload.subarray(nonceStart + 28);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}

export function readPrivateJson<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) return undefined;
  const payload = readFileSync(filePath);
  const json = filePath.endsWith(".enc")
    ? decryptPrivateJson(payload)
    : payload.toString("utf8");
  return JSON.parse(json) as T;
}
