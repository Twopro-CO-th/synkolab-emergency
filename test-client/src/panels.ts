// All panel HTML templates

export const panels: Record<string, string> = {

  connect: `
    <div class="panel">
      <h2>🔌 Connect to Emergency API</h2>
      <p class="desc">ตั้งค่า API Key และเชื่อมต่อ WebSocket</p>
      <div class="form-row">
        <label>API Key</label>
        <input id="inp-api-key" value="sk_live_change-me-to-random-string" />
      </div>
      <div class="form-row">
        <label>User ID</label>
        <input id="inp-user-id" value="test_user_1" />
      </div>
      <div class="form-row">
        <label>User Name</label>
        <input id="inp-user-name" value="Test User" />
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" id="btn-connect">🔗 Connect WebSocket</button>
        <button class="btn btn-danger" id="btn-disconnect">🔌 Disconnect</button>
      </div>
    </div>
    <div class="panel">
      <h2>📊 Online Status</h2>
      <div id="online-info" style="font-size:13px;color:#94a3b8">Click refresh to check</div>
      <div class="btn-group">
        <button class="btn btn-primary btn-sm" id="btn-online-count">🔄 Refresh</button>
      </div>
    </div>
  `,

  'call-normal': `
    <div class="panel">
      <h2>📞 Normal Call (1-to-1)</h2>
      <p class="desc">โทรหา user หรือ device โดยตรง</p>
      <div class="form-row">
        <label>Callee ID</label>
        <input id="inp-callee-id" placeholder="user id or device id" value="test_user_2" />
      </div>
      <div class="form-row">
        <label>Callee Type</label>
        <select id="sel-callee-type">
          <option value="user">User</option>
          <option value="device">Device</option>
        </select>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" id="btn-call-normal">📞 Call</button>
      </div>
      <div id="call-status" style="margin-top:12px;font-size:13px;color:#94a3b8"></div>
    </div>
    <div class="panel" id="active-call-panel" style="display:none">
      <h2>🔊 Active Call</h2>
      <div id="active-call-info"></div>
      <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <div style="font-size:11px;color:#64748b;margin-bottom:4px">🎤 My Mic</div>
          <div class="audio-meter"><div class="audio-meter-fill" id="call-meter-local"></div></div>
        </div>
        <div>
          <div style="font-size:11px;color:#64748b;margin-bottom:4px">🔊 Remote</div>
          <div class="audio-meter"><div class="audio-meter-fill" id="call-meter-remote"></div></div>
        </div>
      </div>
      <div id="call-participants" style="margin-top:12px;font-size:12px;color:#94a3b8"></div>
      <div class="btn-group">
        <button class="btn btn-danger" id="btn-end-call">📴 End Call</button>
        <button class="btn btn-warn" id="btn-toggle-mute">🔇 Mute</button>
      </div>
    </div>
  `,

  'call-emergency': `
    <div class="panel" style="border-color:#ef4444">
      <h2>🚨 Emergency SOS Call</h2>
      <p class="desc">ส่ง SOS ไปยังทุกคนที่ online — กดค้าง 2 วินาทีเพื่อส่ง</p>
      <div style="text-align:center;padding:24px">
        <button class="btn btn-danger" id="btn-sos" style="width:120px;height:120px;border-radius:50%;font-size:24px;">
          🚨 SOS
        </button>
        <div id="sos-timer" style="margin-top:12px;font-size:13px;color:#94a3b8"></div>
      </div>
    </div>
    <div class="panel" id="sos-result" style="display:none">
      <h2>📡 SOS Sent</h2>
      <div id="sos-info"></div>
    </div>
  `,

  'call-broadcast': `
    <div class="panel">
      <h2>📢 Broadcast (Admin)</h2>
      <p class="desc">ส่งเสียงไปยัง devices/users ที่เลือก หรือทุกคน</p>

      <!-- Mode selector -->
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="btn btn-sm btn-primary" id="btn-mode-select" style="flex:1">🎯 เลือกเป้าหมาย</button>
        <button class="btn btn-sm" id="btn-mode-all" style="flex:1">🌐 ทุกคน Online</button>
      </div>

      <!-- Target selection -->
      <div id="target-section">
        <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
          <button class="btn btn-sm btn-primary" id="btn-refresh-targets">🔄</button>
          <span id="selected-count" style="font-size:12px;color:#64748b">เลือก 0 เป้าหมาย</span>
        </div>

        <!-- Devices -->
        <div style="margin-bottom:8px">
          <div style="font-size:11px;color:#64748b;margin-bottom:4px;display:flex;justify-content:space-between">
            <span>📱 Devices</span>
            <label style="cursor:pointer"><input type="checkbox" id="chk-all-devices" /> ทั้งหมด</label>
          </div>
          <div id="device-targets" style="max-height:140px;overflow-y:auto;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:6px">
            <div style="color:#475569;font-size:12px;text-align:center;padding:6px">Loading...</div>
          </div>
        </div>

        <!-- Users -->
        <div>
          <div style="font-size:11px;color:#64748b;margin-bottom:4px;display:flex;justify-content:space-between">
            <span>👤 Online Users</span>
            <label style="cursor:pointer"><input type="checkbox" id="chk-all-users" /> ทั้งหมด</label>
          </div>
          <div id="user-targets" style="max-height:140px;overflow-y:auto;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:6px">
            <div style="color:#475569;font-size:12px;text-align:center;padding:6px">Loading...</div>
          </div>
        </div>
      </div>

      <div class="btn-group" style="margin-top:12px">
        <button class="btn btn-warn" id="btn-broadcast" style="flex:1;padding:12px">📢 Start Broadcast</button>
      </div>
    </div>

    <!-- Active broadcast panel -->
    <div class="panel" id="broadcast-result" style="display:none;border-color:#f59e0b">
      <h2>📡 Broadcast Active</h2>
      <div id="broadcast-info"></div>
      <div style="margin-top:8px">
        <div style="font-size:11px;color:#64748b">🎤 Mic Level</div>
        <div class="audio-meter"><div class="audio-meter-fill" id="broadcast-meter"></div></div>
      </div>
      <div class="btn-group" style="margin-top:12px">
        <button class="btn btn-danger" id="btn-end-broadcast" style="flex:1">⏹ End Broadcast</button>
      </div>
    </div>
  `,

  'call-history': `
    <div class="panel">
      <h2>📋 Call History</h2>
      <div class="form-row">
        <label>Filter Type</label>
        <select id="sel-history-type">
          <option value="">All</option>
          <option value="normal">Normal</option>
          <option value="emergency">Emergency</option>
          <option value="broadcast">Broadcast</option>
        </select>
        <button class="btn btn-primary btn-sm" id="btn-load-history">🔄 Load</button>
      </div>
      <div id="history-table" style="margin-top:12px"></div>
      <div id="history-pagination" class="btn-group" style="margin-top:8px"></div>
    </div>
  `,

  'device-register': `
    <div class="panel">
      <h2>➕ Register New Device</h2>
      <p class="desc">ลงทะเบียน Raspberry Pi หรือ IoT device</p>
      <div class="form-row">
        <label>Device Name</label>
        <input id="inp-dev-name" placeholder="เช่น Pi ห้อง 101" />
      </div>
      <div class="form-row">
        <label>Identity</label>
        <input id="inp-dev-identity" placeholder="เช่น pi_room101" />
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" id="btn-register-device">➕ Register</button>
      </div>
      <div id="register-result" style="margin-top:12px"></div>
    </div>
  `,

  'device-list': `
    <div class="panel">
      <h2>📱 Registered Devices</h2>
      <div class="btn-group" style="margin-bottom:12px">
        <button class="btn btn-primary btn-sm" id="btn-load-devices">🔄 Refresh</button>
      </div>
      <div id="device-list-content"></div>
    </div>
  `,

  'lk-config': `
    <div class="panel">
      <h2>⚙️ LiveKit Configuration</h2>
      <p class="desc">ดู LiveKit config จาก server</p>
      <div class="btn-group">
        <button class="btn btn-primary" id="btn-lk-config">📥 Get Config</button>
      </div>
      <pre id="lk-config-result" style="margin-top:12px;background:#0f172a;padding:12px;border-radius:6px;font-size:12px;overflow-x:auto"></pre>
    </div>
  `,

  'lk-token': `
    <div class="panel">
      <h2>🎫 Generate LiveKit Token</h2>
      <div class="form-row">
        <label>Room Name</label>
        <input id="inp-lk-room" value="test-room" />
      </div>
      <div class="form-row">
        <label>Can Publish</label>
        <select id="sel-lk-publish">
          <option value="true">Yes (Publisher)</option>
          <option value="false">No (Listener)</option>
        </select>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" id="btn-lk-token">🎫 Generate Token</button>
      </div>
      <pre id="lk-token-result" style="margin-top:12px;background:#0f172a;padding:12px;border-radius:6px;font-size:11px;word-break:break-all"></pre>
    </div>
  `,

  'lk-rooms': `
    <div class="panel">
      <h2>🏠 LiveKit Rooms</h2>
      <div class="btn-group" style="margin-bottom:12px">
        <button class="btn btn-primary btn-sm" id="btn-lk-rooms">🔄 Refresh</button>
      </div>
      <div id="lk-rooms-content"></div>
    </div>
  `,

  'lk-audio': `
    <div class="panel">
      <h2>🎤 LiveKit Audio Test</h2>
      <p class="desc">ทดสอบเข้า LiveKit room จริงและส่งเสียง — เปิด 2 tab เพื่อทดสอบ 2 คน</p>
      <div class="form-row">
        <label>Room Name</label>
        <input id="inp-lk-audio-room" value="test-audio-room" />
      </div>
      <div class="btn-group">
        <button class="btn btn-success" id="btn-lk-join">🎤 Join Room &amp; Publish Mic</button>
        <button class="btn btn-danger" id="btn-lk-leave" disabled>🚪 Leave Room</button>
      </div>
      <div id="lk-audio-status" style="margin-top:12px;font-size:13px;color:#94a3b8"></div>
      <div style="margin-top:8px;display:flex;gap:16px">
        <div style="flex:1"><div style="font-size:11px;color:#64748b">🎤 Local Mic</div><div class="audio-meter"><div class="audio-meter-fill" id="lk-audio-meter-local"></div></div></div>
        <div style="flex:1"><div style="font-size:11px;color:#64748b">🔊 Remote Audio</div><div class="audio-meter"><div class="audio-meter-fill" id="lk-audio-meter-remote"></div></div></div>
      </div>
      <div id="lk-participants" style="margin-top:12px"></div>
      <div id="lk-remote-audio"></div>
    </div>
  `,

  turn: `
    <div class="panel">
      <h2>🔄 TURN Credentials</h2>
      <p class="desc">ขอ TURN server credentials สำหรับ NAT traversal</p>
      <div class="btn-group">
        <button class="btn btn-primary" id="btn-turn">📥 Get Credentials</button>
      </div>
      <pre id="turn-result" style="margin-top:12px;background:#0f172a;padding:12px;border-radius:6px;font-size:12px"></pre>
    </div>
  `,

  health: `
    <div class="panel">
      <h2>💚 Health Check</h2>
      <div class="btn-group">
        <button class="btn btn-primary" id="btn-health">🏥 Check Health</button>
      </div>
      <pre id="health-result" style="margin-top:12px;background:#0f172a;padding:12px;border-radius:6px;font-size:12px"></pre>
    </div>
  `,

  'ws-signal': `
    <div class="panel">
      <h2>📡 WebRTC Signaling Test</h2>
      <p class="desc">ส่ง offer/answer/ICE candidate ผ่าน WebSocket</p>
      <div class="form-row">
        <label>Target ID</label>
        <input id="inp-signal-target" placeholder="user id ปลายทาง" value="test_user_2" />
      </div>
      <div class="form-row">
        <label>Type</label>
        <select id="sel-signal-type">
          <option value="offer">Offer</option>
          <option value="answer">Answer</option>
          <option value="ice-candidate">ICE Candidate</option>
        </select>
      </div>
      <div class="form-row">
        <label>SDP / Candidate</label>
        <input id="inp-signal-data" value="v=0\\r\\no=- 123 1 IN IP4 127.0.0.1\\r\\ns=test" />
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" id="btn-signal-send">📤 Send Signal</button>
        <button class="btn btn-success" id="btn-signal-ping">🏓 Ping</button>
      </div>
    </div>
  `,
};
