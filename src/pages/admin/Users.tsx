import { useState } from "react";
import { api, errorMessage, useResource } from "../../lib/api";
import { useApp } from "../../lib/context";
import { Button, ErrorBox } from "../../components/ui";
import {
  AdminPage,
  ConfirmModal,
  Drawer,
  Group,
  KeyValues,
  Pager,
  SearchField,
  Select,
  Status,
  TableShell,
  Toolbar,
  number,
  useDebounced,
  when,
  titleCase,
  CopyId,
  type Column,
  type Pending,
} from "./parts";
import type { UserDetail, UsersPage } from "./types";

const COLUMNS: Column[] = [
  { key: "name", label: "Student" },
  { key: "school", label: "School" },
  { key: "state", label: "State" },
  { key: "created", label: "Signed up" },
  { key: "seen", label: "Last sign in" },
  { key: "listings", label: "Listings", numeric: true },
  { key: "requests", label: "Requests", numeric: true },
  { key: "saved", label: "Saved", numeric: true },
];

export default function Users() {
  const { user, notify } = useApp();
  const [query, setQuery] = useState("");
  const [school, setSchool] = useState("");
  const [state, setState] = useState("");
  const [sort, setSort] = useState("created_desc");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const search = useDebounced(query);
  const path = `/admin/users?page=${page}&sort=${sort}&query=${encodeURIComponent(search)}&school=${encodeURIComponent(school)}&verified=${state}`;
  const { data, error, loading, refresh } = useResource<UsersPage>(path);
  const detail = useResource<UserDetail>(openId ? `/admin/users/${openId}` : null);

  async function act(id: string, action: string, body?: unknown) {
    try {
      await api(`/admin/users/${id}/${action}`, {
        method: "POST",
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      notify("Done. The change is saved and recorded in the audit log.");
      refresh();
      detail.refresh();
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }

  const row = detail.data?.user;
  return (
    <AdminPage
      title="Users"
      description="Every account, whichever school they study at."
    >
      <Toolbar>
        <SearchField
          value={query}
          onChange={(next) => {
            setQuery(next);
            setPage(1);
          }}
          placeholder="Search name, email or id"
        />
        <Select
          label="School"
          value={school}
          onChange={(next) => {
            setSchool(next);
            setPage(1);
          }}
          options={[
            { value: "", label: "All schools" },
            ...(data?.schools || []).map((item) => ({
              value: item.school,
              label: `${item.school} (${item.count})`,
            })),
          ]}
        />
        <Select
          label="State"
          value={state}
          onChange={(next) => {
            setState(next);
            setPage(1);
          }}
          options={[
            { value: "", label: "Everyone" },
            { value: "yes", label: "Verified" },
            { value: "no", label: "Unverified" },
            { value: "admin", label: "Admins" },
            { value: "disabled", label: "Disabled" },
          ]}
        />
        <Select
          label="Sort"
          value={sort}
          onChange={setSort}
          options={[
            { value: "created_desc", label: "Newest" },
            { value: "created_asc", label: "Oldest" },
            { value: "name", label: "Name" },
            { value: "email", label: "Email" },
            { value: "listings", label: "Most listings" },
          ]}
        />
      </Toolbar>
      {error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : (
        <>
          <TableShell
            columns={COLUMNS}
            loading={loading}
            empty={!data?.users.length}
            emptyLabel="No account matches those filters."
          >
            {data?.users.map((item) => (
              <tr
                key={item.id}
                onClick={() => setOpenId(item.id)}
                className={openId === item.id ? "is-open" : ""}
              >
                <td>
                  <div className="admin-person">
                    <strong>{item.name}</strong>
                    <span>{item.email}</span>
                  </div>
                </td>
                <td>{item.school || "Unknown"}</td>
                <td>
                  <div className="admin-tags">
                    <Status
                      value={item.verified ? "yes" : "no"}
                      label={item.verified ? "Verified" : "Unverified"}
                    />
                    {item.isAdmin && <Status value="admin" label="Admin" />}
                    {item.disabledAt && <Status value="disabled" label="Disabled" />}
                  </div>
                </td>
                <td>{when(item.createdAt, false)}</td>
                <td>{when(item.lastSignIn, false)}</td>
                <td className="num">{number(item.listingCount)}</td>
                <td className="num">{number(item.requestCount)}</td>
                <td className="num">{number(item.savedCount)}</td>
              </tr>
            ))}
          </TableShell>
          {data && (
            <Pager
              page={data.page}
              pages={data.pages}
              total={data.total}
              onPage={setPage}
            />
          )}
        </>
      )}

      <Drawer
        open={Boolean(openId)}
        onClose={() => setOpenId(null)}
        title={row?.name || "Student"}
        subtitle={row?.email}
      >
        {detail.loading && <p className="admin-empty">Loading account…</p>}
        {detail.error && <ErrorBox message={detail.error} retry={detail.refresh} />}
        {row && detail.data && (
          <>
            <Group title="Account">
              <KeyValues
                items={[
                  ["Id", <CopyId key="id" value={row.id} />],
                  ["School", row.school || "Unknown"],
                  ["Posting campus", row.campusId || "Not open"],
                  ["Verified", row.verified ? when(row.verifiedAt) : "No"],
                  ["Terms accepted", row.termsAccepted ? when(row.termsAcceptedAt) : "No"],
                  ["Gender", titleCase(row.gender) || "Not recorded"],
                  ["Admin", row.isAdmin ? "Yes" : "No"],
                  ["Disabled", row.disabledAt ? when(row.disabledAt) : "No"],
                  ["Signed up", when(row.createdAt)],
                  ["Last sign in", when(row.lastSignIn)],
                  ["Bio", row.bio || "Empty"],
                  [
                    "AI usage",
                    detail.data.aiUsage
                      ? `${number(detail.data.aiUsage.calls)} calls, ${number(detail.data.aiUsage.tokens)} tokens`
                      : "Not tracked",
                  ],
                ]}
              />
            </Group>
            <Group title={`Listings (${detail.data.listings.length})`}>
              <ul className="admin-list">
                {detail.data.listings.map((listing) => (
                  <li key={listing.id}>
                    <span>{listing.title}</span>
                    <Status value={listing.status} />
                  </li>
                ))}
                {!detail.data.listings.length && (
                  <li className="admin-empty">Nothing here yet.</li>
                )}
              </ul>
            </Group>
            <Group title={`Requests sent (${detail.data.requestsSent.length})`}>
              <ul className="admin-list">
                {detail.data.requestsSent.map((request) => (
                  <li key={request.id}>
                    <span>{request.listingTitle}</span>
                    <Status value={request.status} />
                  </li>
                ))}
                {!detail.data.requestsSent.length && (
                  <li className="admin-empty">Nothing here yet.</li>
                )}
              </ul>
            </Group>
            <Group title={`Requests received (${detail.data.requestsReceived.length})`}>
              <ul className="admin-list">
                {detail.data.requestsReceived.map((request) => (
                  <li key={request.id}>
                    <span>
                      {request.requesterName}, {request.listingTitle}
                    </span>
                    <Status value={request.status} />
                  </li>
                ))}
                {!detail.data.requestsReceived.length && (
                  <li className="admin-empty">Nothing here yet.</li>
                )}
              </ul>
            </Group>
            <Group title={`Sessions (${detail.data.sessions.length})`}>
              <ul className="admin-list">
                {detail.data.sessions.map((session) => (
                  <li key={session.createdAt}>
                    <span>{when(session.createdAt)}</span>
                    <Status
                      value={session.active ? "active" : "archived"}
                      label={session.active ? "Active" : "Expired"}
                    />
                  </li>
                ))}
                {!detail.data.sessions.length && (
                  <li className="admin-empty">Nothing here yet.</li>
                )}
              </ul>
            </Group>
            <Group title={`Boosts (${detail.data.boosts.length})`}>
              <ul className="admin-list">
                {detail.data.boosts.map((boost) => (
                  <li key={boost.id}>
                    <span>{boost.listingTitle || boost.listingId}</span>
                    <small>
                      {boost.kind}, {when(boost.endsAt, false)}
                    </small>
                  </li>
                ))}
                {!detail.data.boosts.length && (
                  <li className="admin-empty">Nothing here yet.</li>
                )}
              </ul>
            </Group>
            <Group title="Audit trail">
              <ul className="admin-list">
                {detail.data.audit.map((entry) => (
                  <li key={entry.id}>
                    <span>{entry.action}</span>
                    <small>{when(entry.createdAt)}</small>
                  </li>
                ))}
                {!detail.data.audit.length && (
                  <li className="admin-empty">Nothing here yet.</li>
                )}
              </ul>
            </Group>
            <div className="admin-drawer-actions">
              {!row.verified && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    setPending({
                      title: "Verify this student",
                      body: `Mark ${row.email} as a verified student email. They can publish and request straight away.`,
                      label: "Verify",
                      run: () => act(row.id, "verify"),
                    })
                  }
                >
                  Verify email
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={row.isAdmin && row.id === user?.id}
                onClick={() =>
                  setPending({
                    title: row.isAdmin ? "Remove admin access" : "Grant admin access",
                    body: row.isAdmin
                      ? `${row.name} loses the dashboard immediately.`
                      : `${row.name} can see every account, listing and report.`,
                    label: row.isAdmin ? "Remove access" : "Grant access",
                    run: () => act(row.id, "admin", { on: !row.isAdmin }),
                  })
                }
              >
                {row.isAdmin ? "Remove admin" : "Make admin"}
              </Button>
              <Button
                variant={row.disabledAt ? "secondary" : "danger"}
                disabled={!row.disabledAt && row.id === user?.id}
                onClick={() =>
                  setPending({
                    title: row.disabledAt ? "Enable this account" : "Disable this account",
                    body: row.disabledAt
                      ? `${row.name} can sign in again.`
                      : `${row.name} is signed out everywhere and cannot sign in. Their listings and requests are kept.`,
                    label: row.disabledAt ? "Enable" : "Disable",
                    danger: !row.disabledAt,
                    run: () => act(row.id, row.disabledAt ? "enable" : "disable"),
                  })
                }
              >
                {row.disabledAt ? "Enable account" : "Disable account"}
              </Button>
            </div>
          </>
        )}
      </Drawer>
      <ConfirmModal pending={pending} onClose={() => setPending(null)} />
    </AdminPage>
  );
}
