// Shared native subagent completion routing contract.
export const SUBAGENT_ANNOUNCE_TARGETS = ["parent"] as const;
export type SubagentAnnounceTarget = (typeof SUBAGENT_ANNOUNCE_TARGETS)[number];
