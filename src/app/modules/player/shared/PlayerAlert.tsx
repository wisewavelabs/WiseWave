import { useEffect, useRef, useState } from "react";

export function PlayerAlert({
  message,
  onDismiss,
  duration = 4000,
}: {
  message: string;
  onDismiss: () => void;
  duration?: number;
}) {
  const [currentMessage, setCurrentMessage] = useState(message);
  const [exiting, setExiting] = useState(false);
  const [paused, setPaused] = useState(false);
  const dismissTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!message) {
      setCurrentMessage("");
      setExiting(false);
      return;
    }
    setCurrentMessage(message);
    setExiting(false);
  }, [message]);

  useEffect(() => {
    if (!currentMessage || exiting || paused) {
      if (dismissTimerRef.current) {
        window.clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
      return;
    }

    dismissTimerRef.current = window.setTimeout(() => {
      setExiting(true);
    }, duration);

    return () => {
      if (dismissTimerRef.current) {
        window.clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [currentMessage, exiting, paused, duration]);

  useEffect(() => {
    if (!exiting) return;
    const exitTimer = window.setTimeout(() => {
      setCurrentMessage("");
      setExiting(false);
      onDismiss();
    }, 280);
    return () => window.clearTimeout(exitTimer);
  }, [exiting, onDismiss]);

  if (!currentMessage) return null;

  return (
    <div
      className={`player-error ${exiting ? "exiting" : ""}`}
      role="alert"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onClick={() => setExiting(true)}
    >
      {currentMessage}
    </div>
  );
}

