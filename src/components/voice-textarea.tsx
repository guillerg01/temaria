"use client";

import { Mic, MicOff } from "lucide-react";
import { type TextareaHTMLAttributes, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

type RecognitionResult = { transcript: string };
type RecognitionEvent = Event & {
  resultIndex: number;
  results: ArrayLike<{ 0: RecognitionResult; isFinal: boolean }>;
};
type RecognitionError = Event & { error?: string };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionError) => void) | null;
  onend: (() => void) | null;
};
type RecognitionConstructor = new () => Recognition;

function getRecognition() {
  const browserWindow = window as typeof window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
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
  const supported = useSyncExternalStore(
    () => () => undefined,
    () => Boolean(getRecognition()),
    () => false,
  );
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("");
  const recognitionRef = useRef<Recognition | null>(null);
  const baseRef = useRef("");
  const finalRef = useRef("");

  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  function stop() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  async function start() {
    if (!window.isSecureContext) {
      setMessage("El dictado requiere HTTPS o localhost.");
      return;
    }
    const recognitionConstructor = getRecognition();
    if (!recognitionConstructor) {
      setMessage("Este navegador no admite dictado web.");
      return;
    }
    try {
      const permission = await navigator.permissions?.query({ name: "microphone" as PermissionName });
      if (permission?.state === "denied") {
        setMessage("El micrófono está bloqueado para este origen. Permítelo en el candado de la barra y recarga la página.");
        return;
      }
    } catch {
      // Some browsers do not expose microphone permission state.
    }
    const recognition = new recognitionConstructor();
    recognition.lang = "es-ES";
    recognition.continuous = true;
    recognition.interimResults = true;
    baseRef.current = value.trimEnd();
    finalRef.current = "";
    setMessage("");
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const text = event.results[index][0].transcript.trim();
        if (event.results[index].isFinal) finalRef.current += `${text} `;
        else interim += text;
      }
      const dictated = `${finalRef.current}${interim}`.trim();
      onValueChange(`${baseRef.current}${baseRef.current && dictated ? " " : ""}${dictated}`);
    };
    recognition.onerror = (event) => {
      const messages: Record<string, string> = {
        "audio-capture": "No se encontró un micrófono disponible.",
        "service-not-allowed": "Chrome no tiene disponible su servicio de reconocimiento de voz.",
        "not-allowed": "Chrome rechazó el reconocimiento. Revisa el permiso del sitio y la privacidad del micrófono en Windows.",
        "no-speech": "No se detectó voz.",
        network: "El servicio de dictado no pudo conectarse.",
      };
      setMessage(messages[event.error ?? ""] ?? "No se pudo iniciar el dictado.");
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setMessage("El dictado ya estaba iniciándose. Inténtalo de nuevo.");
    }
  }

  return <div className={cn("voice-textarea", className)}>
    <textarea {...props} value={value} onChange={(event) => onValueChange(event.target.value)} />
    {supported && <button type="button" className={cn("voice-button", listening && "voice-button-listening")} aria-label={listening ? "Detener dictado" : "Dictar por voz"} onClick={() => (listening ? stop() : void start())}>
      {listening ? <MicOff size={18} /> : <Mic size={18} />}<span>{listening ? "Detener" : "Dictar"}</span>
    </button>}
    <span className="voice-status" aria-live="polite">{listening ? "Escuchando…" : message}</span>
  </div>;
}
