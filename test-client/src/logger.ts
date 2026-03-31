const logEl = () => document.getElementById('log')!;

function time() {
  return new Date().toLocaleTimeString('th-TH', { hour12: false });
}

function append(cls: string, prefix: string, msg: string) {
  const el = logEl();
  const div = document.createElement('div');
  div.className = `log-entry ${cls}`;
  div.innerHTML = `<span class="time">${time()}</span><b>${prefix}</b> ${escapeHtml(msg)}`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const log = {
  send: (msg: string) => append('send', '→', msg),
  recv: (msg: string) => append('recv', '←', msg),
  err: (msg: string) => append('err', '✗', msg),
  info: (msg: string) => append('info', 'ℹ', msg),
  sys: (msg: string) => append('sys', '★', msg),
};
