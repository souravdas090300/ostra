"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ interval = 20_000 }: { interval?: number }) {
  const router = useRouter();
  const timerRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };

    timerRef.current = setInterval(refresh, interval);
    return () => clearInterval(timerRef.current);
  }, [router, interval]);

  return null;
}
