export const BOARD_WIDTH = 1200;
export const BOARD_HEIGHT = 700;
export const BOARD_HEADER_HEIGHT = 36;
export const BOARD_TOOLBAR_HEIGHT = 72;
// Practical coordinate safety bound; the viewport moves without allocating a world-size bitmap.
export const BOARD_WORLD_LIMIT = 1_000_000;
export interface BoardView { x: number; y: number; zoom: number }
export const IMAGE_CAPTION_HEIGHT = 72;
export const BOARD_COLORS = ['#20242c', '#e5484d', '#3074e8', '#228b55', '#9550c8'] as const;
export interface BoardPoint { x: number; y: number }
export interface BoardStroke {
  kind: 'stroke'; id: string; color: string; size: number; points: BoardPoint[];
}
export interface BoardText {
  kind: 'text'; id: string; color: string; size: number; x: number; y: number; text: string;
}
export type BoardShapeKind = 'rectangle' | 'ellipse' | 'diamond' | 'text';
export interface BoardShape {
  kind: 'shape'; id: string; shape: BoardShapeKind; color: string; size: number;
  x: number; y: number; width: number; height: number; text: string;
}
export interface BoardImage {
  kind: 'image'; id: string; asset: string; color: string; size: number;
  x: number; y: number; width: number; height: number; caption: string;
}
export type BoardPort = 'top' | 'right' | 'bottom' | 'left';
export interface BoardEndpoint extends BoardPoint { shapeId?: string; port?: BoardPort }
export interface BoardLine {
  kind: 'line'; id: string; color: string; size: number;
  start: BoardEndpoint; end: BoardEndpoint; arrow: boolean;
}
export type BoardElement = BoardStroke | BoardText | BoardShape | BoardImage | BoardLine;
export type BoardAction = BoardElement | { kind: 'undo' | 'redo' | 'clear' | 'reset' }
  | { kind: 'reveal'; element: BoardShape | BoardLine }
  | { kind: 'viewport'; view: BoardView }
  | { kind: 'focus'; point: BoardPoint; space?: 'window' }
  | { kind: 'replace'; gesture: string; element: BoardElement; reveal?: 'text' }
  | { kind: 'connect-node'; line: BoardLine; node: BoardShape; reveal?: true }
  | { kind: 'erase'; id: string; gesture: string; radius: number; points: BoardPoint[] }
  | { kind: 'delete'; id: string };
export interface BoardBounds { x: number; y: number; width: number; height: number }
export type BoardBackdrop = 'white' | 'camera';
export type BoardMode = BoardPresentation | 'camera';
export interface BoardCameraTransition { direction: 'enter' | 'exit'; duration: number; camera: BoardBounds }
export interface BoardCameraAppearance { backdrop?: BoardBackdrop; shade?: number; cameraTransition?: BoardCameraTransition }
export type BoardPresentation = 'canvas' | 'interface';
export type BoardEvent = { t: number; action: BoardAction | { kind: 'layout'; visible: boolean; bounds: BoardBounds;
  windowBounds?: BoardBounds; presentation?: BoardPresentation; passthrough?: boolean } & BoardCameraAppearance };
export interface BoardVideoCrop { t: number; bounds: BoardBounds }
export interface BoardRecording {
  events: BoardEvent[];
  /** Canvas is replayed separately, including while other app UI is demonstrated. */
  separateCanvas?: true;
  interfaceCapture?: 'screen';
  video?: { offset: number; crops?: BoardVideoCrop[] };
}
export interface BoardWindowOptions { pinned: boolean; transparent: boolean; passthrough: boolean; transparency?: number }
export interface BoardSpeechModelState {
  phase: 'missing' | 'checking' | 'downloading' | 'ready' | 'error';
  received: number; total: number; error?: string;
}
export interface BoardSnapshot {
  session: string; available: boolean; visible: boolean; maximized?: boolean; events: BoardEvent[];
  error?: string; speechSupported?: boolean; presentation?: BoardPresentation; interfaceSupported?: boolean; presentationBusy?: boolean;
  interfaceTransparencySupported?: boolean;
  demoVisible?: boolean;
  windowOptions?: BoardWindowOptions;
  backdrop?: BoardBackdrop; shade?: number; sceneBusy?: boolean;
  camera?: import('../types').LiveRecordingState;
  cameraTransition?: BoardCameraTransition & { startedAt: number };
  controlsInsets?: { top: number; right: number; bottom: number; left: number };
  speechModel?: BoardSpeechModelState;
  opening?: string;
}
export interface WhiteboardApi {
  snapshot(): Promise<BoardSnapshot>;
  onState(callback: (state: Omit<BoardSnapshot, 'events'>) => void): () => void;
  setVisible(visible: boolean): Promise<void>;
  chooseMode?(): Promise<void>;
  viewReady?(session: string, opening: string): Promise<void>;
  choosePresentation(): Promise<void>;
  setWindowOptions(session: string, options: Partial<BoardWindowOptions>): Promise<void>;
  setMaximized(session: string, maximized: boolean): Promise<void>;
  setBackdrop(session: string, backdrop: BoardBackdrop, shade?: number): Promise<void>;
  cameraPreview: Pick<import('../types').RecordingOverlayApi, 'previewReady' | 'sendPreviewSignal' | 'onPreviewSignal'>;
  act(session: string, action: BoardAction): Promise<void>;
  importImage(session: string, bytes: Uint8Array, point: BoardPoint): Promise<BoardImage>;
  pasteImage(session: string, point: BoardPoint): Promise<BoardImage | undefined>;
  onSpeechLevel(callback: (event: { session: string; id: string; level: number }) => void): () => void;
  speechReady(session: string): Promise<boolean>;
  speechInstall(session: string): Promise<void>;
  speechStart(session: string): Promise<string>;
  speechStop(session: string, id: string): Promise<string>;
  speechCancel(session: string): Promise<void>;
}
