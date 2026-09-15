// Smart import. Paste the post, drop the screenshots, one button.
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Sparkles, Upload, X } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { useApp } from "../lib/context";
import { storeImport, type ImportResult } from "../lib/import";
import { Button, ErrorBox, Field } from "../components/ui";
import { ThinkingLine } from "../components/AiText";
import { SchoolNotLive } from "../components/SchoolNotLive";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const MAX_IMAGES = 4;
const THINKING = [
  "Reading your listing",
  "Pulling out dates and price",
  "Finding it on the map",
];

export default function ListingImport() {
  const { user, notify } = useApp();
  const navigate = useNavigate();
  const [text, setText] = useState(""),
    [files, setFiles] = useState<File[]>([]),
    [previews, setPreviews] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [dragOver, setDragOver] = useState(false),
    [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  useEffect(
    () => () =>
      Object.values(previewsRef.current).forEach((url) =>
        URL.revokeObjectURL(url),
      ),
    [],
  );
  const key = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
  function add(incoming: FileList | File[] | null) {
    if (!incoming) return;
    setError("");
    const list = Array.from(incoming);
    if (list.some((file) => !ACCEPTED.includes(file.type)))
      return setError("Add PNG, JPG or WebP screenshots, or one PDF.");
    if (list.some((file) => file.size > 8 * 1024 * 1024))
      return setError("Each file needs to be under 8 MB.");
    setFiles((current) => {
      const merged = [...current];
      for (const file of list)
        if (!merged.some((item) => key(item) === key(file))) merged.push(file);
      const images = merged.filter((file) => file.type !== "application/pdf");
      const pdfs = merged.filter((file) => file.type === "application/pdf");
      if (images.length > MAX_IMAGES)
        setError("Smart import reads up to 4 screenshots at a time.");
      if (pdfs.length > 1) setError("Smart import reads one PDF at a time.");
      const next = [...images.slice(0, MAX_IMAGES), ...pdfs.slice(0, 1)];
      setPreviews((old) => {
        const urls = { ...old };
        for (const file of next)
          if (file.type !== "application/pdf" && !urls[key(file)])
            urls[key(file)] = URL.createObjectURL(file);
        return urls;
      });
      return next;
    });
  }
  function remove(file: File) {
    const id = key(file);
    setFiles((current) => current.filter((item) => key(item) !== id));
    setPreviews((old) => {
      if (old[id]) URL.revokeObjectURL(old[id]);
      const next = { ...old };
      delete next[id];
      return next;
    });
  }
  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragOver(false);
    if (busy) return;
    add(event.dataTransfer.files);
  }
  async function run() {
    if (busy) return;
    if (!text.trim() && !files.length)
      return setError("Paste the listing text, or add a screenshot or PDF.");
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("text", text.trim());
    for (const file of files) form.append("files", file);
    try {
      const result = await api<ImportResult>("/import/parse", {
        method: "POST",
        body: form,
      });
      storeImport(result);
      notify(
        result.missing.length
          ? `Imported. ${result.missing.length} thing${result.missing.length === 1 ? "" : "s"} still to add.`
          : "Imported. Check it over before you publish.",
      );
      navigate("/listings/new?mode=manual&from=import");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  if (user && !user.campusId)
    return (
      <div className="page-container narrow">
        <SchoolNotLive />
      </div>
    );
  return (
    <div className="page-container narrow import-page">
      <div className="start-head">
        <h1>Smart import</h1>
        <p>
          Paste the post you already wrote, or drop screenshots and a PDF. We
          pull out the title, dates, rent and amenities, then you check them.
        </p>
      </div>
      <div className="import-card">
        <Field
          label="Paste the listing text"
          hint="A Facebook post, a group chat message, an email, anything you already wrote."
        >
          <textarea
            value={text}
            maxLength={12000}
            onChange={(event) => setText(event.target.value)}
            placeholder="Subletting my room May through August, $1,150 a month, furnished, 10 minute walk to campus..."
          />
        </Field>
        <div className="field">
          <span className="field-label">Screenshots or a PDF</span>
          <div
            className={`import-drop ${dragOver ? "is-over" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileRef.current?.click();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <Upload size={20} aria-hidden="true" />
            <strong>Drop files here, or choose them</strong>
            <span>Up to 4 screenshots (PNG, JPG, WebP) and one PDF.</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPTED.join(",")}
            hidden
            onChange={(event) => {
              add(event.target.files);
              event.target.value = "";
            }}
          />
          {files.length > 0 && (
            <ul className="import-thumbs">
              {files.map((file) => (
                <li className="import-thumb" key={key(file)}>
                  {file.type === "application/pdf" ? (
                    <span className="thumb-doc">
                      <FileText size={20} aria-hidden="true" />
                      {file.name}
                    </span>
                  ) : (
                    <img src={previews[key(file)]} alt={file.name} />
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => remove(file)}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && <ErrorBox message={error} />}
        <div className="import-actions">
          <Button type="button" onClick={run} busy={busy}>
            <Sparkles size={16} />
            Import and continue
          </Button>
          {busy ? (
            <ThinkingLine states={THINKING} />
          ) : (
            <span className="import-note">
              Nothing is published. You land in the form with the gaps marked.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
