import { Toast, ToastStack } from '@basalt/ui';
import { dismissToast, useStore } from '../lib/store';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <ToastStack>
      {toasts.map((t) => (
        <Toast key={t.id} tone={t.tone} title={t.title} progress={t.progress} action={t.action} onClose={() => dismissToast(t.id)}>
          {t.body}
        </Toast>
      ))}
    </ToastStack>
  );
}
