import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useT } from "../lib/i18n.ts";
import "./ConversationSearch.css";

/** Searches only messages already loaded, without hiding evidence, live output or approvals. */
export function ConversationSearch({ container, revision }: { container: RefObject<HTMLDivElement>; revision: unknown }) {
  const t = useT();
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const [count, setCount] = useState(0), [position, setPosition] = useState(0);
  const previousQuery = useRef("");
  const matches = useRef<HTMLElement[]>([]), input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    for (const element of matches.current) element.classList.remove("is-search-match", "is-search-current");
    const q = query.trim().toLocaleLowerCase();
    matches.current = open && q ? Array.from(container.current?.querySelectorAll<HTMLElement>(".chat-turn") ?? []).filter(element => element.innerText.toLocaleLowerCase().includes(q)) : [];
    for (const element of matches.current) element.classList.add("is-search-match");
    setCount(matches.current.length); setPosition(0);
    const first = matches.current[0];
    if (first) { first.classList.add("is-search-current"); if (previousQuery.current !== q) first.scrollIntoView({ block: "center", behavior: "instant" }); }
    previousQuery.current = q;
    return () => { for (const element of matches.current) element.classList.remove("is-search-match", "is-search-current"); };
  }, [query, open, revision, container]);
  const jump = (step: number) => {
    if (!matches.current.length) return;
    const index = (position + step + matches.current.length) % matches.current.length;
    for (const element of matches.current) element.classList.remove("is-search-current");
    const element = matches.current[index]!; element.classList.add("is-search-current"); element.scrollIntoView({ block: "center", behavior: "instant" }); setPosition(index);
  };
  return <div className={`conversation-search${open ? " is-open" : ""}`}>
    {open ? <div className="conversation-search-controls" role="search" aria-label={t("Search loaded messages")}>
      <Search aria-hidden="true" /><input ref={input} type="search" autoFocus value={query} aria-label={t("Search loaded messages")} placeholder={t("Search loaded messages")} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); } if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); jump(event.shiftKey ? -1 : 1); } }} />
      <span role="status">{count ? `${position + 1}/${count}` : query ? t("No matches") : ""}</span>
      <button className="icon-button" type="button" disabled={!count} aria-label={t("Previous match")} onClick={() => jump(-1)}><ChevronUp aria-hidden="true" /></button><button className="icon-button" type="button" disabled={!count} aria-label={t("Next match")} onClick={() => jump(1)}><ChevronDown aria-hidden="true" /></button><button className="icon-button" type="button" aria-label={t("Close search")} onClick={() => setOpen(false)}><X aria-hidden="true" /></button>
    </div> : <button className="icon-button" type="button" aria-label={t("Search conversation")} title={t("Search conversation")} onClick={() => setOpen(true)}><Search aria-hidden="true" /></button>}
  </div>;
}
