/**
 * One student's face, or their initials when they have not added a photo.
 * The same component everywhere a person is named, so a photo added once
 * shows up in the header, on a listing and on a request without any of those
 * places knowing how it is stored.
 */
export type AvatarSize = 28 | 36 | 48 | 84;

export function initialsFor(name?: string | null) {
  return (
    (name || "")
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("") || "S"
  );
}

export function Avatar({
  src,
  name,
  size = 36,
  className = "",
  blurred = false,
}: {
  src?: string | null;
  name?: string | null;
  size?: AvatarSize;
  className?: string;
  /** Held back with the rest of a locked listing. */
  blurred?: boolean;
}) {
  const shared = `avatar-el size-${size} ${blurred ? "is-blurred" : ""} ${className}`;
  if (src)
    return (
      <img
        className={`avatar-photo ${shared}`}
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
      />
    );
  return (
    <span className={`avatar ${shared}`} aria-hidden="true">
      {initialsFor(name)}
    </span>
  );
}
