"use client";

import { useEffect } from "react";

/** Wake the isolated extension after a client-side login/navigation; no credentials cross this message. */
export function ExtensionAutoConnect() {
  useEffect(() => {
    window.postMessage({ source: "mybot-app", type: "extension-connect" }, window.location.origin);
  }, []);
  return null;
}
