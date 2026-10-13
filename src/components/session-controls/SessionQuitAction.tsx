import { ToolbarQuitButton } from './ToolbarQuitButton';
import './session-quit-action.css';

/** Active sessions keep application shutdown away from the main stop control. */
export function SessionQuitAction({ disabled = false }: { disabled?: boolean }) {
  return <footer className="session-quit-action"><ToolbarQuitButton disabled={disabled} label="停止并退出小录" /></footer>;
}
