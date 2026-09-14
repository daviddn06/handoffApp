import { Link } from "react-router-dom";
import { FileText, ShieldCheck } from "lucide-react";
import { LEGAL_CONTACT, LEGAL_UPDATED, PRIVACY, TERMS } from "../content/legal";

export default function Legal({ kind }: { kind: "terms" | "privacy" }) {
  const terms = kind === "terms";
  const sections = terms ? TERMS : PRIVACY;
  return (
    <div className="page-container narrow legal-page">
      <div className="legal-head enter-stagger">
        <div className="legal-tabs" role="tablist">
          <Link
            to="/terms"
            role="tab"
            aria-selected={terms}
            className={terms ? "is-on" : ""}
          >
            <FileText size={15} /> Terms of Service
          </Link>
          <Link
            to="/privacy"
            role="tab"
            aria-selected={!terms}
            className={!terms ? "is-on" : ""}
          >
            <ShieldCheck size={15} /> Privacy Policy
          </Link>
        </div>
        <h1>{terms ? "Terms of Service" : "Privacy Policy"}</h1>
        <p className="muted">
          Last updated {LEGAL_UPDATED}.{" "}
          {terms
            ? "Handoff is a student to student marketplace. It does not touch payments and it is not a party to any lease."
            : "What Handoff keeps, why, and who can see it."}
        </p>
      </div>
      <ol className="legal-sections enter-stagger">
        {sections.map((section, i) => (
          <li key={section.title} id={section.title.toLowerCase().replace(/[^a-z]+/g, "-")}>
            <h2>
              <span className="legal-number">{i + 1}</span>
              {section.title}
            </h2>
            {section.body.map((paragraph, j) => (
              <p key={j}>{paragraph}</p>
            ))}
          </li>
        ))}
      </ol>
      <div className="legal-contact surface">
        <strong>Contact</strong>
        <p>
          <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>. Write from
          your school email so we can confirm it is you.
        </p>
      </div>
    </div>
  );
}
