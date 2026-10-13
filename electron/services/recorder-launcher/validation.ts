export const RECORDER_URL = 'frameflow://app/index.html?overlay=launcher';

export function trustedRecorderUrl(value: string): boolean {
  // The launcher never loads arbitrary documents or development origins.
  return value === RECORDER_URL;
}

export function trustedRecorderSender(event: { sender: unknown; senderFrame: { url: string } | null },
  owner: { sender: unknown; mainFrame: { url: string } }): boolean {
  return event.sender === owner.sender && event.senderFrame === owner.mainFrame && trustedRecorderUrl(event.senderFrame.url);
}
