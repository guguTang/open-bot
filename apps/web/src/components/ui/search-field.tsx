import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

type SearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  "aria-label": string;
  className?: string;
  inputClassName?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  autoFocus?: boolean;
};

/** Search input composed from InputGroup (icon + clear). */
function SearchField({
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
  inputRef,
  autoFocus,
  ...props
}: SearchFieldProps) {
  return (
    <InputGroup className={cn("bg-[var(--field-background)]", className)}>
      <InputGroupAddon>
        <Search aria-hidden />
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={props["aria-label"]}
        className={inputClassName}
      />
      {value ? (
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label="清除" onClick={() => onChange("")}>
            <X />
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}

export { SearchField };
