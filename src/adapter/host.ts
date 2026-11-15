// What the running Lumiverse host can do, and the one place that decides between a lean call and the
// fallback. Host capability names are in lumiverse-spindle-types dist/host.js (SPINDLE_HOST_CAPABILITIES:
// chat-conditional-metadata-v1 L6, chat-metadata-patch-v1 L8, chat-lean-messages-v1 L13); the options are
// documented in Lumiverse developer-docs/docs/backend-api/chat-mutation.md (GetMessagesOptions, Update Patch Shape).
// Older hosts ignore unknown options and patch keys silently, so every use is gated on the capability.

export interface HostCaps {
  /** getMessages({ limit, offset, tail, light, includeExtra, ownMetadataOnly }) and updateMessage({ ownMetadata }). */
  leanMessages: boolean;
  /** updateMessage({ metadata_patch }). */
  metadataPatch: boolean;
  /** chats.compareAndSetMetadata (needs the `chats` permission as well). */
  conditionalMetadata: boolean;
}

export function hostCaps(api: unknown): HostCaps {
  const caps = ((api as { host?: { capabilities?: Record<string, unknown> } } | undefined)?.host?.capabilities ?? {}) as Record<string, unknown>;
  const on = (name: string) => caps[name] === 1 || (typeof caps[name] === 'number' && (caps[name] as number) >= 1);
  return { leanMessages: on('chat-lean-messages-v1'), metadataPatch: on('chat-metadata-patch-v1'), conditionalMetadata: on('chat-conditional-metadata-v1') };
}

/** Messages kept fresh at the start of a translation job when the host can read just the end of a chat. */
export const JOB_TAIL = 12;
/** Messages read to find the latest reply when a chat is opened. */
export const CATCH_UP_TAIL = 4;
