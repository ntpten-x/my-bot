// Quiet mode for the background reader: pause during the owner's chosen hours (e.g. gaming time).
// Spec: "HH:MM-HH:MM" ranges separated by commas; a range may cross midnight ("22:00-02:00").
(function (root) {
  function minutes(text) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || "").trim());
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h > 24 || m > 59) return null;
    return Math.min(24 * 60, h * 60 + m);
  }
  function parseWindows(spec) {
    return String(spec || "")
      .split(/[,;\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [a, b] = part.split("-");
        const start = minutes(a);
        const end = minutes(b);
        return start === null || end === null || start === end ? null : { start, end };
      })
      .filter(Boolean);
  }
  function inQuietWindow(spec, date) {
    const now = date || new Date();
    const at = now.getHours() * 60 + now.getMinutes();
    return parseWindows(spec).some(({ start, end }) => (start < end ? at >= start && at < end : at >= start || at < end));
  }
  const api = { parseWindows, inQuietWindow };
  root.MyBotQuiet = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
