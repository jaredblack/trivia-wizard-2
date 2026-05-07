import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, Link } from "react-router-dom";
import type { AuthOutletContext } from "../../ProtectedRoute";
import Button from "../../components/ui/Button";
import Header from "../../components/layout/Header";
import {
  listEvents,
  mintEvent,
  type EventSummary,
} from "../../services/eventsApi";

export default function EventList() {
  const { signOut } = useOutletContext<AuthOutletContext>();
  const navigate = useNavigate();
  const [rows, setRows] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await listEvents();
        if (cancelled) return;
        setRows(loaded);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleNewEvent = async () => {
    setCreating(true);
    try {
      const uuid = await mintEvent();
      navigate(`/host/events/${uuid}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header onLogOut={signOut} />
      <main className="flex-1 flex flex-col gap-6 p-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Events</h1>
          <Button
            variant="primary"
            onClick={handleNewEvent}
            disabled={creating}
          >
            {creating ? "Creating…" : "New event"}
          </Button>
        </div>

        {error && (
          <div className="text-red-600 bg-red-50 border border-red-200 rounded p-3">
            {error}
          </div>
        )}

        {rows === null && !error && (
          <p className="text-gray-600">Loading…</p>
        )}

        {rows && rows.length === 0 && (
          <p className="text-gray-600">
            No events yet. Click "New event" to create one.
          </p>
        )}

        {rows && rows.length > 0 && (
          <ul className="divide-y border rounded">
            {rows.map((row) => (
              <li
                key={row.uuid}
                className="flex items-center justify-between p-4 gap-4"
              >
                <div className="flex flex-col">
                  <span className="font-medium">
                    {row.title}
                    {row.subtitle && (
                      <span className="text-gray-500 font-normal">
                        {" — "}
                        {row.subtitle}
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-gray-500">
                    {row.uuid} · {row.lastModified.toLocaleString()}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Link
                    to={`/host/events/${row.uuid}`}
                    className="px-3 py-1 bg-white text-black border border-gray-400 hover:bg-gray-100 rounded"
                  >
                    Edit
                  </Link>
                  <a
                    href={`/present/${row.uuid}`}
                    target="_blank"
                    rel="noopener"
                    className="px-3 py-1 bg-black text-white hover:bg-gray-800 rounded"
                  >
                    Present
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
