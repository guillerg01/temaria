import "server-only";

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { readPrivateJson } from "@/lib/private-json";
import type { OfficialAssessment } from "@/lib/types";

function readAssessmentFile(filePath: string): OfficialAssessment[] {
  try {
    const payload = readPrivateJson<
      | OfficialAssessment
      | { assessments?: OfficialAssessment[] }
    >(filePath);
    if (!payload) return [];
    if ("assessments" in payload) return payload.assessments ?? [];
    if ("id" in payload) return [payload as OfficialAssessment];
    return [];
  } catch {
    return [];
  }
}

function loadOfficialAssessments() {
  const dataRoot = path.join(process.cwd(), "src", "data");
  const files: string[] = [];
  const privateFile = process.env.TEMARIA_ASSESSMENTS_PATH;
  const encryptedFile = path.join(
    process.cwd(),
    "private-data",
    "official-assessments.enc",
  );
  const mainFile = path.join(dataRoot, "official-assessments.json");
  const assessmentDirectory = path.join(dataRoot, "official-assessments");

  if (privateFile && existsSync(privateFile)) files.push(privateFile);
  if (existsSync(encryptedFile)) files.push(encryptedFile);
  if (existsSync(mainFile)) files.push(mainFile);
  if (existsSync(assessmentDirectory)) {
    files.push(
      ...readdirSync(assessmentDirectory)
        .filter((fileName) => fileName.endsWith(".json"))
        .sort((a, b) => a.localeCompare(b, "es"))
        .map((fileName) => path.join(assessmentDirectory, fileName)),
    );
  }

  return [...new Set(files.map((file) => path.resolve(file)))].flatMap(
    readAssessmentFile,
  );
}

const assessments = loadOfficialAssessments();

export function getOfficialAssessments() {
  return assessments;
}
