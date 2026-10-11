import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage, money, useResource } from "../../lib/api";
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
  type Column,
  type Pending,
} from "./parts";
import type { ListingDetailData, ListingsPage } from "./types";

const COLUMNS: Column[] = [
  { key: "title", label: "Listing" },
  { key: "owner", label: "Owner" },
  { key: "status", label: "Status" },
  { key: "price", label: "Price", numeric: true },
  { key: "campus", label: "Campus" },
  { key: "boost", label: "Boosted until" },
  { key: "created", label: "Created" },
  { key: "updated", label: "Updated" },
];

export default function Listings() {
  const { notify, campuses } = useApp();
  /* Campus is stored as a slug. The dashboard shows the school name. */
  const campusName = (id: string) =>
    campuses.find((c) => c.id === id)?.name || id;
  /* The table is tight, so it takes the short name. */
  const campusShort = (id: string) =>
    campuses.find((c) => c.id === id)?.shortName || campusName(id);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("listing"));
  const [pending, setPending] = useState<Pending>(null);
  const search = useDebounced(query);
  const { data, error, loading, refresh } = useResource<ListingsPage>(
    `/admin/listings?page=${page}&status=${status}&query=${encodeURIComponent(search)}`,
  );
  const detail = useResource<ListingDetailData>(
    openId ? `/admin/listings/${openId}` : null,
  );

  async function act(id: string, action: string) {
    try {
      await api(`/admin/listings/${id}/${action}`, { method: "POST" });
      notify("Done. The change is saved and recorded in the audit log.");
      refresh();
      detail.refresh();
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }

  const row = detail.data?.listing;
  return (
    <AdminPage
      title="Listings"
      description="Every listing, drafts and archived places included."
    >
      <Toolbar>
        <SearchField
          value={query}
          onChange={(next) => {
            setQuery(next);
            setPage(1);
          }}
          placeholder="Search title, address, owner email or id"
        />
        <Select
          label="Status"
          value={status}
          onChange={(next) => {
            setStatus(next);
            setPage(1);
          }}
          options={[
            { value: "", label: "All statuses" },
            { value: "active", label: "Live" },
            { value: "draft", label: "Draft" },
            { value: "handed_off", label: "Handed off" },
            { value: "archived", label: "Archived" },
            { value: "boosted", label: "Boosted now" },
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
            empty={!data?.listings.length}
            emptyLabel="No listing matches those filters."
          >
            {data?.listings.map((item) => (
              <tr
                key={item.id}
                onClick={() => setOpenId(item.id)}
                className={openId === item.id ? "is-open" : ""}
              >
                <td>
                  <div className="admin-person">
                    <strong>{item.title}</strong>
                    <span>{item.address}</span>
                  </div>
                </td>
                <td>
                  <div className="admin-person">
                    <strong>{item.ownerName}</strong>
                    <span>{item.ownerEmail}</span>
                  </div>
                </td>
                <td>
                  <div className="admin-tags">
                    <Status value={item.status} />
                    {item.moderationLocked && <Status value="disabled" label="Locked" />}
                  </div>
                </td>
                <td className="num">{money(item.price)}</td>
                <td>{campusShort(item.campusId)}</td>
                <td>{item.boosted ? when(item.boostUntil, false) : ""}</td>
                <td>{when(item.createdAt, false)}</td>
                <td>{when(item.updatedAt, false)}</td>
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
        title={row?.title || "Listing"}
        subtitle={row?.address}
      >
        {detail.loading && <p className="admin-empty">Loading listing…</p>}
        {detail.error && <ErrorBox message={detail.error} retry={detail.refresh} />}
        {row && detail.data && (
          <>
            <div className="admin-drawer-actions">
              <Link className="button secondary" to={`/listings/${row.id}`}>
                Open in app
              </Link>
              {row.status === "archived" ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    setPending({
                      title: "Unarchive this listing",
                      body: "The listing returns as a draft and the moderation lock is removed. The owner decides whether to publish it again.",
                      label: "Unarchive",
                      run: () => act(row.id, "unarchive"),
                    })
                  }
                >
                  Unarchive
                </Button>
              ) : (
                <Button
                  variant="danger"
                  onClick={() =>
                    setPending({
                      title: "Archive this listing",
                      body: "The listing leaves discovery, pending requests are declined, and a moderation lock stops the owner republishing it. Nothing is deleted.",
                      label: "Archive",
                      run: () => act(row.id, "archive"),
                    })
                  }
                >
                  Archive
                </Button>
              )}
              {row.boosted && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    setPending({
                      title: "End this boost",
                      body: "The listing drops back to its normal place in browse right away.",
                      label: "End boost",
                      run: () => act(row.id, "unboost"),
                    })
                  }
                >
                  End boost
                </Button>
              )}
            </div>
            <Group title="Listing">
              <KeyValues
                items={[
                  ["Id", <code key="id">{row.id}</code>],
                  ["Status", <Status key="s" value={row.status} />],
                  ["Owner", `${row.ownerName}, ${row.ownerEmail}`],
                  ["Price", money(row.price)],
                  [
                    "Original lease",
                    row.originalPrice ? money(row.originalPrice) : "Not shared",
                  ],
                  ["Deposit", money(row.deposit)],
                  ["Room", `${row.roomType}, ${row.bedrooms} bed, ${row.bathrooms} bath`],
                  ["Available", `${row.availableFrom} to ${row.availableTo}`],
                  ["Campus", campusName(row.campusId)],
                  ["Photos", number(row.photos.length)],
                  ["Views", number(row.views)],
                  ["Requests", number(row.requests)],
                  ["Boost", row.boosted ? when(row.boostUntil) : "None"],
                  ["Moderation lock", row.moderationLocked ? "Yes" : "No"],
                  ["Created", when(row.createdAt)],
                  ["Updated", when(row.updatedAt)],
                ]}
              />
            </Group>
            {row.photos.length > 0 && (
              <Group title="Photos">
                <div className="admin-photos">
                  {row.photos.map((photo) => (
                    <img key={photo} src={photo} alt="" loading="lazy" />
                  ))}
                </div>
              </Group>
            )}
            <Group title={`Requests (${detail.data.requests.length})`}>
              <ul className="admin-list">
                {detail.data.requests.map((request) => (
                  <li key={request.id}>
                    <span>{request.requesterName}</span>
                    <Status value={request.status} />
                  </li>
                ))}
                {!detail.data.requests.length && <li className="admin-empty">None.</li>}
              </ul>
            </Group>
            <Group title={`Reports (${detail.data.reports.length})`}>
              <ul className="admin-list">
                {detail.data.reports.map((report) => (
                  <li key={report.id}>
                    <span>{report.reason}</span>
                    <Status value={report.status} />
                  </li>
                ))}
                {!detail.data.reports.length && <li className="admin-empty">None.</li>}
              </ul>
            </Group>
            <Group title={`Boosts (${detail.data.boosts.length})`}>
              <ul className="admin-list">
                {detail.data.boosts.map((boost) => (
                  <li key={boost.id}>
                    <span>{boost.kind}</span>
                    <small>{when(boost.endsAt, false)}</small>
                  </li>
                ))}
                {!detail.data.boosts.length && <li className="admin-empty">None.</li>}
              </ul>
            </Group>
          </>
        )}
      </Drawer>
      <ConfirmModal pending={pending} onClose={() => setPending(null)} />
    </AdminPage>
  );
}
