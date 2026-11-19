import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bookmark, Search, Trash2, X } from "lucide-react";
import { deletePrompt, savePrompt, useWorkspacePreferences } from "../lib/workspacePreferences.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
import { usePhoneSheetBack } from "../lib/sheetHistory.ts";
import { useSheetSwipe } from "../lib/sheets.ts";
import { useT } from "../lib/i18n.ts";
import { WorkspaceSync } from "./WorkspaceSync.tsx";
import "./PromptLibrary.css";

export function PromptLibrary({ draft, onInsert, onClose }: { draft: string; onInsert(text: string): void; onClose(): void }) {
  const t = useT(), preferences = useWorkspacePreferences();
  const [text, setText] = useState(draft), [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const matching = preferences.prompts.filter(prompt => prompt.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const surface = useFocusTrap<HTMLDivElement>(true);
  usePhoneSheetBack(onClose); useSheetSwipe(surface, onClose);
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); event.stopPropagation(); onClose(); } }; window.addEventListener("keydown", escape, true); return () => window.removeEventListener("keydown", escape, true); }, [onClose]);
  return createPortal(<div className="modal-scrim" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div className="modal prompt-library" ref={surface} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t("Saved prompts")}>
    <header className="modal-header"><h2 className="modal-title"><Bookmark aria-hidden="true" />{t("Saved prompts")}</h2><button className="icon-button" type="button" aria-label={t("Close")} onClick={onClose}><X aria-hidden="true" /></button></header>
    <div className="modal-body"><p className="field-hint">{t("Saved on this device. Text only; attachments are not saved. Nothing is sent automatically.")}</p>
    <label className="field"><span className="field-label">{t("Prompt text")}</span><textarea className="input" value={text} maxLength={20000} rows={4} onChange={event => setText(event.target.value)} /></label>
    <button className="btn" type="button" disabled={!text.trim() || preferences.prompts.length >= 20} onClick={() => { const ok = savePrompt(text); setError(!ok); if (ok) setText(""); }}>{t("Save prompt")}</button><span className="field-hint"> {preferences.prompts.length}/20</span>
    {error && <p role="alert">{t("Could not save on this device. Check browser storage.")}</p>}
    {!preferences.prompts.length && <p className="prompt-library-empty">{t("Keep your best briefs here, ready to reuse.")}</p>}
    {preferences.prompts.length > 0 && <label className="prompt-library-search"><Search aria-hidden="true" /><input className="input" type="search" aria-label={t("Search saved prompts")} placeholder={t("Search saved prompts")} value={query} onChange={event => setQuery(event.target.value)} /></label>}
    {preferences.prompts.length > 0 && !matching.length && <p role="status" className="prompt-library-empty">{t("No saved prompts match your search.")}</p>}
    <ul>{matching.map(prompt => <li key={prompt.id}><button type="button" className="prompt-library-use" onClick={() => { onInsert(prompt.text); onClose(); }}><strong>{prompt.text.split("\n")[0]}</strong><span>{t("Add to draft")}</span></button><button className="icon-button" type="button" aria-label={t("Delete saved prompt")} onClick={() => setError(!deletePrompt(prompt.id))}><Trash2 aria-hidden="true" /></button></li>)}</ul>
    <WorkspaceSync />
    </div>
  </div></div>, document.body);
}
