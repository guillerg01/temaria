"use client";

import { Mic } from "lucide-react";
import { type TextareaHTMLAttributes } from "react";

export const VOICE_DICTATION_ENABLED = false;

export function VoiceTextarea({
  value,
  onValueChange,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="voice-textarea">
      <textarea {...props} value={value} onChange={(event) => onValueChange(event.target.value)} />
      {VOICE_DICTATION_ENABLED && <button type="button" aria-label="Dictar por voz"><Mic size={18} /></button>}
    </div>
  );
}
