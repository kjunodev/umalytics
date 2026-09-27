import { fetchTeamIconMap } from '../profiles/esportsTeamApi';
import { getTeamIconSnapshot, isTeamIconSnapshotFresh, setTeamIconSnapshot } from '../storage/teamIconStorage';

let writes = Promise.resolve();
let activeRequest: AbortController | undefined;

// Cosmetic, background-priority data: never blocks lobby loading, and any
// failure keeps the previous cache (or shows no icons) rather than an error
// state. Callers (roster detection, the scout window opening, and an
// opportunistic startup check) all just ask for a refresh; the 24h cache
// decides whether that turns into a real fetch, so calling this often is
// cheap and never bypasses the TTL. There is no separate scheduled refresh:
// an idle install that nobody opens never re-fetches the league.
export function queueTeamIconRefresh(): Promise<void> {
  const update = writes.then(async () => {
    const snapshot = await getTeamIconSnapshot();
    if (isTeamIconSnapshotFresh(snapshot, Date.now())) return;
    activeRequest?.abort();
    const controller = new AbortController();
    activeRequest = controller;
    try {
      const map = await fetchTeamIconMap(controller.signal);
      await setTeamIconSnapshot({ map, fetchedAt: Date.now() });
    } catch {
      // Keep whatever was cached before; never surface a team-icon error to the lobby.
    } finally {
      if (activeRequest === controller) activeRequest = undefined;
    }
  });
  writes = update.catch(() => {});
  return update;
}
