const apiBase = document.getElementById("apiBase");
const token = document.getElementById("token");
const enabled = document.getElementById("enabled");
const status = document.getElementById("status");

chrome.storage.local.get({ apiBase: "http://localhost:8001", token: "", enabled: false }, (cfg) => {
  apiBase.value = cfg.apiBase;
  token.value = cfg.token;
  enabled.checked = Boolean(cfg.enabled);
});

document.getElementById("save").addEventListener("click", () => {
  chrome.storage.local.set(
    { apiBase: apiBase.value.trim() || "http://localhost:8001", token: token.value.trim(), enabled: enabled.checked },
    () => {
      status.textContent = "บันทึกแล้ว";
      chrome.runtime.sendMessage({ type: "heartbeat-now" }, () => void chrome.runtime.lastError);
    },
  );
});
