import { beforeEach, describe, expect, it, vi } from "vitest";

type DispatchedClient = {
  internal?: {
    syntheticClient?: boolean;
    onCommittedMessagingToolSend?: () => void;
  };
};

const mocks = vi.hoisted(() => ({
  dispatchGatewayRequestInProcessRaw: vi.fn(
    async (_method: string, _params: unknown, _options?: { client?: DispatchedClient }) => ({
      ok: true as const,
      payload: null,
    }),
  ),
  getPluginRuntimeGatewayRequestScope: vi.fn((): unknown => undefined),
  getFallbackGatewayContext: vi.fn((): unknown => ({})),
}));

vi.mock("./server-in-process-dispatch.js", () => ({
  dispatchGatewayRequestInProcessRaw: mocks.dispatchGatewayRequestInProcessRaw,
  unwrapGatewayMethodDispatchResponse: (response: unknown) => response,
}));
vi.mock("../plugins/runtime/gateway-request-scope.js", () => ({
  getPluginRuntimeGatewayRequestScope: mocks.getPluginRuntimeGatewayRequestScope,
}));
vi.mock("./server-plugin-fallback-context.js", () => ({
  getFallbackGatewayContext: mocks.getFallbackGatewayContext,
  clearFallbackGatewayContext: () => {},
  setFallbackGatewayContext: () => {},
  setFallbackGatewayContextResolver: () => {},
}));

import { dispatchGatewayMethodInProcessRaw } from "./server-plugins.js";

function dispatchedClient(): DispatchedClient {
  expect(mocks.dispatchGatewayRequestInProcessRaw).toHaveBeenCalledOnce();
  const options = mocks.dispatchGatewayRequestInProcessRaw.mock.calls[0]?.[2] ?? {};
  const client = options.client;
  expect(client).toBeTruthy();
  if (!client) {
    throw new Error("Expected dispatch call options to include a client");
  }
  return client;
}

describe("in-process gateway dispatch commit-callback forwarding", () => {
  beforeEach(() => {
    mocks.dispatchGatewayRequestInProcessRaw.mockClear();
    mocks.getPluginRuntimeGatewayRequestScope.mockReset();
    mocks.getPluginRuntimeGatewayRequestScope.mockReturnValue(undefined);
    mocks.getFallbackGatewayContext.mockReset();
    mocks.getFallbackGatewayContext.mockReturnValue({});
  });

  it("arms the synthetic client with onCommittedMessagingToolSend from dispatch options", async () => {
    const observer = vi.fn();
    await dispatchGatewayMethodInProcessRaw(
      "agent",
      { message: "hi" },
      {
        onCommittedMessagingToolSend: observer,
      },
    );
    const client = dispatchedClient();
    expect(client.internal?.syntheticClient).toBe(true);
    expect(typeof client.internal?.onCommittedMessagingToolSend).toBe("function");
    client.internal?.onCommittedMessagingToolSend?.();
    expect(observer).toHaveBeenCalledOnce();
  });

  it("merges onCommittedMessagingToolSend into an authenticated scoped client", async () => {
    const observer = vi.fn();
    mocks.getPluginRuntimeGatewayRequestScope.mockReturnValue({
      context: {},
      client: {
        connect: { role: "operator" },
        internal: { syntheticClient: false },
      },
      isWebchatConnect: () => false,
    });
    await dispatchGatewayMethodInProcessRaw(
      "agent",
      { message: "hi" },
      {
        onCommittedMessagingToolSend: observer,
      },
    );
    const client = dispatchedClient();
    expect(client.internal?.syntheticClient).toBe(false);
    expect(typeof client.internal?.onCommittedMessagingToolSend).toBe("function");
    client.internal?.onCommittedMessagingToolSend?.();
    expect(observer).toHaveBeenCalledOnce();
  });

  it("leaves the callback unset when dispatch options omit it", async () => {
    await dispatchGatewayMethodInProcessRaw("agent", { message: "hi" }, {});
    const client = dispatchedClient();
    expect(client.internal?.onCommittedMessagingToolSend).toBeUndefined();
  });
});
