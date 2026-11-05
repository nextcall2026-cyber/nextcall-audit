"use client";

import { useEffect, useState } from "react";

/** A ticking wall clock for the console headers. */
export default function ConsoleClock({ className = "" }: { className?: string }) {
  const [time, setTime] = useState("--:--:--");

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("en-GB", { hour12: false }));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  return <span className={className}>{time}</span>;
}
