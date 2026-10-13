export interface SessionDevice {
  enabled: boolean;
  ready?: boolean;
  disabled?: boolean;
  pending?: boolean;
  allowToggleWhilePending?: boolean;
  title?: string;
  toggle(): void;
  settings?: { label: string; open?: boolean; disabled?: boolean; toggle(): void };
}

export interface SessionDevices {
  camera: SessionDevice;
  microphone: SessionDevice;
  system: SessionDevice;
}

export interface ToolbarExclusionControl {
  count?: number;
  pending?: boolean;
  error?: string;
  disabled?: boolean;
  open: boolean;
  title: string;
  toggle(): void;
}
