/*
 * Feature: user ID resolution via a configurable identity API for multi-user workspace routing.
 * Notes: exchanges a Bearer access token for a user ID by calling AUTH_USER_URL. Expects JSON { id: string }.
 * Recent changes: initial implementation for multi-user chat support.
 */

export class UserIdResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserIdResolutionError";
  }
}

export async function resolveUserId(token: string, authUserUrl: string): Promise<string> {
  let response: Response;

  try {
    response = await fetch(authUserUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
  } catch (error) {
    throw new UserIdResolutionError(
      `Failed to reach user identity API: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!response.ok) {
    throw new UserIdResolutionError(
      `User identity API returned ${response.status}`
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new UserIdResolutionError("User identity API returned non-JSON response");
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).id !== "string" ||
    !(body as Record<string, unknown>).id
  ) {
    throw new UserIdResolutionError("User identity API response missing or empty 'id' field");
  }

  return (body as Record<string, unknown>).id as string;
}
