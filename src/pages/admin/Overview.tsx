import { useResource } from "../../lib/api";
import { ErrorBox } from "../../components/ui";
import {
  AdminPage,
  Bars,
  Group,
  StatCard,
  StatSkeletons,
  number,
} from "./parts";
import type { Overview as OverviewData } from "./types";

/** Raw database values are not labels. */
const titleCase = (value: string) =>
  value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

const GENDER_LABELS: Record<string, string> = {
  woman: "Women",
  man: "Men",
  nonbinary: "Non-binary",
  unspecified: "Not shared",
};

export default function Overview() {
  const { data, error, loading, refresh } = useResource<OverviewData>(
    "/admin/overview",
  );
  if (error)
    return (
      <AdminPage title="Overview">
        <ErrorBox message={error} retry={refresh} />
      </AdminPage>
    );
  if (loading || !data)
    return (
      <AdminPage title="Overview" description="Everything Handoff knows, at a glance.">
        <StatSkeletons />
      </AdminPage>
    );
  const { totals, series, usersBySchool, usersByGender } = data;
  const status = (record: Record<string, number>, key: string) => record[key] || 0;
  return (
    <AdminPage
      title="Overview"
      description={`Live counts and the last 30 days. Updated ${new Date(
        data.generatedAt,
      ).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })}.`}
    >
      <div className="admin-stat-grid enter-stagger">
        <StatCard
          label="Students"
          value={number(totals.users)}
          hint={`${number(totals.verifiedUsers)} verified`}
          points={series.signups}
        />
        <StatCard
          label="Listings"
          value={number(totals.listings)}
          hint={`${number(status(totals.listingsByStatus, "active"))} live, ${number(status(totals.listingsByStatus, "draft"))} draft`}
          points={series.listings}
          tone="green"
        />
        <StatCard
          label="Requests"
          value={number(totals.requests)}
          hint={`${number(status(totals.requestsByStatus, "pending"))} pending`}
          points={series.requests}
          tone="amber"
        />
        <StatCard
          label="Boosted now"
          value={number(totals.boostedActive)}
          hint="Active boost windows"
        />
        <StatCard
          label="Saved places"
          value={number(totals.saved)}
          hint="Shortlist entries across all students"
        />
        <StatCard
          label="Photos stored"
          value={number(totals.uploads)}
          hint="Uploaded to listings and profiles"
        />
        <StatCard
          label="Waitlist"
          value={number(totals.waitlist)}
          hint="Students at schools that are not open"
        />
        <StatCard
          label="Open reports"
          value={number(totals.reportsOpen)}
          hint={`${number(totals.reports)} total`}
          tone="red"
        />
        <StatCard
          label="Active sessions"
          value={number(totals.sessionsActive)}
          hint="Signed in right now"
        />
        <StatCard
          label="Admins"
          value={number(totals.admins)}
          hint={`${plural(totals.disabledUsers, "disabled account")}`}
        />
      </div>

      <div className="admin-bars-grid">
        <Bars points={series.signups} label="Signups, 30 days" />
        <Bars points={series.listings} label="Listings created, 30 days" tone="green" />
        <Bars points={series.requests} label="Requests, 30 days" tone="amber" />
        {series.aiTokens ? (
          <Bars points={series.aiTokens} label="AI tokens, 30 days" tone="violet" />
        ) : (
          <div className="admin-bars-card is-missing">
            <span className="eyebrow">AI tokens, 30 days</span>
            <p>Smart import has not been installed on this database yet.</p>
          </div>
        )}
        {series.views && (
          <Bars points={series.views} label="Listing views, 30 days" tone="blue" />
        )}
      </div>

      <div className="admin-split">
        <Group title="Top schools">
          <ul className="admin-rank">
            {usersBySchool.map((row) => (
              <li key={row.school}>
                <span>{row.school}</span>
                <b>{number(row.count)}</b>
              </li>
            ))}
            {!usersBySchool.length && <li className="admin-empty">No students yet.</li>}
          </ul>
        </Group>
        <Group title="Students by gender">
          {usersByGender ? (
            <ul className="admin-rank">
              {usersByGender.map((row) => (
                <li key={row.gender}>
                  <span>{GENDER_LABELS[row.gender] || row.gender}</span>
                  <b>{number(row.count)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-empty">
              This database does not carry the gender column yet.
            </p>
          )}
        </Group>
        <Group title="Listings by status">
          <ul className="admin-rank">
            {Object.entries(totals.listingsByStatus).map(([key, count]) => (
              <li key={key}>
                <span>{titleCase(key)}</span>
                <b>{number(count)}</b>
              </li>
            ))}
            {!Object.keys(totals.listingsByStatus).length && (
              <li className="admin-empty">No listings yet.</li>
            )}
          </ul>
        </Group>
        <Group title="Requests by status">
          <ul className="admin-rank">
            {Object.entries(totals.requestsByStatus).map(([key, count]) => (
              <li key={key}>
                <span>{titleCase(key)}</span>
                <b>{number(count)}</b>
              </li>
            ))}
            {!Object.keys(totals.requestsByStatus).length && (
              <li className="admin-empty">No requests yet.</li>
            )}
          </ul>
        </Group>
      </div>
    </AdminPage>
  );
}
