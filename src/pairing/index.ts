export type PairingQrPayload = {
  deviceName: string;
  deviceId: string;
  callbackIp: string;
  callbackPort: number;
  nonce: string;
  appVersion: string;
};
