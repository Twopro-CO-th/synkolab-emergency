import { log } from './logger';
import { panels } from './panels';
import { connectWs, disconnectWs, wsSend, setOnMessage } from './ws';
import * as api from './api';

// ---- State ----
let currentCallId: string | null = null;
let currentRoomName: string | null = null;
let livekitRoom: any = null;
let historyPage = 1;

// ---- Panel Navigation ----
const mainEl = document.getElementById('main')!;

function showPanel(name: string) {
  mainEl.innerHTML = panels[name] || '<div class="panel"><h2>Not found</h2></div>';
  document.querySelectorAll('.sidebar button').forEach(b => b.classList.remove('active'));
  document.querySelector(`.sidebar button[data-panel="${name}"]`)?.classList.add('active');
  bindPanel(name);
}

document.querySelectorAll('.sidebar button[data-panel]').forEach(btn => {
  btn.addEventListener('click', () => showPanel((btn as HTMLElement).dataset.panel!));
});

// ---- Incoming Call Handler ----
let incomingCallId: string | null = null;

setOnMessage((data: any) => {
  if (data.type === 'incoming_call') {
    incomingCallId = data.callId;
    const popup = document.getElementById('incoming-popup')!;
    document.getElementById('incoming-info')!.innerHTML =
      `<b>${data.callerName || data.callerId}</b> is calling...<br>` +
      `Type: <span class="badge badge-${data.callType}">${data.callType}</span><br>` +
      `Room: ${data.roomName}`;
    popup.classList.add('show');
  }

  if (data.type === 'broadcast_start') {
    log.sys(`📢 Broadcast from ${data.from} — room: ${data.roomName}`);
    // Auto-join as listener
    joinBroadcastAsListener(data.callId, data.roomName, data.from, data.livekitUrl);
  }

  if (data.type === 'call_accepted') {
    log.sys(`✅ Call accepted by ${data.answererId}`);
    showActiveCall(currentCallId!, currentRoomName!);
    // Caller auto-join LiveKit when callee accepts
    if (currentRoomName) {
      joinLiveKitRoom(currentRoomName, 'publisher');
    }
  }

  if (data.type === 'call_rejected') {
    log.sys('❌ Call rejected');
    currentCallId = null;
  }

  if (data.type === 'call_ended') {
    log.sys(`📴 Call ended: ${data.reason}`);
    currentCallId = null;
    hideActiveCall();
    leaveLiveKit();
    document.getElementById('incoming-popup')?.classList.remove('show');
  }

  if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice-candidate') {
    log.info(`📡 Signal ${data.type} from ${data.fromId}`);
  }

  // Update online count in header
  updateOnlineCount();
});

// Accept / Reject incoming
document.getElementById('btn-accept')!.addEventListener('click', async () => {
  if (!incomingCallId) return;
  const res = await api.callRespond({ callId: incomingCallId, action: 'accept' });
  log.recv(JSON.stringify(res));
  currentCallId = incomingCallId;
  currentRoomName = res.roomName;
  incomingCallId = null;
  document.getElementById('incoming-popup')!.classList.remove('show');
  showActiveCall(currentCallId!, currentRoomName!);

  // Auto-join LiveKit after accepting
  if (res.mediaMode === 'sfu') {
    await joinLiveKitRoom(res.roomName, 'publisher');
  }
});

document.getElementById('btn-reject')!.addEventListener('click', async () => {
  if (!incomingCallId) return;
  await api.callRespond({ callId: incomingCallId, action: 'reject' });
  incomingCallId = null;
  document.getElementById('incoming-popup')!.classList.remove('show');
});

// ---- Call Bar (bottom bar showing active call status) ----
let currentCallType: string = 'normal';

function showCallBar(type: string, info: string, role: string) {
  currentCallType = type;
  const bar = document.getElementById('call-bar')!;
  bar.className = type === 'broadcast' ? 'active broadcast' :
                  type === 'emergency' ? 'active emergency' : 'active';

  const labels: Record<string, string> = {
    normal: '📞 ACTIVE CALL',
    emergency: '🚨 EMERGENCY SOS',
    broadcast: role === 'publisher' ? '📢 BROADCASTING' : '📢 LISTENING TO BROADCAST',
  };
  document.getElementById('call-bar-label')!.textContent = labels[type] || 'ACTIVE CALL';
  document.getElementById('call-bar-info')!.textContent = info;
}

function hideCallBar() {
  document.getElementById('call-bar')!.className = '';
  document.getElementById('call-bar-meter')!.style.width = '0%';
}

