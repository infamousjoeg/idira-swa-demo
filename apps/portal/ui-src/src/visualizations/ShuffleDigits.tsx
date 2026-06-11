// ShuffleDigits -- on value change, briefly cycles digits through 2-3
// random frames before settling on the real value. 60ms total, subtle.
// Preserves non-digit characters (m, s, spaces) during the shuffle.
import { useState, useEffect, useRef } from "react";

export function ShuffleDigits({ value }: { value: string }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    if (value === prevRef.current) {
      setDisplay(value);
      return;
    }
    prevRef.current = value;

    const shuffle = () =>
      value
        .split("")
        .map((c) => (/\d/.test(c) ? String(Math.floor(Math.random() * 10)) : c))
        .join("");

    setDisplay(shuffle());
    const t1 = setTimeout(() => setDisplay(shuffle()), 20);
    const t2 = setTimeout(() => setDisplay(value), 60);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [value]);

  return <>{display}</>;
}
