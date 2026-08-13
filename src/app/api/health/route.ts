import { NextResponse } from "next/server";

import { getCorpus } from "@/lib/corpus";
import { getOfficialAssessments } from "@/lib/official-assessments";

export const runtime = "nodejs";

export function GET() {
  const corpus = getCorpus();

  return NextResponse.json({
    status: "ok",
    configured: {
      ai: Boolean(process.env.AGENTROUTER_API_KEY),
      authentication: Boolean(
        process.env.SITE_PASSWORD && process.env.AUTH_SECRET,
      ),
      corpus: corpus.stats.courses > 0,
      assessments: getOfficialAssessments().length > 0,
    },
    content: {
      courses: corpus.stats.courses,
      documents: corpus.stats.documents,
      assessments: getOfficialAssessments().length,
    },
  });
}
