import { useEffect, useRef } from "react";
import { useSnackbar } from "../../../shared/ui/Snackbar";

export function PlayerAlert({ message, onDismiss, duration, action }: { message: string; onDismiss: () => void; duration?: number; action?: { label: string; onClick: () => void } }) {
  const show = useSnackbar();
  const currentMessage = useRef(message);
  const dismiss = useRef(onDismiss);
  const actionRef = useRef(action);
  currentMessage.current = message;
  dismiss.current = onDismiss;
  actionRef.current = action;
  useEffect(() => {
    if (!message) return;
    show({ text: message, duration, action: actionRef.current, onDismiss: () => { if (currentMessage.current === message) dismiss.current(); } });
  }, [message, duration, show]);
  return null;
}
