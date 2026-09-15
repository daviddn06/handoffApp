/**
 * Internal dashboard shell. It owns its left nav and its own routes, and lives
 * under the internal chrome on internal.handofflease.com. Its sections are
 * mounted at the root there, so every link below stays relative.
 */
import { lazy, Suspense } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import {
  ClipboardList,
  Flag,
  Gauge,
  House,
  Inbox,
  ListChecks,
  Server,
  Sparkles,
  Users,
} from "lucide-react";
import { useApp } from "../../lib/context";
import { isInternalSurface } from "../../surface";
import { EmptyState, Loading } from "../../components/ui";
import "../../styles/admin.css";

const Overview = lazy(() => import("./Overview"));
const UsersPage = lazy(() => import("./Users"));
const ListingsPage = lazy(() => import("./Listings"));
const RequestsPage = lazy(() => import("./Requests"));
const ReportsPage = lazy(() => import("./Reports"));
const WaitlistPage = lazy(() => import("./Waitlist"));
const AiUsagePage = lazy(() => import("./AiUsage"));
const SystemPage = lazy(() => import("./System"));
const ReferralsPage = lazy(() => import("./Referrals"));
const AuditPage = lazy(() => import("./Audit"));

const NAV = [
  { to: "", label: "Overview", icon: Gauge, end: true },
  { to: "users", label: "Users", icon: Users },
  { to: "referrals", label: "Student outreach", icon: ClipboardList },
  { to: "listings", label: "Listings", icon: House },
  { to: "requests", label: "Requests", icon: Inbox },
  { to: "reports", label: "Reports", icon: Flag },
  { to: "waitlist", label: "Waitlist", icon: ListChecks },
  { to: "ai-usage", label: "AI usage", icon: Sparkles },
  { to: "system", label: "System", icon: Server },
  { to: "audit", label: "Audit", icon: ClipboardList },
];

/** A wrong URL inside the dashboard. On the internal host it points home. */
function NotFound() {
  return (
    <div className="page-container">
      <EmptyState
        title="This page has moved on."
        description={
          isInternalSurface
            ? "That section does not exist."
            : "Let’s get you back to finding your next place."
        }
      >
        <Link className="button primary" to={isInternalSurface ? "/" : "/browse"}>
          {isInternalSurface ? "Back to the dashboard" : "Back to browse"}
        </Link>
      </EmptyState>
    </div>
  );
}

export default function Admin() {
  const { user } = useApp();
  if (!user?.isAdmin) return <NotFound />;
  return (
    <div className="admin-shell">
      <nav className="admin-nav" aria-label="Dashboard sections">
        <span className="admin-nav-title">Dashboard</span>
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={label} to={to} end={end}>
            <Icon size={16} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="admin-content">
        <Suspense fallback={<Loading label="Loading dashboard…" />}>
          <Routes>
            <Route index element={<Overview />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="referrals" element={<ReferralsPage />} />
            <Route path="referrals/:id" element={<ReferralsPage />} />
            <Route path="listings" element={<ListingsPage />} />
            <Route path="requests" element={<RequestsPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="waitlist" element={<WaitlistPage />} />
            <Route path="ai-usage" element={<AiUsagePage />} />
            <Route path="system" element={<SystemPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  );
}