// End call from bar
document.getElementById('btn-call-bar-end')!.addEventListener('click', async () => {
  if (currentCallId) {
    await api.callEnd({ callId: currentCallId });
    currentCallId = null;
  }
  await leaveLiveKit();
  hideCallBar();
  hideActiveCall();
});

// ---- Join LiveKit as publisher (caller) or listener (receiver) ----
async function joinLiveKitRoom(roomName: string, role: 'publisher' | 'listener') {
  try {
    const canPublish = role === 'publisher';
    const tokenRes = await api.livekitToken(roomName, canPublish);
    if (!tokenRes.token) { log.err('Failed to get LiveKit token'); return; }

    const { Room, RoomEvent } = await import('livekit-client');

    if (livekitRoom) { livekitRoom.disconnect(); livekitRoom = null; }

    livekitRoom = new Room({ rtcConfig: { iceTransportPolicy: 'relay' } } as any);

    livekitRoom.on(RoomEvent.TrackSubscribed, (track: any, _pub: any, participant: any) => {
      if (track.kind === 'audio') {
        const audioEl = track.attach();
        audioEl.style.display = 'none';
        const container = document.getElementById('remote-audio-container')
          || document.getElementById('lk-remote-audio');
        (container || document.body).appendChild(audioEl);
        log.sys(`🔊 Playing audio from ${participant.identity}`);

        // Update call bar info
        const barInfo = document.getElementById('call-bar-info');
        if (barInfo) barInfo.textContent = `Room: ${roomName} | Talking with: ${participant.identity}`;
      }
    });

    livekitRoom.on(RoomEvent.TrackUnsubscribed, (track: any) => {
      track.detach().forEach((el: HTMLElement) => el.remove());
    });

    livekitRoom.on(RoomEvent.ActiveSpeakersChanged, (speakers: any[]) => {
      let localLevel = 0;
      let remoteLevel = 0;
      for (const s of speakers) {
        const lvl = Math.min(100, (s as any).audioLevel * 300);
        if (s === livekitRoom?.localParticipant) localLevel = lvl;
        else remoteLevel = Math.max(remoteLevel, lvl);
      }

      // Update call bar meter
      const barMeter = document.getElementById('call-bar-meter') as HTMLElement;
      if (barMeter) barMeter.style.width = `${Math.max(localLevel, remoteLevel)}%`;

      // Update Normal Call panel meters
      const localMeter = document.getElementById('call-meter-local') as HTMLElement;
      const remoteMeter = document.getElementById('call-meter-remote') as HTMLElement;
      if (localMeter) localMeter.style.width = `${localLevel}%`;
      if (remoteMeter) remoteMeter.style.width = `${remoteLevel}%`;
    });

    livekitRoom.on(RoomEvent.ParticipantConnected, (p: any) => {
      log.info(`${p.identity} joined the room`);
      updateCallParticipants();
    });

    livekitRoom.on(RoomEvent.ParticipantDisconnected, (p: any) => {
      log.info(`${p.identity} left the room`);
      updateCallParticipants();
    });

    livekitRoom.on(RoomEvent.Disconnected, () => {
      log.sys('LiveKit: disconnected');
      livekitRoom = null;
      hideCallBar();
    });

    await livekitRoom.connect(tokenRes.url, tokenRes.token);
    log.sys(`LiveKit: joined ${roomName} as ${role}`);

    if (canPublish) {
      await livekitRoom.localParticipant.setMicrophoneEnabled(true);
      log.sys('🎤 Microphone published');
    }

    // Show call bar
    const roleLabel = canPublish ? '🎤 mic on' : '🔊 listening';
    showCallBar(currentCallType, `Room: ${roomName} | ${roleLabel}`, role);
    updateCallParticipants();

  } catch (e: any) {
    log.err(`LiveKit join error: ${e.message}`);
  }
}

function updateCallParticipants() {
  const el = document.getElementById('call-participants');
  if (!el || !livekitRoom) return;
  const parts = [livekitRoom.localParticipant, ...livekitRoom.remoteParticipants.values()];
  el.innerHTML = parts.map((p: any) =>
    `<span style="margin-right:12px">${p === livekitRoom?.localParticipant ? '👤' : '🗣️'} ` +
    `<b>${p.identity}</b> ${p.isMicrophoneEnabled ? '🎤' : '🔇'}</span>`
  ).join('');

  // Update call bar info with participant names
  const barInfo = document.getElementById('call-bar-info');
  if (barInfo) {
    const others = parts.filter((p: any) => p !== livekitRoom?.localParticipant).map((p: any) => p.identity);
    barInfo.textContent = others.length > 0
      ? `Talking with: ${others.join(', ')}`
      : 'Waiting for others to join...';
  }
}

