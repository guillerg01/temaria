import "server-only";

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { OfficialAssessment } from "@/lib/types";

function readAssessmentFile(filePath: string): OfficialAssessment[] {
  try {
    const payload = JSON.parse(readFileSync(filePath, "utf8")) as
      | OfficialAssessment
      | { assessments?: OfficialAssessment[] };
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
  const mainFile = path.join(dataRoot, "official-assessments.json");
  const assessmentDirectory = path.join(dataRoot, "official-assessments");

  if (privateFile && existsSync(privateFile)) files.push(privateFile);
  if (existsSync(mainFile)) files.push(mainFile);
  if (existsSync(assessmentDirectory)) {
    files.push(
      ...readdirSync(assessmentDirectory)
        .filter((fileName) => fileName.endsWith(".json"))
        .sort((a, b) => a.localeCompare(b, "es"))
        .map((fileName) => path.join(assessmentDirectory, fileName)),
    );
  }

  return files.flatMap(readAssessmentFile);
}

const assessments = loadOfficialAssessments();

export function getOfficialAssessments() {
  return assessments;
}
