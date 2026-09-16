"use client";

import { useEffect, useRef, useState } from "react";

// Client-side cooldown that disables a resend/send-code button for a fixed
// number of seconds after each send, with a live countdown shown to the user.
// This is UX only — the authoritative limit is the 429 + Retry-After
// enforced server-side by enforceRateLimit() on /api/auth/* routes.
export function useCooldown(seconds: number) {
  const [remaining, setRemaining] = useState(0);
  const endRef = useRef<number>(0);

  function start() {
    endRef.current = Date.now() + seconds * 1000;
    setRemaining(seconds);
  }

  useEffect(() => {
    if (remaining <= 0) return;

    const tick = () => {
      const left = Math.max(0, Math.ceil((endRef.current - Date.now()) / 1000));
      setRemaining(left);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [remaining]);

  return { remaining, start, active: remaining > 0 };
}
