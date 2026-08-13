import type { Metadata } from "next";

import { StudyApp } from "@/components/study-app";
import { getCatalog } from "@/lib/corpus";
import { getOfficialAssessments } from "@/lib/official-assessments";

export const metadata: Metadata = {
  title: "Aula",
  description: "Espacio privado Temaria para estudiar SSCS0208.",
};

export default function StudyPage() {
  return (
    <StudyApp
      catalog={getCatalog()}
      officialAssessments={getOfficialAssessments()}
    />
  );
}
