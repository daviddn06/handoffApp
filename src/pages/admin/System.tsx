import { useResource } from "../../lib/api";
import { ErrorBox } from "../../components/ui";
import {
  AdminPage,
  Group,
  KeyValues,
  Status,
  bytes,
  duration,
  number,
  when,
} from "./parts";
import type { SystemInfo } from "./types";

export default function System() {
  const { data, error, loading, refresh } = useResource<SystemInfo>("/admin/system");
  if (error)
    return (
      <AdminPage title="System">
        <ErrorBox message={error} retry={refresh} />
      </AdminPage>
    );
  if (loading || !data)
    return (
      <AdminPage title="System" description="Release, host, storage and the service log.">
        <p className="admin-empty">Reading the VPS…</p>
      </AdminPage>
    );
  const { app, database, host, storage, backups, services, journal } = data;
  return (
    <AdminPage
      title="System"
      description={`Release ${app.release}, read at ${new Date(data.generatedAt).toLocaleTimeString("en-US")}.`}
    >
      <div className="admin-split">
        <Group title="Application">
          <KeyValues
            items={[
              ["Release", <code key="r">{app.release}</code>],
              ["Environment", app.environment],
              ["Node", app.nodeVersion],
              ["Process id", number(app.pid)],
              ["Process uptime", duration(app.uptimeSeconds)],
              ["Resident memory", bytes(app.memory.rss)],
              ["Heap used", `${bytes(app.memory.heapUsed)} of ${bytes(app.memory.heapTotal)}`],
              ["Data directory", <code key="d">{app.dataDir}</code>],
              ["Static directory", <code key="s">{app.staticDir}</code>],
              ["Origin", services.origin || "Default"],
            ]}
          />
        </Group>
        <Group title="Database">
          <KeyValues
            items={[
              ["Schema version", number(database.schemaVersion)],
              ["File", <code key="f">{database.file}</code>],
              ["Size", bytes(database.bytes)],
              ["WAL size", bytes(database.walBytes)],
              ["Journal mode", database.journalMode],
              ["Page size", number(database.pageSize)],
              ["Tables", number(database.tables)],
            ]}
          />
        </Group>
        <Group title="Host">
          <KeyValues
            items={[
              ["Hostname", host.hostname],
              ["Platform", `${host.platform} ${host.arch}`],
              ["Host uptime", duration(host.osUptimeSeconds)],
              ["Load average", host.loadAverage.join(", ")],
              ["Memory", `${bytes(host.totalMemory - host.freeMemory)} used of ${bytes(host.totalMemory)}`],
              ["Free memory", bytes(host.freeMemory)],
              ["CPUs", `${number(host.cpus)}, ${host.cpuModel}`],
            ]}
          />
        </Group>
        <Group title="Storage">
          <KeyValues
            items={[
              [
                "Uploads",
                `${bytes(storage.uploads.bytes)}, ${number(storage.uploads.files)} files`,
              ],
              [
                "Logo cache",
                `${bytes(storage.logos.bytes)}, ${number(storage.logos.files)} files`,
              ],
              [
                "Disk",
                storage.disk.available
                  ? `${bytes(storage.disk.usedBytes || 0)} used of ${bytes(storage.disk.totalBytes || 0)} (${storage.disk.usedPercent}%), ${bytes(storage.disk.freeBytes || 0)} free`
                  : "df is unavailable here",
              ],
              ["Filesystem", storage.disk.filesystem || "Unknown"],
            ]}
          />
        </Group>
        <Group title="Services">
          <KeyValues
            items={[
              [
                "Email",
                <Status
                  key="m"
                  value={services.mailConfigured ? "yes" : "no"}
                  label={services.mailConfigured ? "Configured" : "Not configured"}
                />,
              ],
              [
                "AI",
                <Status
                  key="a"
                  value={services.aiConfigured ? "yes" : "no"}
                  label={services.aiConfigured ? "Configured" : "Not configured"}
                />,
              ],
            ]}
          />
        </Group>
        <Group title="Backups">
          {backups.available ? (
            <ul className="admin-list">
              {backups.entries.map((entry) => (
                <li key={entry.name}>
                  <span>{entry.name}</span>
                  <small>
                    {bytes(entry.bytes)}, {when(entry.modifiedAt, false)}
                  </small>
                </li>
              ))}
              {!backups.entries.length && <li className="admin-empty">Empty.</li>}
            </ul>
          ) : (
            <p className="admin-empty">
              No backup directory readable at {backups.path}.
            </p>
          )}
        </Group>
      </div>
      <Group title="Service journal">
        {journal.available ? (
          <pre className="admin-journal">{journal.lines.join("\n")}</pre>
        ) : (
          <p className="admin-empty">
            journalctl is not readable from here. On the VPS run
            <code> journalctl -u handoff -n 50 --no-pager</code>.
          </p>
        )}
      </Group>
    </AdminPage>
  );
}
