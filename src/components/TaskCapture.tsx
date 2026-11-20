import { useEffect, useRef, useState } from "react";
import { ArrowRight, AudioLines, Sparkles, Square, X } from "lucide-react";
import { fetchRefineStatus, refinePrompt } from "../lib/api.ts";
import { useVoiceInput } from "../lib/voice.ts";
import { useSettings } from "../lib/settings.ts";
import { localTaskDay } from "../lib/workspaceTasks.ts";
import type { WorkspaceTask } from "../../shared/tasks.ts";

type DraftFields = Pick<WorkspaceTask, "title" | "notes" | "due" | "due_time" | "priority">;

function suggestion(raw: string): { fields: DraftFields; question: string } {
  const data = JSON.parse(raw);
  const { title, notes, due, time, priority, question } = data ?? {};
  if (typeof title !== "string" || !title.trim() || title.length > 240 || typeof notes !== "string" || notes.length > 12000
      || typeof question !== "string" || question.length > 400 || !["normal", "high", "urgent"].includes(priority)
      || typeof due !== "string" || due !== "" && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(Date.parse(due)) || new Date(due).toISOString().slice(0, 10) !== due)
      || typeof time !== "string" || time !== "" && (!due || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    throw new Error("Unreadable suggestion");
  }
  return { fields: { title, notes, due, due_time: time, priority }, question };
}

export function TaskCapture({ note, onNote, onClose, onDraft }: {
  note: string; onNote(note: string): void; onClose(): void;
  onDraft(fields: Partial<DraftFields>, question?: string): void;
}) {
  const { settings } = useSettings();
  const controller = useRef<AbortController | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const voice = useVoiceInput({
    mode: "chat", enabled: settings.voiceInput !== "off", polish: false,
    onText: ({ text, phase }) => { if (phase === "raw") onNote([note, text].filter(Boolean).join("\n").slice(0, 2400)); },
  });
  useEffect(() => {
    const request = new AbortController();
    void fetchRefineStatus(AbortSignal.any([request.signal, AbortSignal.timeout(5000)]))
      .then(setConfigured).catch(() => { if (!request.signal.aborted) setConfigured(false); });
    return () => { request.abort(); controller.current?.abort(); };
  }, []);

  async function organize() {
    if (controller.current || !note.trim()) return;
    const request = new AbortController();
    controller.current = request;
    setError("");
    setBusy(true);
    try {
      const raw = await refinePrompt(note, null, AbortSignal.any([request.signal, AbortSignal.timeout(95_000)]), localTaskDay());
      const draft = suggestion(raw);
      if (!request.signal.aborted) onDraft(draft.fields, draft.question);
    } catch {
      if (!request.signal.aborted) setError("Couldn’t organize this note. Try again or open it as a draft.");
    } finally {
      if (!request.signal.aborted) setBusy(false);
      controller.current = null;
    }
  }

  function plainDraft() {
    const [first = "", ...rest] = note.trim().split("\n");
    onDraft({ title: first.slice(0, 240), notes: [first.slice(240), ...rest].filter(Boolean).join("\n") });
  }

  return <section className="task-capture" aria-label="Quick capture">
    <header><Sparkles size={16} aria-hidden="true" /><h3>Quick capture</h3><button className="icon-button" type="button" aria-label="Close quick capture" onClick={onClose}><X aria-hidden="true" /></button></header>
    <textarea autoFocus className="input" aria-label="Task note" maxLength={2400} rows={4} value={note} disabled={busy}
      onChange={event => onNote(event.target.value)} placeholder="Send the edit to the studio tomorrow at 3 pm" />
    <p>{configured ? "Organize with Codex sends only this note for an editable suggestion." : configured === false ? "Sign in to Codex on the host to organize notes with AI. Drafts are available now." : "Write a note and turn it into a draft."}</p>
    {(error || voice.error) && <p className="task-capture-error" role="alert">{error || "Dictation failed. Try again or type your note."}</p>}
    <div className="task-capture-actions">
      {voice.available && <button type="button" className="icon-button" disabled={busy || voice.state === "transcribing"} aria-label={voice.state === "recording" ? "Finish dictation" : "Dictate task"} onClick={voice.press}>{voice.state === "recording" ? <Square /> : <AudioLines />}</button>}
      {voice.state !== "idle" && <small role="status">{voice.state === "recording" ? "Recording…" : voice.state === "transcribing" ? "Transcribing…" : "Opening mic…"}</small>}
      <button type="button" className="btn" disabled={busy || voice.state !== "idle" || !note.trim()} onClick={plainDraft}>Draft <ArrowRight aria-hidden="true" /></button>
      {configured && <button type="button" className="btn btn-primary" disabled={busy || voice.state !== "idle" || !note.trim()} onClick={() => void organize()}>{busy ? "Organizing…" : "Organize with Codex"}</button>}
    </div>
  </section>;
}
