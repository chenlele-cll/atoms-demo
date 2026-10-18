import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export function StorePanel({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  return <dialog className="store-panel" ref={dialog} aria-labelledby="panel-title" onCancel={close} onClose={close}>
    <div className="panel-heading"><h2 id="panel-title">{title}</h2><button autoFocus className="close-button" onClick={close} aria-label="Close panel">&times;</button></div>
    {children}
  </dialog>;
}
