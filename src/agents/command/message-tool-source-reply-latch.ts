import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("agents/agent-command");

type MessageToolSourceReplyLatch = {
  committed: () => boolean;
  mark: () => void;
};

/**
 * Idempotent latch tracking whether an observed messaging-tool delivery has
 * committed for the current logical run. The mark never throws:
 * once the outbound send has committed, an accounting-observer failure must not
 * become a model fallback or live-switch replay that could publish twice.
 */
export function createMessageToolSourceReplyLatch(opts: {
  onDeliveredMessageToolOnlySourceReply?: () => void;
  onCommittedMessagingToolSend?: () => void;
}): MessageToolSourceReplyLatch {
  let committed = false;
  return {
    committed: () => committed,
    mark: () => {
      if (committed) {
        return;
      }
      committed = true;
      try {
        opts.onDeliveredMessageToolOnlySourceReply?.();
        opts.onCommittedMessagingToolSend?.();
      } catch (err) {
        log.warn(`message-tool source delivery observer failed: ${String(err)}`);
      }
    },
  };
}
