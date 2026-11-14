import { authed } from "../guard";
import { authMutationError } from "../auth-request";

export async function commentMutationGuard(request: Request, options: { recent?: boolean; allowMfaSetup?: boolean } = { recent: true }) {
  const { error } = await authed(options);
  if (error) return error;
  return authMutationError(request);
}
