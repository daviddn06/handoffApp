import { useState } from "react";
import { api, errorMessage, useResource } from "../../lib/api";
import { useApp } from "../../lib/context";
import { Button, ErrorBox } from "../../components/ui";
import {
  AdminPage,
  ConfirmModal,
  Pager,
  Select,
  Status,
  TableShell,
  Toolbar,
  when,
  type Column,
  type Pending,
} from "./parts";
import type { ReportsPage } from "./types";

const COLUMNS: Column[] = [
  { key: "listing", label: "Listing" },
  { key: "reporter", label: "Reporter" },
  { key: "reason", label: "Reason" },
  { key: "details", label: "Details" },
  { key: "status", label: "Status" },
  { key: "created", label: "Reported" },
  { key: "action", label: "" },
];

export default function Reports() {
  const { notify } = useApp();
  const [status, setStatus] = useState("open");
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<Pending>(null);
  const { data, error, loading, refresh } = useResource<ReportsPage>(
    `/admin/reports?page=${page}&status=${status}`,
  );
  async function resolve(id: string) {
    try {
      await api(`/admin/reports/${id}/resolve`, { method: "POST" });
      notify("Report marked resolved and recorded in the audit log.");
      refresh();
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }
  return (
    <AdminPage
      title="Reports"
      description="Student reports on listings. Archive the listing first when it needs it."
    >
      <Toolbar>
        <Select
          label="Status"
          value={status}
          onChange={(next) => {
            setStatus(next);
            setPage(1);
          }}
          options={[
            { value: "open", label: "Open" },
            { value: "resolved", label: "Resolved" },
            { value: "", label: "All" },
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
            empty={!data?.reports.length}
            emptyLabel="No report to review."
          >
            {data?.reports.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className="admin-person">
                    <strong>{item.listingTitle}</strong>
                    <span>{item.listingStatus}</span>
                  </div>
                </td>
                <td>
                  <div className="admin-person">
                    <strong>{item.reporterName}</strong>
                    <span>{item.reporterEmail}</span>
                  </div>
                </td>
                <td>{item.reason}</td>
                <td className="admin-clip">{item.details}</td>
                <td>
                  <Status value={item.status} />
                </td>
                <td>{when(item.createdAt, false)}</td>
                <td>
                  {item.status === "open" && (
                    <Button
                      variant="secondary"
                      className="small"
                      onClick={() =>
                        setPending({
                          title: "Resolve this report",
                          body: "Mark the report reviewed. The listing is untouched, archive it separately if it needs that.",
                          label: "Resolve",
                          run: () => resolve(item.id),
                        })
                      }
                    >
                      Resolve
                    </Button>
                  )}
                </td>
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
      <ConfirmModal pending={pending} onClose={() => setPending(null)} />
    </AdminPage>
  );
}
