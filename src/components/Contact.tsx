import { Mail, Phone, AtSign, Link as LinkIcon } from "lucide-react";
import type { ComponentType } from "react";
import {
  CHANNEL_LABELS,
  OPTIONAL_CHANNELS,
  SHARE_CHANNELS,
  type Contact,
  type ShareChannel,
} from "../types";
import { Field } from "./ui";

/**
 * lucide-react 1.x no longer ships brand marks, so Instagram is the @ that a
 * handle starts with and Facebook is the profile link it points at.
 */
export const CHANNEL_ICONS: Record<
  ShareChannel,
  ComponentType<{ size?: number }>
> = {
  email: Mail,
  phone: Phone,
  instagram: AtSign,
  facebook: LinkIcon,
};

/** The three channels a student can fill in, keyed the way the API is. */
export type ContactValues = {
  phone: string;
  instagram: string;
  facebook: string;
};

/** How each channel reads inside a sentence. */
const SENTENCE_LABELS: Record<ShareChannel, string> = {
  email: "email",
  phone: "phone number",
  instagram: "Instagram",
  facebook: "Facebook",
};

/** "your email and Instagram", or "your email, phone number and Instagram". */
export function channelSentence(channels: ShareChannel[]) {
  const names = SHARE_CHANNELS.filter((name) => channels.includes(name)).map(
    (name) => SENTENCE_LABELS[name],
  );
  if (names.length <= 1) return `your ${names[0] || "email"}`;
  return `your ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** A US number back in the shape a student wrote it. */
export function phoneLabel(value: string) {
  const digits = value.replace(/\D/g, "");
  const national = digits.length === 11 ? digits.slice(1) : digits;
  if (national.length !== 10) return value;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

/** Where a chip points. Facebook keeps a link that was pasted as a link. */
export function channelHref(channel: ShareChannel, value: string) {
  if (channel === "email") return `mailto:${value}`;
  if (channel === "phone") return `tel:${value}`;
  if (channel === "instagram") return `https://instagram.com/${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(?:[a-z0-9-]+\.)?facebook\.com\//i.test(value))
    return `https://${value}`;
  return `https://facebook.com/${value}`;
}

/** What the chip reads. */
export function channelLabel(channel: ShareChannel, value: string) {
  if (channel === "phone") return phoneLabel(value);
  if (channel === "instagram") return `@${value}`;
  if (channel === "facebook")
    return value.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return value;
}

/**
 * The channels an accepted request revealed, as a row of chips. Each one is a
 * real link, so a tap opens mail, the dialler or the profile.
 */
export function ContactChips({
  contact,
  className = "",
}: {
  contact: Contact;
  className?: string;
}) {
  const present = SHARE_CHANNELS.filter(
    (channel) => channel !== "email" && contact[channel],
  );
  if (!present.length) return null;
  return (
    <div className={`contact-chips ${className}`.trim()}>
      {present.map((channel) => {
        const value = contact[channel] as string;
        const Icon = CHANNEL_ICONS[channel];
        return (
          <a
            key={channel}
            className="contact-chip"
            href={channelHref(channel, value)}
            target={channel === "phone" ? undefined : "_blank"}
            rel="noreferrer"
            title={`${CHANNEL_LABELS[channel]}: ${channelLabel(channel, value)}`}
          >
            <Icon size={14} />
            <span>{channelLabel(channel, value)}</span>
          </a>
        );
      })}
    </div>
  );
}

