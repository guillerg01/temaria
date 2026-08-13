"use client";

import { LoaderCircle, Mic, Square } from "lucide-react";
import {
  type TextareaHTMLAttributes,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

type WhisperWorkerMessage =
  | { type: "status"; message: string; progress?: number }
  | { type: "result"; text: string }
  | { type: "error"; message: string };

let sharedWorker: Worker | null = null;
let activeWorkerListener: ((message: WhisperWorkerMessage) => void) | null = null;

function getSharedWhisperWorker() {
  if (!sharedWorker) {
    sharedWorker = new Worker(
      new URL("../workers/whisper.worker.ts", import.meta.url),
      { type: "module" },
    );
    sharedWorker.onmessage = (event: MessageEvent<WhisperWorkerMessage>) => {
      activeWorkerListener?.(event.data);
    };
  }
  return sharedWorker;
}

function resetSharedWhisperWorker() {
  sharedWorker?.terminate();
  sharedWorker = null;
  activeWorkerListener = null;
}

async function decodeTo16Khz(blob: Blob) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * 16_000),
      16_000,
    );
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    await context.close();
  }
}

export function VoiceTextarea({
  value,
  onValueChange,
  className,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const baseValueRef = useRef("");

  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function getWorker() {
    const worker = getSharedWhisperWorker();
    activeWorkerListener = (data) => {
        if (data.type === "status") {
          setMessage(data.message);
          setProgress(data.progress ?? null);
          return;
        }
        setTranscribing(false);
        setProgress(null);
        if (data.type === "error") {
          setMessage(data.message);
          return;
        }
        const text = data.text.trim();
        if (!text) {
          setMessage("No se detectó una frase clara. Inténtalo hablando más cerca del micrófono.");
          return;
        }
        const base = baseValueRef.current.trimEnd();
        onValueChange(`${base}${base ? " " : ""}${text}`);
        setMessage("Texto añadido.");
      };
      worker.onerror = () => {
        setTranscribing(false);
        setProgress(null);
        resetSharedWhisperWorker();
        setMessage("No se pudo cargar Whisper en este navegador.");
      };
    return worker;
  }

  async function transcribe(blob: Blob) {
    setTranscribing(true);
    setMessage("Preparando audio…");
    try {
      const audio = await decodeTo16Khz(blob);
      getWorker().postMessage({ type: "transcribe", audio }, [audio.buffer]);
      window.setTimeout(() => {
        setTranscribing((stillTranscribing) => {
          if (!stillTranscribing) return false;
          resetSharedWhisperWorker();
          setProgress(null);
          setMessage(
            "Whisper tardó demasiado en iniciarse. Pulsa Dictar para reintentarlo; el modelo descargado seguirá guardado.",
          );
          return false;
        });
      }, 180_000);
    } catch {
      setTranscribing(false);
      setMessage("No se pudo procesar la grabación. Prueba otra vez.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  async function startRecording() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setMessage("El dictado requiere HTTPS y un navegador moderno.");
      return;
    }
    setMessage("");
    baseValueRef.current = value;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        setRecording(false);
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];
        if (blob.size) void transcribe(blob);
      };
      recorder.start(250);
      setRecording(true);
      setMessage("Habla y pulsa Detener cuando termines.");
    } catch (error) {
      const denied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "SecurityError");
      setMessage(
        denied
          ? "Permite el micrófono para este sitio desde el candado del navegador."
          : "No se pudo abrir el micrófono. Comprueba que otro programa no lo esté usando.",
      );
    }
  }

  const busy = recording || transcribing;

  return (
    <div className={cn("voice-textarea", className)}>
      <textarea
        {...props}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <button
        type="button"
        className={cn(
          "voice-button",
          recording && "voice-button-listening",
          transcribing && "voice-button-processing",
        )}
        aria-label={recording ? "Detener grabación" : "Dictar con Whisper"}
        disabled={transcribing}
        onClick={() => (recording ? stopRecording() : void startRecording())}
      >
        {recording ? (
          <Square size={16} fill="currentColor" />
        ) : transcribing ? (
          <LoaderCircle className="voice-spinner" size={18} />
        ) : (
          <Mic size={18} />
        )}
        <span>{recording ? "Detener" : transcribing ? "Procesando" : "Dictar"}</span>
      </button>
      <span className="voice-status" aria-live="polite">
        {message}
        {progress !== null ? ` ${Math.round(progress)}%` : ""}
      </span>
      {busy && progress !== null && (
        <span className="voice-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </span>
      )}
    </div>
  );
}
