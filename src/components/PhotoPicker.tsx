import { useId, useRef, useState } from "react";
import { Camera, LoaderCircle, Trash2 } from "lucide-react";
import { Avatar } from "./Avatar";

/**
 * Choosing a profile photo. The same block runs in the last sign up step and
 * in profile settings. It never insists: the photo is optional, and the line
 * under it only says why students usually add one.
 */
export const PHOTO_RECOMMENDATION =
  "Optional, but students reply more when they can see who they are talking to.";

export function PhotoPicker({
  src,
  name,
  busy = false,
  onPick,
  onRemove,
  chooseLabel = "Choose a photo",
  className = "",
}: {
  /** The photo to show, either the stored one or a local preview. */
  src?: string | null;
  name?: string | null;
  busy?: boolean;
  onPick: (file: File) => void;
  onRemove?: () => void;
  chooseLabel?: string;
  className?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (file?: File | null) => {
    if (file) onPick(file);
  };
  return (
    <div className={`photo-picker ${className}`}>
      <label
        className={`photo-drop ${over ? "is-over" : ""}`}
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files?.[0]);
        }}
      >
        <Avatar src={src} name={name} size={84} />
        <span className="photo-drop-badge">
          {busy ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Camera size={15} />
          )}
        </span>
      </label>
      <div className="photo-picker-text">
        <div className="photo-picker-actions">
          <button
            type="button"
            className="button secondary small"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Camera size={15} />
            {src ? "Change photo" : chooseLabel}
          </button>
          {src && onRemove && (
            <button
              type="button"
              className="button ghost small"
              disabled={busy}
              onClick={onRemove}
            >
              <Trash2 size={15} />
              Remove
            </button>
          )}
        </div>
        {!src && <p className="photo-recommend">{PHOTO_RECOMMENDATION}</p>}
      </div>
      <input
        id={id}
        ref={input}
        className="photo-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
