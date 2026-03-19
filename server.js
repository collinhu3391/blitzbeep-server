/**
 * Blitzbeep Multiplayer Relay Server
 *
 * Plain WebSocket server. Every client connects and sends JSON messages
 * tagged with { room, from, type, ... }. The server relays each message
 * to every OTHER client in the same room. No game logic lives here — the
 * clients handle everything; this is a pure message bus.
 *
 * Protocol overview:
 *   Client → Server: { room, from, type, ...payload }
 *   Server → Client: same object, delivered to all other room members
 *
 * Special server-side messages (not relayed, just handled):
 *   { type: 'ping' }  → server replies { type: 'pong' }
 */

const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 8080;

// rooms: Map<roomCode, Set<WebSocket>>
const rooms = new Map();

function getRoomOf(ws) {
  for (const [code, members] of rooms) {
    if (members.has(ws)) return { code, members };
  }
  return null;
}

function joinRoom(ws, code) {
  if (!rooms.has(code)) rooms.set(code, new Set());
  rooms.get(code).add(ws);
}

function leaveRoom(ws) {
  const entry = getRoomOf(ws);
  if (!entry) return;
  entry.members.delete(ws);
  if (entry.members.size === 0) rooms.delete(entry.code);
}

function relay(sender, msg) {
  const entry = getRoomOf(sender);
  if (!entry) return;
  const raw = JSON.stringify(msg);
  for (const client of entry.members) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(raw);
    }
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', ws => {
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Heartbeat ping — reply and done, don't relay
    if (msg.type === 'ping') {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    // First message must include a room code — use it to join
    if (msg.room && !getRoomOf(ws)) {
      joinRoom(ws, msg.room);
    }

    // Relay to all other room members
    relay(ws, msg);
  });

  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => { try { ws.terminate(); } catch {} leaveRoom(ws); });
});

// Heartbeat: drop dead connections every 30 s to free up room slots
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

wss.on('close', () => clearInterval(heartbeat));

console.log(`Blitzbeep relay server listening on port ${PORT}`);