async function joinBroadcastAsListener(callId: string, roomName: string, from: string, _livekitUrl?: string) {
  currentCallId = callId;
  currentRoomName = roomName;
  currentCallType = 'broadcast';
  log.info(`Auto-joining broadcast from ${from} as listener...`);
  await joinLiveKitRoom(roomName, 'listener');
}

async function leaveLiveKit() {
  if (livekitRoom) {
    livekitRoom.disconnect();
    livekitRoom = null;
    log.sys('LiveKit: left room');
  }
  hideCallBar();
}

// ---- Active Call UI ----
function showActiveCall(callId: string, roomName: string) {
  const panel = document.getElementById('active-call-panel');
  if (!panel) return;
  panel.style.display = 'block';
  panel.classList.add('call-active');
  document.getElementById('active-call-info')!.innerHTML =
    `<span style="color:#22c55e;font-weight:600">● Connected</span><br>` +
    `Call ID: <code>${callId}</code><br>Room: <code>${roomName}</code>`;

  // Reset status text and button
  const statusEl = document.getElementById('call-status');
  if (statusEl) statusEl.innerHTML = '';
  const callBtn = document.getElementById('btn-call-normal') as HTMLButtonElement;
  if (callBtn) callBtn.disabled = true;

  // Reset mute button
  const muteBtn = document.getElementById('btn-toggle-mute');
  if (muteBtn) { muteBtn.textContent = '🔇 Mute'; muteBtn.className = 'btn btn-warn'; }
}

function hideActiveCall() {
  const panel = document.getElementById('active-call-panel');
  if (panel) { panel.style.display = 'none'; panel.classList.remove('call-active'); }
  const callBtn = document.getElementById('btn-call-normal') as HTMLButtonElement;
  if (callBtn) callBtn.disabled = false;
}

// ---- Online Count ----
async function updateOnlineCount() {
  try {
    const data = await api.onlineCount();
    document.getElementById('online-count')!.textContent =
      `👥 ${data.users || 0} users, 📱 ${data.devices || 0} devices`;
  } catch { /* ignore */ }
}

