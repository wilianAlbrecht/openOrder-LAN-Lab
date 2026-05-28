export type WebSocketMessage<TPayload = unknown> = {
  type: string;
  timestamp: number;
  payload: TPayload;
};

export function createMessage<TPayload>(
  type: string,
  payload: TPayload,
): WebSocketMessage<TPayload> {
  return {
    type,
    timestamp: Date.now(),
    payload,
  };
}

export function parseMessage(value: unknown): WebSocketMessage | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<WebSocketMessage>;

    if (
      typeof parsed.type !== "string" ||
      typeof parsed.timestamp !== "number" ||
      !("payload" in parsed)
    ) {
      return null;
    }

    return parsed as WebSocketMessage;
  } catch {
    return null;
  }
}
