// The first thing a student sees after List your place. Three ways in, with
// the manual form always available so a missing key or an unverified email
// never blocks listing.
import { useNavigate } from "react-router-dom";
import { ArrowRight, Lock, MessageCircle, PenLine, Sparkles } from "lucide-react";
import { useApp } from "../lib/context";
import { BackLink } from "../components/ui";
import { SchoolNotLive } from "../components/SchoolNotLive";

type Choice = {
  key: string;
  icon: typeof Sparkles;
  title: string;
  description: string;
  action: string;
  to: string;
  ai: boolean;
};
const CHOICES: Choice[] = [
  {
    key: "import",
    icon: Sparkles,
    title: "Smart import",
    description:
      "Paste a post, drop screenshots or a PDF. We fill in the form.",
    action: "Paste or drop it",
    to: "/listings/new?mode=import",
    ai: true,
  },
  {
    key: "chat",
    icon: MessageCircle,
    title: "Talk it through",
    description: "Answer a few questions and we write the listing.",
    action: "Start the chat",
    to: "/listings/new?mode=chat",
    ai: true,
  },
  {
    key: "manual",
    icon: PenLine,
    title: "Fill it in myself",
    description: "The six step form.",
    action: "Open the form",
    to: "/listings/new?mode=manual",
    ai: false,
  },
];

export default function ListingStart() {
  const { user, aiReady } = useApp();
  const navigate = useNavigate();
  if (user && !user.campusId)
    return (
      <div className="page-container narrow">
        <SchoolNotLive />
      </div>
    );
  const verified = Boolean(user?.verified);
  return (
    <div className="page-container start-page">
      <BackLink to="/my-listings">My listings</BackLink>
      <div className="start-head">
        <h1>How do you want to list?</h1>
        <p>Smart import and the chat helper do the typing.</p>
      </div>
      <div className="start-grid enter-stagger">
        {CHOICES.map((choice) => {
          const Icon = choice.icon;
          const locked = choice.ai && !verified;
          const setup = choice.ai && !aiReady;
          const blocked = setup && !locked;
          const target = locked ? "/verify" : choice.to;
          return (
            <button
              type="button"
              key={choice.key}
              className={`start-card ${choice.ai ? "" : "plain"}`}
              aria-disabled={blocked || undefined}
              onClick={() => {
                if (blocked) return;
                navigate(target);
              }}
            >
              <span className="start-icon" aria-hidden="true">
                <Icon size={21} strokeWidth={1.8} />
              </span>
              <h2>{choice.title}</h2>
              <p>{choice.description}</p>
              <span className="start-tags">
                {setup && <span className="pill amber">Being set up</span>}
                {locked && (
                  <span className="pill blue">
                    <Lock size={11} aria-hidden="true" />
                    Confirm your email first
                  </span>
                )}
              </span>
              {!blocked && (
                <span className="start-go">
                  {locked ? "Confirm your email" : choice.action}
                  <ArrowRight size={15} aria-hidden="true" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="start-foot">
        Nothing goes live until you review it and publish.
      </p>
    </div>
  );
}
