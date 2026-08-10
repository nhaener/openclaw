import {
  getGeneratedMediaTaskIdsForSessionKey,
  hasNewGeneratedMediaTaskForSessionKey,
} from "../../tasks/task-status-access.js";
import { createMessageToolSourceReplyLatch } from "./message-tool-source-reply-latch.js";
import type { AgentCommandOpts } from "./types.js";

export function createMessageToolCommitObservers(opts: AgentCommandOpts) {
  const sourceReplyLatch = createMessageToolSourceReplyLatch(opts);
  const messagingToolSendLatch = createMessageToolSourceReplyLatch({
    onCommittedMessagingToolSend: opts.onCommittedMessagingToolSend,
  });

  return {
    hasCommittedSideEffect(sessionKey: string | undefined, mediaTaskIds: ReadonlySet<string>) {
      return (
        sourceReplyLatch.committed() ||
        messagingToolSendLatch.committed() ||
        Boolean(sessionKey && hasNewGeneratedMediaTaskForSessionKey(sessionKey, mediaTaskIds))
      );
    },
    getMediaTaskIds(sessionKey: string | undefined): ReadonlySet<string> {
      return sessionKey ? getGeneratedMediaTaskIdsForSessionKey(sessionKey) : new Set<string>();
    },
    withLatches() {
      return {
        ...opts,
        onDeliveredMessageToolOnlySourceReply: opts.onDeliveredMessageToolOnlySourceReply
          ? sourceReplyLatch.mark
          : undefined,
        onCommittedMessagingToolSend: opts.onCommittedMessagingToolSend
          ? messagingToolSendLatch.mark
          : undefined,
      };
    },
  };
}
