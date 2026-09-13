/**
 * Replaces BinaText's trading-agent logic entirely: Solum's SMS use case is a stateless status
 * lookup, so there's no per-phone state machine, no MCP bridge — just parse, read the chain
 * (via the same formatter the web API uses), reply.
 */
import type { Env } from "../backend/src/shared/env.ts";
import { lookupApplicationStatus } from "../backend/src/status/lookup.ts";

const STATUS_COMMAND = /^status\s+(\d+)$/i;

export async function handleStatusCommand(body: string, env: Env): Promise<string> {
  const match = body.trim().match(STATUS_COMMAND);
  if (!match) {
    return 'Text "STATUS <application number>" to check a Solum mortgage application, e.g. "STATUS 1".';
  }

  const applicationId = Number(match[1]);
  const view = await lookupApplicationStatus(env, applicationId);
  return view.plainEnglish;
}
