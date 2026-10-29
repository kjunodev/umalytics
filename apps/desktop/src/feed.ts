import { RoomEventState } from '@umalytics/core/room/roomEvents';

export type FeedEnvelope = { v: 1; type: 'left' } | { v: 1; roomCode: string; event: unknown };
export type FeedStatus = {
  state: 'listening' | 'connected' | 'disconnected' | 'port-in-use' | 'error';
  accepted: number;
  rejected: number;
};

export class DesktopRoom {
  state = new RoomEventState();

  apply(message: FeedEnvelope): void {
    if ('type' in message) this.state = new RoomEventState();
    else this.state.apply(message.event, message.roomCode);
  }
}
