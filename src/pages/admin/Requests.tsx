import { useState } from "react";
import { useResource } from "../../lib/api";
import { ErrorBox } from "../../components/ui";
import {
  AdminPage,
  Pager,
  Select,
  Status,
  TableShell,
  Toolbar,
  when,
  type Column,
} from "./parts";
import type { RequestsPage } from "./types";

const COLUMNS: Column[] = [
  { key: "listing", label: "Listing" },
  { key: "requester", label: "Requester" },
  { key: "owner", label: "Owner" },
  { key: "status", label: "Status" },
  { key: "message", label: "Message" },
  { key: "created", label: "Sent" },
  { key: "updated", label: "Updated" },
];

export default function Requests() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading, refresh } = useResource<RequestsPage>(
    `/admin/requests?page=${page}&status=${status}`,
  );
  return (
    <AdminPage title="Requests" description="Every handoff request in both directions.">
      <Toolbar>
        <Select
          label="Status"
          value={status}
          onChange={(next) => {
            setStatus(next);
            setPage(1);
          }}
          options={[
            { value: "", label: "All statuses" },
            { value: "pending", label: "Pending" },
            { value: "accepted", label: "Accepted" },
            { value: "declined", label: "Declined" },
            { value: "withdrawn", label: "Withdrawn" },
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
            empty={!data?.requests.length}
            emptyLabel="No request matches that filter."
          >
            {data?.requests.map((item) => (
              <tr key={item.id}>
                <td>{item.listingTitle}</td>
                <td>{item.requesterName}</td>
                <td>{item.ownerName}</td>
                <td>
                  <Status value={item.status} />
                </td>
                <td className="admin-clip">{item.message}</td>
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
    </AdminPage>
  );
}
