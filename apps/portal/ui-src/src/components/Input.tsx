// Input -- labelled text field with optional leading icon.
// Matches the _ds_bundle.js Input API surface used by portal.jsx.
import { type ReactNode, type InputHTMLAttributes, useState, useId } from "react";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "style"> {
  label?: string;
  hint?: string;
  error?: string;
  iconLeft?: ReactNode;
  size?: "sm" | "md" | "lg";
  style?: React.CSSProperties;
}

const HEIGHTS: Record<string, number> = { sm: 36, md: 44, lg: 52 };

export function Input({
  label,
  hint,
  error,
  iconLeft = null,
  type = "text",
  size = "md",
  disabled = false,
  required = false,
  id,
  value,
  defaultValue,
  placeholder,
  onChange,
  style = {},
  ...rest
}: InputProps) {
  const reactId = useId();
  const inputId = id ?? reactId;
  const [focused, setFocused] = useState(false);
  const h = HEIGHTS[size] ?? HEIGHTS.md;
  const borderColor = error
    ? "var(--status-danger)"
    : focused
      ? "var(--border-focus)"
      : "var(--border-default)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: "var(--font-sans)", ...style }}>
      {label && (
        <label htmlFor={inputId} style={{ fontSize: "var(--fs-body-sm)", fontWeight: "var(--fw-medium)", color: "var(--text-body)" }}>
          {label}
          {required && <span style={{ color: "var(--status-danger)", marginLeft: 3 }}>*</span>}
        </label>
      )}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: h,
        padding: "0 14px",
        background: disabled ? "var(--surface-sunken)" : "var(--neutral-0)",
        border: `var(--border-width) solid ${borderColor}`,
        borderRadius: "var(--radius-md)",
        boxShadow: focused && !error ? "var(--focus-ring)" : "none",
        transition: "border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard)",
        opacity: disabled ? 0.6 : 1,
      }}>
        {iconLeft && (
          <span style={{ display: "inline-flex", width: 18, height: 18, color: "var(--text-subtle)", flexShrink: 0 }}>
            {iconLeft}
          </span>
        )}
        <input
          id={inputId}
          type={type}
          value={value}
          defaultValue={defaultValue}
          placeholder={placeholder}
          disabled={disabled}
          onChange={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--fs-body)",
            color: "var(--text-strong)",
            minWidth: 0,
          }}
          {...rest}
        />
      </div>
      {(hint || error) && (
        <span style={{ fontSize: "var(--fs-caption)", color: error ? "var(--status-danger)" : "var(--text-muted)" }}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}
