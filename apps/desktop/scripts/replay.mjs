import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { DEV_ORIGIN, replayEnvelopes } from './replay-fixture.mjs';

const fixture = JSON.parse(await fs.readFile(process.argv[2] ?? new URL('../../../tests/fixtures/casual-room-replay.json', import.meta.url), 'utf8'));
const messages = replayEnvelopes(fixture);
// The built-in WebSocket cannot set Origin. Use Node's TCP/crypto primitives
// for this small replay-only client, without another runtime dependency.
const socket = net.createConnection({ host: '127.0.0.1', port: 38917 });
let connectionError;
socket.on('error', error => { connectionError = error; });
const key = randomBytes(16).toString('base64');
await new Promise((resolve, reject) => {
  let response = '';
  socket.setTimeout(5000, () => socket.destroy(new Error('Feed handshake timed out.')));
  socket.on('error', reject);
  socket.on('connect', () => socket.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:38917\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${DEV_ORIGIN}\r\n\r\n`));
  const onData = chunk => {
    response += chunk.toString('ascii');
    if (response.length > 8192) { socket.destroy(); reject(new Error('Invalid handshake.')); return; }
    if (!response.includes('\r\n\r\n')) return;
    socket.off('data', onData);
    socket.setTimeout(0);
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    if (!response.startsWith('HTTP/1.1 101 ') || !response.toLowerCase().includes(`sec-websocket-accept: ${accept}`.toLowerCase())) {
      socket.destroy(); reject(new Error('Feed rejected the replay origin. Use a debug desktop build.')); return;
    }
    resolve();
  };
  socket.on('data', onData);
});
function sendText(text) {
  if (connectionError || socket.destroyed || socket.writableEnded) throw new Error('Feed disconnected before replay completed.');
  const payload = Buffer.from(text);
  const lengthBytes = payload.length < 126 ? 0 : payload.length <= 65535 ? 2 : 8;
  const header = Buffer.alloc(6 + lengthBytes);
  header[0] = 0x81;
  header[1] = 0x80 | (lengthBytes === 0 ? payload.length : lengthBytes === 2 ? 126 : 127);
  if (lengthBytes === 2) header.writeUInt16BE(payload.length, 2);
  if (lengthBytes === 8) header.writeBigUInt64BE(BigInt(payload.length), 2);
  const mask = randomBytes(4);
  mask.copy(header, header.length - 4);
  for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  socket.write(Buffer.concat([header, payload]));
}
for (const message of messages) {
  sendText(JSON.stringify(message));
  await delay('type' in message ? 200 : 300);
  if (message === messages.at(-2)) await delay(5000);
}
if (connectionError || socket.destroyed) throw new Error('Feed disconnected before replay completed.');
socket.end(Buffer.from([0x88, 0x80, 0, 0, 0, 0]));
console.log(`Replayed ${messages.length - 1} events and left the room.`);
