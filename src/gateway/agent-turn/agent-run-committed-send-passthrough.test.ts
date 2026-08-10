import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatchAgentRunFromGateway: vi.fn(),
}));

vi.mock("./agent-run-dispatch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent-run-dispatch.js")>();
  return {
    ...actual,
    dispatchAgentRunFromGateway: mocks.dispatchAgentRunFromGateway,
  };
});

import * as sessionAccessor from "../../config/sessions/session-accessor.js";
import { prepareAgentRequestPreflight } from "./agent-request-preflight.js";
import { createAgentTurnService } from "./agent-turn-service.js";
import { createAgentTurnIo } from "./io.js";

describe("gateway committed-send callback passthrough", () => {
  beforeEach(() => {
    mocks.dispatchAgentRunFromGateway.mockReset().mockResolvedValue(undefined);
    vi.spyOn(sessionAccessor, "loadSessionEntry").mockReturnValue(undefined);
  });

  it("threads the scoped commit callback from gateway dispatch into agentCommand ingress opts", async () => {
    const onCommittedMessagingToolSend = vi.fn();
    const respond = vi.fn();
    const context = {
      getRuntimeConfig: () => ({}),
      dedupe: new Map(),
      chatAbortControllers: new Map(),
      addChatRun: () => {},
      removeChatRun: () => {},
      getSessionEventSubscriberConnIds: () => [],
      broadcastToConnIds: () => {},
      broadcast: () => {},
      emitEvent: () => {},
      registerToolEventRecipient: () => {},
      logGateway: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    };
    const client = {
      connect: { client: { mode: "backend" }, scopes: ["operator.write"] },
      internal: { onCommittedMessagingToolSend },
    };
    const io = createAgentTurnIo(respond);
    const preflight = prepareAgentRequestPreflight({
      request: {
        message: "hello",
        sessionKey: "agent:main:main",
        idempotencyKey: "commit-callback-passthrough",
      },
      io,
      context,
      client,
    } as never);
    expect(preflight).toBeDefined();
    await createAgentTurnService({ context, isWebchatConnect: () => false } as never).startTurn({
      preflight,
      principal: client,
      io,
    } as never);

    // The scoped client callback must arrive armed in the agentCommand ingress
    // opts; severing the execution-phase passthrough drops it and re-opens the
    // duplicate-delivery window behind live model-switch/fallback replay.
    await vi.waitFor(() => {
      expect(mocks.dispatchAgentRunFromGateway).toHaveBeenCalledOnce();
    });
    const dispatchParams = mocks.dispatchAgentRunFromGateway.mock.calls[0]?.[0] as {
      ingressOpts: { onCommittedMessagingToolSend?: () => void };
    };
    const threaded = dispatchParams.ingressOpts.onCommittedMessagingToolSend;
    expect(threaded).toBeTypeOf("function");
    threaded?.();
    expect(onCommittedMessagingToolSend).toHaveBeenCalledOnce();
  });
});
