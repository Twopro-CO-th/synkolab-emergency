import { log } from './logger';

let ws: WebSocket | null = null;
let onMessage: ((data: any) => void) | null = null;

export function setOnMessage(fn: (data: any) => void) {
  onMessage = fn;
}

export function getWs() { return ws; }

export function connectWs(token: string, clientType?: string, deviceId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws) { ws.close(); ws = null; }

    ws = new WebSocket('ws://localhost:4000/ws');

    ws.onopen = () => {
      log.sys('WebSocket connected');
      updateStatus(true);

      const authMsg: any = { type: 'auth', token };
      if (clientType === 'device' && deviceId) {
        authMsg.clientType = 'device';
        authMsg.deviceId = deviceId;
      }
      ws!.send(JSON.stringify(authMsg));
      log.send(`auth (${clientType || 'user'})`);
    };

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      log.recv(`${data.type}: ${JSON.stringify(data)}`);

      if (data.type === 'auth_ok') {
        log.sys(`Authenticated as: ${data.id}`);
        resolve();
      } else if (data.type === 'auth_error') {
        log.err(`Auth failed: ${data.reason}`);
        reject(new Error(data.reason));
      }

      if (onMessage) onMessage(data);
    };

    ws.onclose = (e) => {
      log.sys(`WebSocket closed: ${e.code} ${e.reason}`);
      updateStatus(false);
      ws = null;
    };

    ws.onerror = () => {
      log.err('WebSocket error');
      updateStatus(false);
    };
  });
}

export function disconnectWs() {
  if (ws) { ws.close(); ws = null; }
}

export function wsSend(msg: any) {
  if (!ws || ws.readyState !== 1) {
    log.err('WebSocket not connected');
    return;
  }
  ws.send(JSON.stringify(msg));
  log.send(`${msg.type}: ${JSON.stringify(msg)}`);
}

function updateStatus(online: boolean) {
  const el = document.getElementById('ws-status')!;
  el.textContent = online ? 'Connected' : 'Disconnected';
  el.className = `status ${online ? 'online' : 'offline'}`;
}
