import type { SubagentCompletionToolHandoffRegistration } from "../agents/subagent-announce-handoff.js";
import type { PluginSubagentRequesterContext } from "../plugins/runtime/subagent-requester-context.js";
import type { RuntimePluginToolGrant } from "../plugins/runtime/tool-grant.js";
import type { TrustedSessionCreation } from "./server-methods/session-creation-provenance.js";

export type DispatchGatewayMethodInProcessOptions = {
  allowSyntheticModelOverride?: boolean;
  allowSyntheticCronRunContinuation?: boolean;
  agentRunTracking?: "plugin_subagent";
  disableSyntheticClient?: boolean;
  expectFinal?: boolean;
  forceSyntheticClient?: boolean;
  internalDeliveryMediaUrls?: string[];
  internalDeliverySuppressText?: boolean;
  onDeliveredMessageToolOnlySourceReply?: () => void;
  onCommittedMessagingToolSend?: () => void;
  onAccepted?: (payload: unknown) => void;
  pluginRuntimeOwnerId?: string;
  pluginSubagentRequester?: PluginSubagentRequesterContext;
  runtimePluginToolGrant?: RuntimePluginToolGrant;
  delegatedToolPolicyHandoff?: SubagentCompletionToolHandoffRegistration;
  sessionCreation?: TrustedSessionCreation;
  requireScopedClient?: boolean;
  syntheticScopes?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  settleOnAbort?: boolean;
};
