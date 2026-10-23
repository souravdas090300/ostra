"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ interval = 20_000 }: { interval?: number }) {
  const router = useRouter();
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };

    timerRef.current = setInterval(refresh, interval);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [router, interval]);

  return null;
}
