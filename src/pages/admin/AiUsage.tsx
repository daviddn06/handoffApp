import { useResource } from "../../lib/api";
import { ErrorBox } from "../../components/ui";
import {
  AdminPage,
  Bars,
  StatCard,
  TableShell,
  number,
  when,
  type Column,
} from "./parts";
import type { AiUsage as AiUsageData } from "./types";

const COLUMNS: Column[] = [
  { key: "student", label: "Student" },
  { key: "calls", label: "Calls", numeric: true },
  { key: "input", label: "Input tokens", numeric: true },
  { key: "output", label: "Output tokens", numeric: true },
  { key: "total", label: "Total", numeric: true },
  { key: "last", label: "Last used" },
];

export default function AiUsage() {
  const { data, error, loading, refresh } = useResource<AiUsageData>("/admin/ai-usage");
  if (error)
    return (
      <AdminPage title="AI usage">
        <ErrorBox message={error} retry={refresh} />
      </AdminPage>
    );
  if (data && !data.available)
    return (
      <AdminPage title="AI usage">
        <p className="admin-empty">
          Smart import has not been installed on this database, so there is nothing to
          measure yet.
        </p>
      </AdminPage>
    );
  const totals = data?.totals;
  return (
    <AdminPage
      title="AI usage"
      description="Token counts only. No prompt text and no listing content is stored."
    >
      <div className="admin-stat-grid">
        <StatCard label="Calls" value={number(totals?.calls || 0)} />
        <StatCard label="Input tokens" value={number(totals?.input_tokens || 0)} />
        <StatCard label="Output tokens" value={number(totals?.output_tokens || 0)} />
        <StatCard
          label="Total tokens"
          value={number((totals?.input_tokens || 0) + (totals?.output_tokens || 0))}
        />
      </div>
      {data?.perDay && (
        <div className="admin-bars-grid">
          <Bars points={data.perDay} label="Tokens, 30 days" tone="violet" />
        </div>
      )}
      <TableShell
        columns={COLUMNS}
        loading={loading}
        empty={!data?.perUser.length}
        emptyLabel="No student has used Smart import yet."
      >
        {data?.perUser.map((item) => (
          <tr key={item.userId}>
            <td>
              <div className="admin-person">
                <strong>{item.name || "Removed account"}</strong>
                <span>{item.email}</span>
              </div>
            </td>
            <td className="num">{number(item.calls)}</td>
            <td className="num">{number(item.inputTokens)}</td>
            <td className="num">{number(item.outputTokens)}</td>
            <td className="num">{number(item.inputTokens + item.outputTokens)}</td>
            <td>{when(item.lastUsed, false)}</td>
          </tr>
        ))}
      </TableShell>
    </AdminPage>
  );
}
