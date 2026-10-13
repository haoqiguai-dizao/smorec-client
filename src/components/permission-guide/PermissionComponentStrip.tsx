import { GripVertical } from 'lucide-react';
import type { PermissionComponent, PermissionComponentId } from '../../../shared/platform-permissions';
import icon from '../../../sites/website/assets/xiaolu-icon.png';

/** The entire strip is a native file drag target; instructions belong outside it. */
export function PermissionComponentStrip({ item, multiple, disabled, drag }: {
  item: PermissionComponent; multiple: boolean; disabled: boolean; drag(id: PermissionComponentId): void;
}) {
  return <button className="permission-component-strip" type="button" disabled={disabled}
    draggable={!disabled} aria-label={`拖动整条小录${multiple ? item.role : '授权组件'}`}
    onDragStart={event => { event.preventDefault(); if (!disabled) drag(item.id); }}>
    <GripVertical size={18} aria-hidden="true" />
    <img src={icon} alt="" draggable={false} />
    <span>{item.name}{multiple ? ` · ${item.role}` : ''}</span>
  </button>;
}