/** One row: the input, and the toggle that decides whether it is shared. */
function ChannelRow({
  channel,
  value,
  onValue,
  shared,
  onShared,
  error,
  tabIndex,
}: {
  channel: Exclude<ShareChannel, "email">;
  value: string;
  onValue: (next: string) => void;
  shared: boolean;
  onShared: (next: boolean) => void;
  error?: string;
  tabIndex?: number;
}) {
  const Icon = CHANNEL_ICONS[channel];
  const hints: Record<string, string> = {
    phone: "US number, for example (213) 555-0142.",
    instagram: "Your handle or a link to your profile.",
    facebook: "A profile link or your username.",
  };
  const placeholders: Record<string, string> = {
    phone: "(213) 555-0142",
    instagram: "@yourhandle",
    facebook: "facebook.com/yourprofile",
  };
  return (
    <div className="contact-row">
      <Field
        label={CHANNEL_LABELS[channel]}
        hint={hints[channel]}
        error={error}
        className="contact-field"
      >
        <div className="contact-input">
          <Icon size={16} />
          <input
            type={channel === "phone" ? "tel" : "text"}
            autoComplete={channel === "phone" ? "tel" : "off"}
            maxLength={channel === "phone" ? 40 : 200}
            tabIndex={tabIndex}
            value={value}
            placeholder={placeholders[channel]}
            onChange={(e) => onValue(e.target.value)}
          />
        </div>
      </Field>
      <label
        className={`contact-toggle ${shared && value.trim() ? "is-on" : ""}`}
      >
        <input
          type="checkbox"
          checked={shared && Boolean(value.trim())}
          disabled={!value.trim()}
          tabIndex={tabIndex}
          onChange={(e) => onShared(e.target.checked)}
        />
        <span>Share when a request is accepted</span>
      </label>
    </div>
  );
}

/**
 * The Contact section. Email is stated as always shared and verified, then the
 * three optional channels each with their own share toggle, then one line
 * saying exactly what another student will see.
 */
export function ContactFields({
  email,
  values,
  onValues,
  channels,
  onChannels,
  errors = {},
  tabIndex,
}: {
  email: string;
  values: ContactValues;
  onValues: (next: ContactValues) => void;
  channels: ShareChannel[];
  onChannels: (next: ShareChannel[]) => void;
  errors?: Record<string, string>;
  tabIndex?: number;
}) {
  const shared = SHARE_CHANNELS.filter(
    (channel) =>
      channel === "email" ||
      (channels.includes(channel) &&
        values[channel as keyof ContactValues].trim()),
  );
  const toggle = (channel: ShareChannel, on: boolean) =>
    onChannels(
      on
        ? [...channels.filter((name) => name !== channel), channel]
        : channels.filter((name) => name !== channel),
    );
  return (
    <div className="contact-section">
      <div className="contact-email">
        <Mail size={16} />
        <div>
          <strong>{email}</strong>
          <small>Always shared, and verified as your student email.</small>
        </div>
      </div>
      {OPTIONAL_CHANNELS.map((channel) => (
        <ChannelRow
          key={channel}
          channel={channel}
          value={values[channel]}
          onValue={(next) => onValues({ ...values, [channel]: next })}
          shared={channels.includes(channel)}
          onShared={(on) => toggle(channel, on)}
          error={errors[channel]}
          tabIndex={tabIndex}
        />
      ))}
      <p className="contact-summary">
        When a request is accepted, the other student sees{" "}
        {channelSentence(shared)}.
      </p>
    </div>
  );
}

/**
 * The compact per request chooser. Only channels the student has filled in
 * appear, and email is shown as fixed because it cannot be taken out.
 */
export function ChannelChooser({
  user,
  channels,
  onChannels,
}: {
  user: { phone: string | null; instagram: string | null; facebook: string | null };
  channels: ShareChannel[];
  onChannels: (next: ShareChannel[]) => void;
}) {
  const available = OPTIONAL_CHANNELS.filter((channel) => user[channel]);
  if (!available.length) return null;
  return (
    <div className="channel-chooser">
      <span className="channel-chooser-fixed">
        <Mail size={13} />
        Email
      </span>
      {available.map((channel) => {
        const Icon = CHANNEL_ICONS[channel];
        const on = channels.includes(channel);
        return (
          <label
            key={channel}
            className={`channel-choice ${on ? "is-on" : ""}`}
          >
            <input
              type="checkbox"
              checked={on}
              onChange={(e) =>
                onChannels(
                  e.target.checked
                    ? [...channels.filter((name) => name !== channel), channel]
                    : channels.filter((name) => name !== channel),
                )
              }
            />
            <Icon size={13} />
            {CHANNEL_LABELS[channel]}
          </label>
        );
      })}
    </div>
  );
}
