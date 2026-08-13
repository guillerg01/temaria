import { env, pipeline } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

type TranscriptionOutput =
  | { text: string }
  | Array<{ text?: string }>;
type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<TranscriptionOutput>;
let transcriberPromise: Promise<Transcriber> | null = null;

function sendStatus(message: string, progress?: number) {
  self.postMessage({ type: "status", message, progress });
}

function getTranscriber() {
  if (!transcriberPromise) {
    sendStatus("Descargando Whisper pequeño por primera vez…", 0);
    transcriberPromise = pipeline(
      "automatic-speech-recognition",
      "Xenova/whisper-tiny",
      {
        progress_callback: (item: { status?: string; progress?: number }) => {
          if (item.status === "progress" && typeof item.progress === "number") {
            sendStatus("Descargando modelo…", item.progress);
          } else if (item.status === "ready") {
            sendStatus("Modelo preparado. Transcribiendo…");
          }
        },
      },
    ) as unknown as Promise<Transcriber>;
  }
  return transcriberPromise;
}

self.onmessage = async (
  event: MessageEvent<{ type: "transcribe"; audio: Float32Array }>,
) => {
  if (event.data.type !== "transcribe") return;
  try {
    const transcriber = await getTranscriber();
    sendStatus("Transcribiendo en este dispositivo…");
    const output = await transcriber(event.data.audio, {
      language: "spanish",
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const text = Array.isArray(output)
      ? output.map((item) => ("text" in item ? item.text : "")).join(" ")
      : "text" in output
        ? output.text
        : "";
    self.postMessage({ type: "result", text });
  } catch (error) {
    transcriberPromise = null;
    self.postMessage({
      type: "error",
      message:
        error instanceof Error
          ? `Whisper no pudo transcribir: ${error.message}`
          : "Whisper no pudo transcribir el audio.",
    });
  }
};
