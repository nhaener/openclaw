import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("agents/agent-command");

type MessageToolSourceReplyLatch = {
  committed: () => boolean;
  mark: () => void;
};

/**
 * Idempotent latch tracking whether a message-tool-only source reply has been
 * credited as committed for the current logical run. The mark never throws:
 * once the outbound send has committed, an accounting-observer failure must not
 * become a model fallback or live-switch replay that could publish twice.
 */
export function createMessageToolSourceReplyLatch(opts: {
  onDeliveredMessageToolOnlySourceReply?: () => void;
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
      } catch (err) {
        log.warn(`message-tool source delivery observer failed: ${String(err)}`);
      }
    },
  };
}
