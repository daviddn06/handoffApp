import { useState } from "react";
import { useResource } from "../../lib/api";
import { ErrorBox } from "../../components/ui";
import { AdminPage, Pager, TableShell, when, type Column } from "./parts";
import type { AuditPage } from "./types";

const COLUMNS: Column[] = [
  { key: "when", label: "When" },
  { key: "admin", label: "Admin" },
  { key: "action", label: "Action" },
  { key: "target", label: "Target" },
  { key: "details", label: "Details" },
];

export default function Audit() {
  const [page, setPage] = useState(1);
  const { data, error, loading, refresh } = useResource<AuditPage>(
    `/admin/audit?page=${page}`,
  );
  return (
    <AdminPage
      title="Audit"
      description="Every admin write, oldest kept forever."
    >
      {error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : (
        <>
          <TableShell
            columns={COLUMNS}
            loading={loading}
            empty={!data?.audit.length}
            emptyLabel="No admin action recorded yet."
          >
            {data?.audit.map((item) => (
              <tr key={item.id}>
                <td>{when(item.createdAt)}</td>
                <td>
                  <div className="admin-person">
                    <strong>{item.adminName || "Removed account"}</strong>
                    <span>{item.adminEmail}</span>
                  </div>
                </td>
                <td>
                  <code>{item.action}</code>
                </td>
                <td>
                  <div className="admin-person">
                    <strong>{item.targetType}</strong>
                    <span>{item.targetId}</span>
                  </div>
                </td>
                <td className="admin-clip">{item.details}</td>
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
    </AdminPage>
  );
}
