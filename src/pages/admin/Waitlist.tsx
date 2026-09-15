import { useState } from "react";
import { useResource } from "../../lib/api";
import { ErrorBox } from "../../components/ui";
import {
  AdminPage,
  Group,
  Pager,
  TableShell,
  number,
  when,
  type Column,
} from "./parts";
import type { WaitlistPage } from "./types";

const COLUMNS: Column[] = [
  { key: "email", label: "Email" },
  { key: "school", label: "School" },
  { key: "domain", label: "Domain" },
  { key: "created", label: "Joined" },
];

export default function Waitlist() {
  const [page, setPage] = useState(1);
  const { data, error, loading, refresh } = useResource<WaitlistPage>(
    `/admin/waitlist?page=${page}`,
  );
  return (
    <AdminPage
      title="Waitlist"
      description="Students asking for Handoff at a school that is not open yet."
      actions={
        <a className="button secondary" href="/api/admin/waitlist.csv">
          Download CSV
        </a>
      }
    >
      {error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : (
        <div className="admin-split-wide">
          <div>
            <TableShell
              columns={COLUMNS}
              loading={loading}
              empty={!data?.waitlist.length}
              emptyLabel="Nobody has asked yet."
            >
              {data?.waitlist.map((item) => (
                <tr key={item.id}>
                  <td>{item.email}</td>
                  <td>{item.school}</td>
                  <td>{item.domain || "Unknown"}</td>
                  <td>{when(item.createdAt, false)}</td>
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
          </div>
          <Group title="Demand by school">
            <ul className="admin-rank">
              {(data?.bySchool || []).map((item) => (
                <li key={item.school}>
                  <span>{item.school}</span>
                  <b>{number(item.count)}</b>
                </li>
              ))}
              {!data?.bySchool.length && <li className="admin-empty">No demand yet.</li>}
            </ul>
          </Group>
        </div>
      )}
    </AdminPage>
  );
}
