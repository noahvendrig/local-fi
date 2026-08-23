import { getAuthToken } from "./token";

/**
 * Accepts either `Authorization: Bearer <token>` or a `?token=` query param.
 * The query-param fallback exists because native <audio>/<img> elements can't
 * attach custom headers (ARCHITECTURE.md §8).
 */
export function isAuthorized(request: Request): boolean {
  const expected = getAuthToken();

  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const [scheme, value] = authHeader.split(" ");
    if (scheme?.toLowerCase() === "bearer" && value === expected) {
      return true;
    }
  }

  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken && queryToken === expected) {
    return true;
  }

  return false;
}
