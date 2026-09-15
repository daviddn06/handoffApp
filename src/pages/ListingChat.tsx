// Talk it through. One question at a time, and the draft filling in beside it.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, Minus, MessageCircle, Send } from "lucide-react";
import { api, dateLabel, errorMessage, money } from "../lib/api";
import { useApp } from "../lib/context";
import { ROOM_LABELS } from "../types";
import {
  FIELD_LABELS,
  emptyDraft,
  readyForEditor,
  storeImport,
  type ChatResult,
  type ImportDraft,
} from "../lib/import";
import { Button, ErrorBox } from "../components/ui";
import { StreamingText, ThinkingLine } from "../components/AiText";
import { SchoolNotLive } from "../components/SchoolNotLive";

type Turn = { role: "user" | "assistant"; content: string };
const THINKING = ["Thinking it over", "Writing your listing"];
const PANEL_FIELDS = [
  "title",
  "roomType",
  "address",
  "availableFrom",
  "availableTo",
  "price",
  "deposit",
  "description",
] as const;

function show(draft: ImportDraft, field: (typeof PANEL_FIELDS)[number]) {
  const value = draft[field];
  if (value === null || value === "" || value === undefined) return "";
  if (field === "roomType")
    return draft.roomType ? ROOM_LABELS[draft.roomType] : "";
  if (field === "price" || field === "deposit") return money(Number(value));
  if (field === "availableFrom" || field === "availableTo")
    return dateLabel(String(value), true);
  if (field === "description") return `${String(value).slice(0, 90)}...`;
  return String(value);
}

export default function ListingChat() {
  const { user, notify } = useApp();
  const navigate = useNavigate();
  const [turns, setTurns] = useState<Turn[]>([]),
    [draft, setDraft] = useState<ImportDraft>(emptyDraft()),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  const logRef = useRef<HTMLDivElement>(null),
    started = useRef(false);
  useEffect(() => {
    logRef.current?.scrollTo({
      top: logRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, busy]);
  async function send(history: Turn[], next: ImportDraft) {
    setBusy(true);
    setError("");
    try {
      const result = await api<ChatResult>("/import/chat", {
        method: "POST",
        body: JSON.stringify({ messages: history, draft: next }),
      });
      setTurns([...history, { role: "assistant", content: result.reply }]);
      setDraft(result.draft);
      setDone(result.done);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (started.current || (user && !user.campusId)) return;
    started.current = true;
    send([], emptyDraft());
    // The opening question is one turn with an empty history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  function submit(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    const history: Turn[] = [...turns, { role: "user", content: message }];
    setTurns(history);
    send(history, draft);
  }
  function openEditor() {
    storeImport({
      draft,
      missing: Object.keys(FIELD_LABELS).filter((field) => {
        const value = draft[field as keyof ImportDraft];
        return Array.isArray(value) ? !value.length : !value;
      }),
      notes: "",
    });
    notify("Your answers are in the form. Check the highlighted fields.");
    navigate("/listings/new?mode=manual&from=import");
  }
  if (user && !user.campusId)
    return (
      <div className="page-container narrow">
        <SchoolNotLive />
      </div>
    );
  const canOpen = done || readyForEditor(draft);
  return (
    <div className="page-container chat-page">
      <section className="chat-column">
        <header className="chat-head">
          <span className="chat-mark" aria-hidden="true">
            <MessageCircle size={16} />
          </span>
          <h1>Talk it through</h1>
        </header>
        <div className="chat-log" ref={logRef}>
          {turns.map((turn, index) => (
            <div className={`chat-bubble ${turn.role}`} key={index}>
              {turn.role === "assistant" ? (
                <StreamingText
                  text={turn.content}
                  animate={index === turns.length - 1}
                />
              ) : (
                turn.content
              )}
            </div>
          ))}
          {busy && (
            <div className="chat-thinking">
              <ThinkingLine states={THINKING} />
            </div>
          )}
          {error && <ErrorBox message={error} />}
        </div>
        {canOpen && (
          <div className="chat-open">
            <Button type="button" onClick={openEditor}>
              Open in the editor
              <ArrowRight size={16} />
            </Button>
          </div>
        )}
        <form className="chat-composer" onSubmit={submit}>
          <input
            value={input}
            maxLength={1000}
            disabled={busy}
            aria-label="Your answer"
            placeholder="Type your answer"
            onChange={(event) => setInput(event.target.value)}
          />
          <Button type="submit" disabled={busy || !input.trim()}>
            <Send size={16} />
            <span className="sr-only">Send</span>
          </Button>
        </form>
      </section>
      <aside className="chat-side">
        <h2>Your listing so far</h2>
        <ul className="draft-list">
          {PANEL_FIELDS.map((field) => {
            const value = show(draft, field);
            return (
              <li
                key={field}
                className={value ? "is-filled" : "is-missing"}
              >
                <span className="draft-mark" aria-hidden="true">
                  {value ? <Check size={14} /> : <Minus size={14} />}
                </span>
                <span>
                  <small>{FIELD_LABELS[field]}</small>
                  <strong>{value || "Not yet"}</strong>
                </span>
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}
