import { Toggle } from '@basalt/ui';

/** A Toggle with its label shown as text (the design-system Toggle's label is for screen readers only). */
export function LabeledToggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`toggle-label${disabled ? ' disabled' : ''}`}>
      <Toggle label={label} checked={checked} onChange={onChange} disabled={disabled} />
      <span>{label}</span>
    </label>
  );
}
