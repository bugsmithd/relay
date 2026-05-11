// Negative fixture for semgrep rule `dangerous-html`.
// Same JSX shape as `dangerous-html.test.tsx` but with the dangerous prop
// removed. The fixture rule MUST NOT fire on this file.

import * as React from "react";

export function SafeComponent({ text }: { text: string }) {
  // ok: dangerous-html
  return <div>{text}</div>;
}

export function buildProps(text: string) {
  // ok: dangerous-html
  return { children: text };
}
