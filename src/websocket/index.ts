export type WebSocketMessage<TPayload = unknown> = {
  type: string;
  timestamp: number;
  payload: TPayload;
};
