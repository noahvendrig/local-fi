"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/lib/store/auth";

/** Seeds the client auth store from the token the root layout read server-side. */
export function AuthTokenProvider({ token }: { token: string }) {
  const setToken = useAuthStore((s) => s.setToken);

  useEffect(() => {
    setToken(token);
  }, [token, setToken]);

  return null;
}
