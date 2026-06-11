// AccessibilityHints -- skip-to-content link and global ESC-to-reset handler.
// purpose: keyboard-first accessibility layer for the portal UI.
import { useEffect, useCallback } from "react";

interface AccessibilityHintsProps {
  onReset: () => void;
  targetId?: string;
}

// Skip-to-content link: renders visually hidden until focused, then slides in.
// ESC handler: calls onReset at any point in the page.
export function AccessibilityHints({
  onReset,
  targetId = "main-content",
}: AccessibilityHintsProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onReset();
      }
    },
    [onReset],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <a href={`#${targetId}`} style={styles.skipLink}>
      Skip to content
    </a>
  );
}

const styles = {
  skipLink: {
    position: "absolute" as const,
    top: -9999,
    left: -9999,
    zIndex: 9999,
    padding: "12px 24px",
    background: "var(--idira-blue-500)",
    color: "var(--neutral-0)",
    fontFamily: "var(--font-sans)",
    fontWeight: 600,
    fontSize: 14,
    borderRadius: "0 0 var(--radius-md) 0",
    textDecoration: "none",
    // On focus, slide the link into view at the top-left corner.
    // Uses :focus-visible via the base.css global rule.
  },
};

// Override style on focus via CSS class in index.css instead of inline JS.
// The skip link uses the .skip-to-content class for its visible state.
