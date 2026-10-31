import { RoomEventState } from '@umalytics/core/room/roomEvents';
import type { DraftSnapshot, DraftUmaAction } from '@umalytics/shared';
import { normalizeUmaOutfitId } from '@umalytics/core/umas/umaPortraits';

export type FeedEnvelope = { v: 1; type: 'left' } | { v: 1; roomCode: string; event: unknown };
export type FeedStatus = {
  state: 'listening' | 'connected' | 'disconnected' | 'port-in-use' | 'error';
  accepted: number;
  rejected: number;
};

export class DesktopRoom {
  state = new RoomEventState();
  pickOrder?: DraftUmaAction[];
  lastState?: RoomEventState;
  lastPickOrder?: DraftUmaAction[];

  apply(message: FeedEnvelope): void {
    if ('type' in message) {
      if (this.state.matchCode) { this.lastState = this.state; this.lastPickOrder = this.pickOrder; }
      this.state = new RoomEventState(); this.pickOrder = undefined;
    }
    else {
      const result = this.state.apply(message.event, message.roomCode);
      if (result.reason === 'match-snapshot') this.pickOrder = snapshotPickOrder(message.event, this.state.draft);
      else if (!this.state.draft) this.pickOrder = undefined;
    }
  }
}

// Per-team slot numbers are not global history. Only an explicit, complete
// sequence in the received snapshot can establish the pick-order strip.
export function snapshotPickOrder(event: unknown, draft?: DraftSnapshot): DraftUmaAction[] | undefined {
  const history = (event as { state?: { draftActionHistory?: unknown } } | null)?.state?.draftActionHistory;
  if (!draft || !Array.isArray(history)) return undefined;
  const available = Object.values(draft.teams).flatMap(team => team.umas.filter(uma => uma.kind === 'pick' || uma.kind === 'veto'));
  const picks: DraftUmaAction[] = [];
  for (const entry of history) {
    if (entry?.action !== 'uma-pick') continue;
    const id = normalizeUmaOutfitId(String(entry.uma?.id));
    const found = available.find(uma => uma.team === entry.actorTeam && uma.umaId === id);
    if (!found || picks.includes(found)) return undefined;
    picks.push(found);
  }
  return picks.length > 0 && picks.length === available.length ? picks : undefined;
}

export function feedDiagnostics(status?: FeedStatus): string {
  const states = ['listening', 'connected', 'disconnected', 'port-in-use', 'error'];
  const count = (value?: number) => Number.isSafeInteger(value) && value! >= 0 ? value : 0;
  return JSON.stringify({ app: 'UmaLytics', listener: '127.0.0.1:38917',
    state: status && states.includes(status.state) ? status.state : 'starting',
    accepted: count(status?.accepted), rejected: count(status?.rejected) }, null, 2);
}
