import type { NextApiRequest, NextApiResponse } from 'next';

type Client = {
  room: string;
  enqueue: (msg: string) => void;
  close: () => void;
};

type RoomState = {
  clients: Set<Client>;
  hostId?: string;
  lastPlayback?: { state: 'play' | 'pause' | 'seek'; time: number };
  members: Map<string, string>; // sender -> name
};

declare global {
  // eslint-disable-next-line no-var
  var __WATCHPARTY_CHANNEL__: {
    rooms: Map<string, RoomState>;
  } | undefined;
}

function getChannel() {
  if (!global.__WATCHPARTY_CHANNEL__) {
    global.__WATCHPARTY_CHANNEL__ = {
      rooms: new Map<string, RoomState>(),
    };
  }
  return global.__WATCHPARTY_CHANNEL__;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const room: string = body.room || 'default';
      const event = {
        type: body.type,
        payload: body.payload,
        sender: body.sender,
        ts: Date.now(),
      };

      const channel = getChannel();
      if (!channel.rooms.has(room)) channel.rooms.set(room, { clients: new Set<Client>(), members: new Map<string, string>() });
      const state = channel.rooms.get(room)!;

      // 主机选择与成员记录
      if (event.type === 'presence' && event.payload?.action === 'join') {
        const isHost = Boolean(event.payload?.isHost);
        if (!state.hostId || isHost) {
          state.hostId = event.sender;
        }
        const name = typeof event.payload?.name === 'string' ? event.payload?.name : undefined;
        if (name) state.members.set(event.sender, name);
      }
      if (event.type === 'presence' && event.payload?.action === 'leave') {
        state.members.delete(event.sender);
      }

      // 仅记录主机的最后播放状态
      if (event.type === 'playback' && state.hostId && event.sender === state.hostId) {
        const p = event.payload || {};
        const time = typeof p.time === 'number' ? p.time : 0;
        const validStates = new Set(['play', 'pause', 'seek']);
        const stateStr = validStates.has(p.state) ? p.state : 'seek';
        state.lastPlayback = { state: stateStr as 'play' | 'pause' | 'seek', time };
      }

      // 广播给所有 SSE 客户端
      for (const c of state.clients) {
        try {
          c.enqueue(JSON.stringify(event));
        } catch {}
      }
      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({ ok: true, message: 'watchparty emit endpoint (POST to broadcast events)' });
    return;
  }
  if (req.method === 'HEAD') {
    res.status(200).end();
    return;
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET,HEAD,OPTIONS,POST');
    res.status(204).end();
    return;
  }

  res.setHeader('Allow', 'GET,HEAD,OPTIONS,POST');
  res.status(405).end('Method Not Allowed');
}