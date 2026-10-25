import { useRef, type HTMLAttributes } from "react";
import { useDialog, type DialogOptions } from "../lib/useDialog";

/**
 * The panel of a dialog drawn inline (`{open && …}`), where its component
 * cannot call useDialog itself: Tab stays inside, Escape closes, focus goes
 * back to what opened it (lib/useDialog).
 */
export default function DialogPanel({
  onClose,
  escape,
  focusFirst,
  ...props
}: HTMLAttributes<HTMLDivElement> & DialogOptions & { onClose?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, onClose, { escape, focusFirst });
  return <div ref={box} role="dialog" aria-modal="true" {...props} />;
}