// ---- Bind Panel Events ----
function bindPanel(name: string) {
  switch (name) {
    case 'connect': {
      const savedKey = api.getApiKey();
      if (savedKey) (document.getElementById('inp-api-key') as HTMLInputElement).value = savedKey;

      document.getElementById('btn-connect')!.addEventListener('click', async () => {
        const key = (document.getElementById('inp-api-key') as HTMLInputElement).value;
        const userId = (document.getElementById('inp-user-id') as HTMLInputElement).value;
        const userName = (document.getElementById('inp-user-name') as HTMLInputElement).value;

        api.setApiKey(key);

        try {
          // Get JWT from server via API key
          log.send(`POST /auth/token for ${userId}`);
          const tokenRes = await api.issueToken(userId, 'admin', userName);
          if (tokenRes.error) {
            log.err(`Token error: ${tokenRes.error}`);
            return;
          }
          log.recv(`JWT received: ${tokenRes.token.substring(0, 30)}...`);

          await connectWs(tokenRes.token);
          updateOnlineCount();
        } catch (e: any) {
          log.err(`Connect failed: ${e.message}`);
        }
      });

      document.getElementById('btn-disconnect')!.addEventListener('click', () => disconnectWs());

      document.getElementById('btn-online-count')!.addEventListener('click', async () => {
        const data = await api.onlineCount();
        document.getElementById('online-info')!.innerHTML =
          `Users: <b>${data.users}</b> | Devices: <b>${data.devices}</b> | Total: <b>${data.total}</b>`;
        log.recv(JSON.stringify(data));
      });
      break;
    }

    case 'call-normal': {
      const statusEl = () => document.getElementById('call-status')!;

      document.getElementById('btn-call-normal')!.addEventListener('click', async () => {
        const calleeId = (document.getElementById('inp-callee-id') as HTMLInputElement).value;
        const calleeType = (document.getElementById('sel-callee-type') as HTMLSelectElement).value;
        if (!calleeId) { log.err('Callee ID required'); return; }

        const res = await api.callInitiate({ calleeId, type: 'normal', calleeType });
        log.recv(JSON.stringify(res));
        if (res.callId) {
          currentCallId = res.callId;
          currentRoomName = res.roomName;
          currentCallType = 'normal';
          statusEl().innerHTML = `⏳ Calling <b>${calleeId}</b>... waiting to accept<br>` +
            `<span style="font-size:11px;color:#64748b">Call ID: ${res.callId} | Mode: ${res.mediaMode}</span>`;
          (document.getElementById('btn-call-normal') as HTMLButtonElement).disabled = true;
        }
      });

      document.getElementById('btn-end-call')!.addEventListener('click', async () => {
        if (!currentCallId) return log.err('No active call');
        await api.callEnd({ callId: currentCallId });
        currentCallId = null;
        currentRoomName = null;
        await leaveLiveKit();
        hideActiveCall();
        hideCallBar();
        statusEl().textContent = '';
        (document.getElementById('btn-call-normal') as HTMLButtonElement).disabled = false;
      });

      document.getElementById('btn-toggle-mute')!.addEventListener('click', async () => {
        if (!livekitRoom) { log.err('Not in a LiveKit room'); return; }
        const lp = livekitRoom.localParticipant;
        const isMuted = lp.isMicrophoneEnabled;
        await lp.setMicrophoneEnabled(!isMuted);
        const btn = document.getElementById('btn-toggle-mute')!;
        btn.textContent = isMuted ? '🎤 Unmute' : '🔇 Mute';
        btn.className = isMuted ? 'btn btn-success' : 'btn btn-warn';
        log.sys(isMuted ? '🔇 Muted' : '🎤 Unmuted');
      });
      break;
    }

    case 'call-emergency': {
      let pressTimer: number | null = null;
      let countdown = 2;
      const btn = document.getElementById('btn-sos')!;
      const timerEl = document.getElementById('sos-timer')!;

      btn.addEventListener('mousedown', () => {
        countdown = 2;
        timerEl.textContent = `Hold ${countdown}s...`;
        pressTimer = window.setInterval(() => {
          countdown--;
          if (countdown <= 0) {
            clearInterval(pressTimer!);
            pressTimer = null;
            timerEl.textContent = 'Sending SOS...';
            triggerSOS();
          } else {
            timerEl.textContent = `Hold ${countdown}s...`;
          }
        }, 1000);
      });

      const cancelHold = () => {
        if (pressTimer) { clearInterval(pressTimer); pressTimer = null; timerEl.textContent = ''; }
      };
      btn.addEventListener('mouseup', cancelHold);
      btn.addEventListener('mouseleave', cancelHold);

      async function triggerSOS() {
        const res = await api.callInitiate({ type: 'emergency' });
        log.recv(JSON.stringify(res));
        if (res.callId) {
          currentCallId = res.callId;
          currentRoomName = res.roomName;
          currentCallType = 'emergency';
          const resultEl = document.getElementById('sos-result')!;
          resultEl.style.display = 'block';
          document.getElementById('sos-info')!.innerHTML =
            `Call ID: <code>${res.callId}</code><br>Room: <code>${res.roomName}</code><br>Mode: <b>${res.mediaMode}</b>`;

          // Auto-join LiveKit room
          if (res.mediaMode === 'sfu') {
            await joinLiveKitRoom(res.roomName, 'publisher');
            document.getElementById('sos-info')!.innerHTML +=
              `<br>🎤 <span style="color:#22c55e">SOS active — mic publishing</span>`;
          }
        }
      }
      break;
    }

    case 'call-broadcast': {
      let broadcastMode: 'select' | 'all' = 'select';

      function updateSelectedCount() {
        const count = document.querySelectorAll('.target-chk:checked').length;
        const el = document.getElementById('selected-count');
        if (el) el.textContent = broadcastMode === 'all'
          ? '🌐 Broadcast ไปทุกคน online'
          : `🎯 เลือก ${count} เป้าหมาย`;
      }

      // Mode toggle
      function setMode(mode: 'select' | 'all') {
        broadcastMode = mode;
        const btnSelect = document.getElementById('btn-mode-select')!;
        const btnAll = document.getElementById('btn-mode-all')!;
        const section = document.getElementById('target-section')!;

        if (mode === 'select') {
          btnSelect.className = 'btn btn-sm btn-primary';
          btnAll.className = 'btn btn-sm';
          section.style.opacity = '1';
          section.style.pointerEvents = 'auto';
        } else {
          btnSelect.className = 'btn btn-sm';
          btnAll.className = 'btn btn-sm btn-primary';
          section.style.opacity = '0.4';
          section.style.pointerEvents = 'none';
        }
        updateSelectedCount();
      }

      document.getElementById('btn-mode-select')!.addEventListener('click', () => setMode('select'));
      document.getElementById('btn-mode-all')!.addEventListener('click', () => setMode('all'));

      // Render target list
      function renderTargets(data: any) {
        const devContainer = document.getElementById('device-targets')!;
        const userContainer = document.getElementById('user-targets')!;

        const devices = data.devices || [];
        const users = data.users || [];

        if (devices.length === 0) {
          devContainer.innerHTML = '<div style="color:#475569;font-size:12px;text-align:center;padding:6px">ไม่มี device ที่ลงทะเบียน</div>';
        } else {
          devContainer.innerHTML = devices.map((d: any) => `
            <label style="display:flex;align-items:center;gap:6px;padding:4px 2px;font-size:12px;cursor:pointer;border-bottom:1px solid #1e293b">
              <input type="checkbox" class="target-chk device-chk" value="${d.id}" ${d.online ? '' : ''} />
              <span style="width:8px;height:8px;border-radius:50%;background:${d.online ? '#22c55e' : '#475569'};flex-shrink:0"></span>
              <span style="flex:1">
                <b>${d.name}</b>
                <span style="color:#64748b;font-size:11px;margin-left:4px">${d.identity}</span>
              </span>
              <span style="font-size:10px;color:${d.online ? '#22c55e' : '#64748b'}">${d.online ? 'online' : 'offline'}</span>
            </label>
          `).join('');
        }

        if (users.length === 0) {
          userContainer.innerHTML = '<div style="color:#475569;font-size:12px;text-align:center;padding:6px">ไม่มี user online</div>';
        } else {
          userContainer.innerHTML = users.map((u: any) => `
            <label style="display:flex;align-items:center;gap:6px;padding:4px 2px;font-size:12px;cursor:pointer;border-bottom:1px solid #1e293b">
              <input type="checkbox" class="target-chk user-chk" value="${u.id}" />
              <span style="width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0"></span>
              <span style="flex:1">
                <b>${u.name}</b>
                <span style="color:#64748b;font-size:11px;margin-left:4px">${u.id}</span>
              </span>
              <span style="font-size:10px;color:#22c55e">online</span>
            </label>
          `).join('');
        }

        // Bind checkbox change to update count
        document.querySelectorAll('.target-chk').forEach(chk => {
          chk.addEventListener('change', updateSelectedCount);
        });

        log.recv(`${devices.length} devices, ${users.length} users online`);
        updateSelectedCount();
      }

      // Load targets
      async function loadTargets() {
        const data = await api.onlineList();
        renderTargets(data);
      }

      document.getElementById('btn-refresh-targets')!.addEventListener('click', loadTargets);
      loadTargets();

      // Select all devices / users checkboxes
      document.getElementById('chk-all-devices')!.addEventListener('change', (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        document.querySelectorAll('.device-chk').forEach(chk => (chk as HTMLInputElement).checked = checked);
        updateSelectedCount();
      });
      document.getElementById('chk-all-users')!.addEventListener('change', (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        document.querySelectorAll('.user-chk').forEach(chk => (chk as HTMLInputElement).checked = checked);
        updateSelectedCount();
      });

      // Start broadcast
      document.getElementById('btn-broadcast')!.addEventListener('click', async () => {
        const body: any = { type: 'broadcast' };

        if (broadcastMode === 'select') {
          const selectedIds: string[] = [];
          document.querySelectorAll('.target-chk:checked').forEach(chk => {
            selectedIds.push((chk as HTMLInputElement).value);
          });
          if (selectedIds.length === 0) {
            log.err('เลือกเป้าหมายอย่างน้อย 1 หรือสลับเป็นโหมด "ทุกคน"');
            return;
          }
          body.targetIds = selectedIds;
        }

        const res = await api.callInitiate(body);
        log.recv(JSON.stringify(res));
        if (res.callId) {
          currentCallId = res.callId;
          currentRoomName = res.roomName;
          currentCallType = 'broadcast';

          const targetLabel = broadcastMode === 'all'
            ? '🌐 ทุกคน online'
            : `🎯 ${body.targetIds?.length || 0} เป้าหมาย`;

          const resultEl = document.getElementById('broadcast-result')!;
          resultEl.style.display = 'block';
          document.getElementById('broadcast-info')!.innerHTML =
            `<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:13px">
              <span style="color:#64748b">Call ID</span><code>${res.callId}</code>
              <span style="color:#64748b">Room</span><code>${res.roomName}</code>
              <span style="color:#64748b">Mode</span><b>${res.mediaMode}</b>
              <span style="color:#64748b">Targets</span><span>${targetLabel}</span>
            </div>`;

          if (res.mediaMode === 'sfu') {
            log.info('Auto-joining broadcast room as publisher...');
            await joinLiveKitRoom(res.roomName, 'publisher');
            document.getElementById('broadcast-info')!.innerHTML +=
              `<div style="margin-top:8px;color:#22c55e;font-weight:600">🎤 Broadcasting — mic active</div>`;
          }
        }
      });

      document.getElementById('btn-end-broadcast')!.addEventListener('click', async () => {
        if (!currentCallId) return;
        await api.callEnd({ callId: currentCallId });
        currentCallId = null;
        await leaveLiveKit();
        document.getElementById('broadcast-result')!.style.display = 'none';
      });

      setMode('select');
      break;
    }

    case 'call-history': {
      const loadHistory = async () => {
        const type = (document.getElementById('sel-history-type') as HTMLSelectElement).value;
        const res = await api.callHistory(historyPage, 10, type || undefined);
        log.recv(`${res.pagination?.total || 0} calls`);

        const tbody = (res.calls || []).map((c: any) => `
          <tr>
            <td><code style="font-size:11px">${c.id.slice(0, 8)}...</code></td>
            <td><span class="badge badge-${c.type}">${c.type}</span></td>
            <td><span class="badge badge-${c.status}">${c.status}</span></td>
            <td>${c.caller_id}</td>
            <td>${c.callee_id || '-'}</td>
            <td>${c.duration ? c.duration + 's' : '-'}</td>
            <td>${c.created_at}</td>
            <td>
              ${c.status === 'ringing' ? `<button class="btn btn-danger btn-sm" onclick="window._endCall('${c.id}')">End</button>` : ''}
            </td>
          </tr>
        `).join('');

        document.getElementById('history-table')!.innerHTML = `
          <table>
            <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Caller</th><th>Callee</th><th>Duration</th><th>Created</th><th></th></tr></thead>
            <tbody>${tbody || '<tr><td colspan="8" style="text-align:center;color:#64748b">No calls</td></tr>'}</tbody>
          </table>`;

        const pag = res.pagination;
        if (pag) {
          const btns = [];
          for (let i = 1; i <= pag.pages; i++) {
            btns.push(`<button class="btn btn-sm ${i === pag.page ? 'btn-primary' : ''}"
              onclick="window._histPage(${i})">${i}</button>`);
          }
          document.getElementById('history-pagination')!.innerHTML = btns.join('');
        }
      };

      (window as any)._histPage = (p: number) => { historyPage = p; loadHistory(); };
      (window as any)._endCall = async (id: string) => {
        await api.callEnd({ callId: id });
        loadHistory();
      };

      document.getElementById('btn-load-history')!.addEventListener('click', () => { historyPage = 1; loadHistory(); });
      loadHistory();
      break;
    }

    case 'device-register': {
      document.getElementById('btn-register-device')!.addEventListener('click', async () => {
        const name = (document.getElementById('inp-dev-name') as HTMLInputElement).value;
        const identity = (document.getElementById('inp-dev-identity') as HTMLInputElement).value;
        if (!name || !identity) return log.err('Name and identity required');

        const res = await api.deviceRegister({ name, identity });
        log.recv(JSON.stringify(res));
        document.getElementById('register-result')!.innerHTML = res.error
          ? `<div style="color:#f87171">❌ ${res.error}</div>`
          : `<div style="color:#34d399">✅ Registered!</div>
             <div class="device-card">
               <div class="name">${res.name}</div>
               <div class="meta">ID: ${res.id}<br>Token: <code style="font-size:10px;word-break:break-all">${res.token}</code></div>
             </div>
             <div style="color:#fbbf24;font-size:12px;margin-top:8px">⚠️ Token แสดงครั้งเดียว — save ไว้!</div>`;
      });
      break;
    }

    case 'device-list': {
      const loadDevices = async () => {
        const devices = await api.deviceList();
        log.recv(`${Array.isArray(devices) ? devices.length : 0} devices`);

        if (!Array.isArray(devices) || devices.length === 0) {
          document.getElementById('device-list-content')!.innerHTML =
            '<div style="color:#64748b;text-align:center;padding:20px">No devices registered</div>';
          return;
        }

        document.getElementById('device-list-content')!.innerHTML = devices.map((d: any) => `
          <div class="device-card">
            <div class="name">${d.name} <span class="badge badge-${d.status === 'online' ? 'active' : 'completed'}">${d.status}</span></div>
            <div class="meta">
              ID: ${d.id}<br>
              Identity: ${d.identity}<br>
              Last seen: ${d.last_seen || 'never'}<br>
              Location: ${d.location ? JSON.stringify(d.location) : 'not set'}
            </div>
          </div>
        `).join('');
      };

      document.getElementById('btn-load-devices')!.addEventListener('click', loadDevices);
      loadDevices();
      break;
    }

    case 'lk-config': {
      document.getElementById('btn-lk-config')!.addEventListener('click', async () => {
        const res = await api.livekitConfig();
        log.recv(JSON.stringify(res));
        document.getElementById('lk-config-result')!.textContent = JSON.stringify(res, null, 2);
      });
      break;
    }

    case 'lk-token': {
      document.getElementById('btn-lk-token')!.addEventListener('click', async () => {
        const room = (document.getElementById('inp-lk-room') as HTMLInputElement).value;
        const canPublish = (document.getElementById('sel-lk-publish') as HTMLSelectElement).value === 'true';
        const res = await api.livekitToken(room, canPublish);
        log.recv(JSON.stringify(res));
        document.getElementById('lk-token-result')!.textContent = JSON.stringify(res, null, 2);
      });
      break;
    }

    case 'lk-rooms': {
      const loadRooms = async () => {
        const res = await api.livekitRooms();
        log.recv(JSON.stringify(res));
        const rooms = res.rooms || [];
        if (rooms.length === 0) {
          document.getElementById('lk-rooms-content')!.innerHTML =
            '<div style="color:#64748b;text-align:center;padding:20px">No active rooms</div>';
          return;
        }
        document.getElementById('lk-rooms-content')!.innerHTML = rooms.map((r: any) => `
          <div class="device-card">
            <div class="name">🏠 ${r.name}</div>
            <div class="meta">Participants: ${r.numParticipants}</div>
            <div class="btn-group" style="margin-top:8px">
              <button class="btn btn-sm btn-primary" onclick="window._lkParticipants('${r.name}')">👥 Participants</button>
              <button class="btn btn-sm btn-danger" onclick="window._lkDeleteRoom('${r.name}')">🗑 Delete</button>
            </div>
          </div>
        `).join('');
      };

      (window as any)._lkParticipants = async (room: string) => {
        const res = await api.livekitParticipants(room);
        log.recv(JSON.stringify(res));
      };
      (window as any)._lkDeleteRoom = async (room: string) => {
        await api.livekitDeleteRoom(room);
        loadRooms();
      };

      document.getElementById('btn-lk-rooms')!.addEventListener('click', loadRooms);
      loadRooms();
      break;
    }

    case 'lk-audio': {
      const statusEl = () => document.getElementById('lk-audio-status')!;
      const localMeter = () => document.getElementById('lk-audio-meter-local')! as HTMLElement;
      const remoteMeter = () => document.getElementById('lk-audio-meter-remote')! as HTMLElement;

      document.getElementById('btn-lk-join')!.addEventListener('click', async () => {
        const roomName = (document.getElementById('inp-lk-audio-room') as HTMLInputElement).value;

        const tokenRes = await api.livekitToken(roomName, true);
        if (!tokenRes.token) { log.err('Failed to get LiveKit token'); return; }

        statusEl().textContent = '1/4 Connecting...';
        log.info(`Joining LiveKit room: ${roomName}`);

        try {
          const { Room, RoomEvent, RoomOptions, Track } = await import('livekit-client');

          livekitRoom = new Room({
            rtcConfig: {
              iceTransportPolicy: 'relay',  // บังคับผ่าน TURN
            },
          } as any);

          livekitRoom.on(RoomEvent.Connected, () => {
            statusEl().textContent = `2/4 Connected — publishing mic...`;
            log.sys(`LiveKit: connected to ${roomName}`);
            (document.getElementById('btn-lk-join') as HTMLButtonElement).disabled = true;
            (document.getElementById('btn-lk-leave') as HTMLButtonElement).disabled = false;
          });

          livekitRoom.on(RoomEvent.Disconnected, () => {
            statusEl().textContent = '❌ Disconnected';
            log.sys('LiveKit: disconnected');
            (document.getElementById('btn-lk-join') as HTMLButtonElement).disabled = false;
            (document.getElementById('btn-lk-leave') as HTMLButtonElement).disabled = true;
            // Stop remote audio playback
            document.getElementById('lk-remote-audio')!.innerHTML = '';
          });

          livekitRoom.on(RoomEvent.ParticipantConnected, (p: any) => {
            log.info(`LiveKit: ${p.identity} joined`);
            updateLkParticipants();
          });

          livekitRoom.on(RoomEvent.ParticipantDisconnected, (p: any) => {
            log.info(`LiveKit: ${p.identity} left`);
            updateLkParticipants();
          });

          // Remote audio track — attach to <audio> element to play
          livekitRoom.on(RoomEvent.TrackSubscribed, (track: any, pub: any, participant: any) => {
            log.sys(`🔊 Received ${track.kind} track from ${participant.identity}`);
            if (track.kind === 'audio') {
              const audioEl = track.attach();
              audioEl.id = `remote-audio-${participant.identity}`;
              document.getElementById('lk-remote-audio')!.appendChild(audioEl);
              statusEl().textContent = `✅ Connected — talking with ${participant.identity}`;
            }
            updateLkParticipants();
          });

          livekitRoom.on(RoomEvent.TrackUnsubscribed, (track: any) => {
            track.detach().forEach((el: HTMLElement) => el.remove());
          });

          // Audio level meters
          livekitRoom.on(RoomEvent.ActiveSpeakersChanged, (speakers: any[]) => {
            let localLevel = 0;
            let remoteLevel = 0;
            for (const s of speakers) {
              if (s === livekitRoom?.localParticipant) {
                localLevel = Math.min(100, s.audioLevel * 300);
              } else {
                remoteLevel = Math.max(remoteLevel, Math.min(100, s.audioLevel * 300));
              }
            }
            localMeter().style.width = `${localLevel}%`;
            remoteMeter().style.width = `${remoteLevel}%`;
          });

          await livekitRoom.connect(tokenRes.url, tokenRes.token);

          statusEl().textContent = '3/4 Publishing microphone...';
          await livekitRoom.localParticipant.setMicrophoneEnabled(true);
          log.sys('🎤 Microphone published');
          statusEl().textContent = `✅ Connected to ${roomName} — waiting for others...`;
          updateLkParticipants();
        } catch (e: any) {
          statusEl().textContent = `❌ Error: ${e.message}`;
          log.err(`LiveKit error: ${e.message}`);
        }
      });

      document.getElementById('btn-lk-leave')!.addEventListener('click', () => {
        if (livekitRoom) {
          livekitRoom.disconnect();
          livekitRoom = null;
        }
      });

      function updateLkParticipants() {
        if (!livekitRoom) return;
        const el = document.getElementById('lk-participants');
        if (!el) return;
        const parts = [livekitRoom.localParticipant, ...livekitRoom.remoteParticipants.values()];
        el.innerHTML = '<div style="font-size:12px;color:#64748b;margin-bottom:6px">Participants (' + parts.length + '):</div>' +
          parts.map((p: any) => `
            <div class="device-card">
              <span class="name">${p.identity} ${p === livekitRoom?.localParticipant ? '(you)' : ''}</span>
              <span class="meta" style="margin-left:8px">
                🎤 ${p.isMicrophoneEnabled ? '<span style="color:#22c55e">ON</span>' : '<span style="color:#ef4444">OFF</span>'}
                ${p.audioTrackPublications?.size > 0 ? ' | 📡 publishing' : ''}
              </span>
            </div>
          `).join('');
      }
      break;
    }

    case 'turn': {
      document.getElementById('btn-turn')!.addEventListener('click', async () => {
        const res = await api.turnCredentials();
        log.recv(JSON.stringify(res));
        document.getElementById('turn-result')!.textContent = JSON.stringify(res, null, 2);
      });
      break;
    }

    case 'health': {
      document.getElementById('btn-health')!.addEventListener('click', async () => {
        const res = await api.health();
        log.recv(JSON.stringify(res));
        document.getElementById('health-result')!.textContent = JSON.stringify(res, null, 2);
      });
      break;
    }

    case 'ws-signal': {
      document.getElementById('btn-signal-send')!.addEventListener('click', () => {
        const targetId = (document.getElementById('inp-signal-target') as HTMLInputElement).value;
        const type = (document.getElementById('sel-signal-type') as HTMLSelectElement).value;
        const data = (document.getElementById('inp-signal-data') as HTMLInputElement).value;

        if (type === 'ice-candidate') {
          wsSend({ type: 'ice-candidate', targetId, candidate: data });
        } else {
          wsSend({ type, targetId, sdp: data });
        }
      });

      document.getElementById('btn-signal-ping')!.addEventListener('click', () => {
        wsSend({ type: 'ping' });
      });
      break;
    }
  }
}

// ---- Init ----
showPanel('connect');
log.sys('Test client ready — เชื่อมต่อเพื่อเริ่มทดสอบ');
