import { useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

type Props = {
  value: string;
  label: string;
  placeholder: string;
  error?: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
};

export function PendingNameInput({ value, label, placeholder, error, onChange, onCommit, onCancel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onCancel}
      />
      {error ? <div className="skill-tree-pending-err">{error}</div> : null}
    </>
  );
}
