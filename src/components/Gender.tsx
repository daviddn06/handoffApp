import { Users } from "lucide-react";
import {
  GENDERS,
  GENDER_LABELS,
  GENDER_PREFERENCES,
  GENDER_PREFERENCE_LABELS,
  type Gender,
  type GenderPreference,
  type Listing,
  type User,
} from "../types";

/**
 * The student's own gender. Always optional, four calm options, and the last
 * one is a real answer rather than a blank.
 */
export function GenderChoice({
  value,
  onChange,
  name,
  hint = "Used for roommate preferences on shared rooms.",
  label = "Gender",
  tabIndex,
}: {
  value: Gender;
  onChange: (next: Gender) => void;
  name: string;
  hint?: string;
  label?: string;
  tabIndex?: number;
}) {
  return (
    <fieldset className="gender-field">
      <legend>{label}</legend>
      <div className="gender-options" role="radiogroup" aria-label={label}>
        {GENDERS.map((option) => (
          <label
            key={option}
            className={`gender-option ${value === option ? "is-on" : ""}`}
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              tabIndex={tabIndex}
              onChange={() => onChange(option)}
            />
            <span>{GENDER_LABELS[option]}</span>
          </label>
        ))}
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </fieldset>
  );
}

/**
 * The lister's roommate preference. Offered only for a private or shared room,
 * because a preference is lawful only where the lister or their roommates live
 * in the home.
 */
export function PreferenceChoice({
  value,
  onChange,
  roomType,
}: {
  value: GenderPreference;
  onChange: (next: GenderPreference) => void;
  roomType: Listing["roomType"];
}) {
  if (roomType === "entire")
    return (
      <p className="preference-note">
        Entire places are open to anyone. Roommate preferences apply to shared
        homes.
      </p>
    );
  return (
    <fieldset className="gender-field preference-field">
      <legend>
        <Users size={14} aria-hidden="true" />
        Who is this for?
      </legend>
      <div
        className="gender-options preference-options"
        role="radiogroup"
        aria-label="Who is this for?"
      >
        {GENDER_PREFERENCES.map((option) => (
          <label
            key={option}
            className={`gender-option ${value === option ? "is-on" : ""}`}
          >
            <input
              type="radio"
              name="genderPreference"
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            <span>{GENDER_PREFERENCE_LABELS[option]}</span>
          </label>
        ))}
      </div>
      <p className="field-hint">
        Allowed for shared homes where you or your roommates live. Keep it to
        what you need.
      </p>
    </fieldset>
  );
}

/** Soft neutral tag wherever a listing carries a roommate preference. */
export function GenderTag({
  preference,
  className = "",
}: {
  preference: GenderPreference;
  className?: string;
}) {
  if (preference === "any") return null;
  return (
    <span className={`pill gender-tag ${className}`.trim()}>
      <Users size={11} aria-hidden="true" />
      {GENDER_PREFERENCE_LABELS[preference]}
    </span>
  );
}

/** True when this student is outside what the lister asked for. */
export function preferenceMismatch(
  preference: GenderPreference,
  gender: User["gender"] | undefined,
) {
  if (preference === "any") return false;
  if (preference.startsWith("women")) return gender !== "woman";
  return gender !== "man";
}

/** "women only" and friends, for a sentence rather than a tag. */
export function preferenceSentence(preference: GenderPreference) {
  return GENDER_PREFERENCE_LABELS[preference].toLowerCase();
}
