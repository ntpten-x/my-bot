import * as WebUtil from './app/webutil.js';
import { ViewerSession, profiles } from './viewer-policy.mjs';

// Installed before UI.start; retain upstream keyboard, clipboard and credential UI.
export function installViewer(UI) {
  const state = new ViewerSession();
  let profile = 'balanced', automatic = false;
  const original = Object.fromEntries(['connect', 'disconnect', 'cancelReconnect', 'reconnect', 'securityFailed', 'connectFinished', 'disconnectFinished'].map(name => [name, UI[name]]));
  const panel = document.createElement('details');
  panel.id = 'mybot-viewer-diagnostics';
  panel.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:1000;background:#20252b;color:white;padding:8px;border-radius:6px;max-width:340px;font:13px sans-serif';
  panel.innerHTML = `<summary>MY-BOT · การเชื่อมต่อ / ภาพ</summary>
    <p><label>คุณภาพภาพ <select aria-label="คุณภาพภาพ"><option value="balanced">สมดุล (6/2)</option><option value="smooth">เน้นลื่น (6/0)</option><option value="sharp">เน้นคม (9/0)</option></select></label></p>
    <p data-status role="status">ยังไม่เชื่อมต่อ</p><p data-metrics></p>
    <button type="button">วัดการตอบสนอง 10 วินาที</button><p data-benchmark></p>
    <small>สถานะเชื่อมต่อไม่ยืนยันว่าภาพสด · การวัด rAF เป็นการตอบสนองหน้า viewer ไม่ใช่ FPS ของ Facebook</small>`;
  document.body.append(panel);
  const status = panel.querySelector('[data-status]');
  function render(text) {
    if (text) status.textContent = text;
    const m = state.snapshot();
    panel.querySelector('[data-metrics]').textContent = `หลุด ${m.disconnectCount} ครั้ง · retry ${m.reconnectAttempts}/5 · เชื่อมต่อ ${m.lastConnectMs ?? '—'} ms · เหตุผล ${m.lastReason}${m.lastConnectedAt ? ' · ล่าสุด ' + new Date(m.lastConnectedAt).toLocaleTimeString('th-TH') : ''}`;
  }
  function setting(name, value) { WebUtil.setSetting(name, value); UI.updateSetting(name); }
  function applyProfile() {
    const chosen = profiles[profile];
    setting('quality', chosen.quality);
    setting('compression', chosen.compression);
    if (UI.rfb) {
      UI.rfb.qualityLevel = chosen.quality;
      UI.rfb.compressionLevel = chosen.compression;
      UI.rfb.scaleViewport = true;
      UI.rfb.resizeSession = false;
    }
  }
  panel.querySelector('select').addEventListener('change', event => { profile = event.target.value; applyProfile(); });
  UI.connect = function (...args) {
    if (UI.rfb) return;
    if (!automatic) { state.retries = 0; UI.inhibitReconnect = false; }
    state.begin();
    original.connect.apply(UI, args);
    applyProfile();
    render('กำลังเชื่อมต่อ (รวมเวลารอกรอกรหัสผ่าน)');
  };
  UI.connectFinished = function (...args) {
    state.connected();
    original.connectFinished.apply(UI, args);
    render('เชื่อมต่อ VNC แล้ว');
  };
  function cancel(reason) {
    state.manualDisconnect(reason);
    UI.inhibitReconnect = true;
    clearTimeout(UI.reconnectCallback);
    UI.reconnectCallback = null;
    UI.reconnectPassword = undefined;
  }
  UI.disconnect = function (...args) {
    cancel('manual');
    original.disconnect.apply(UI, args);
    render('ตัดการเชื่อมต่อแล้ว');
  };
  UI.cancelReconnect = function (...args) {
    cancel('cancelled'); original.cancelReconnect.apply(UI, args); render('ยกเลิกการเชื่อมต่อใหม่');
  };
  UI.securityFailed = function (...args) {
    state.securityFailure(); cancel('authentication');
    original.securityFailed.apply(UI, args); render('ยืนยันตัวตนไม่ผ่าน กรุณาเชื่อมต่อด้วยตนเอง');
  };
  UI.disconnectFinished = function (event) {
    state.disconnected(event.detail.clean ? 'clean' : 'transport');
    const retry = state.allowed && UI.getSetting('reconnect', false) === true && !UI.inhibitReconnect ? state.retryDelay() : null;
    if (retry === null) cancel(state.lastReason);
    else setting('reconnect_delay', retry);
    original.disconnectFinished.call(UI, event);
    render(retry === null ? 'หยุดเชื่อมต่อใหม่ · กด Connect เพื่อเริ่มใหม่' : `เชื่อมต่อหลุด · ลองใหม่ใน ${retry / 1000} วินาที`);
  };
  // A fresh owner Connect starts a new bounded budget; automatic reconnect keeps it.
  UI.reconnect = function (...args) {
    const retries = state.retries;
    automatic = true;
    try { original.reconnect.apply(UI, args); } finally { automatic = false; }
    state.retries = retries;
    render();
  };
  let raf = null, measuring = false;
  const button = panel.querySelector('button'), output = panel.querySelector('[data-benchmark]');
  function stopMeasurement(text) {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null; measuring = false; button.disabled = false;
    if (text) output.textContent = text;
  }
  button.addEventListener('click', () => {
    if (measuring || document.hidden) return;
    measuring = true; button.disabled = true;
    const samples = [], started = performance.now();
    let last = started;
    function frame(now) {
      samples.push(now - last); last = now;
      if (now - started < 10000) { raf = requestAnimationFrame(frame); return; }
      samples.sort((a,b) => a-b);
      const percentile = fraction => samples[Math.min(samples.length-1, Math.floor(samples.length * fraction))].toFixed(1);
      stopMeasurement(`${profile} · ช่วง rAF p50 ${percentile(.5)} / p95 ${percentile(.95)} ms · ${samples.length} samples`);
    }
    output.textContent = 'กำลังวัด กรุณาใช้รูปแบบการใช้งานเดียวกันเมื่อเปรียบเทียบ';
    raf = requestAnimationFrame(frame);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && measuring) stopMeasurement('หยุดวัดเพราะ viewer ไม่ได้แสดงอยู่'); });
  window.addEventListener('pagehide', () => {
    cancel('cancelled'); stopMeasurement();
    UI.rfb?.disconnect();
  });
  return state;
}
