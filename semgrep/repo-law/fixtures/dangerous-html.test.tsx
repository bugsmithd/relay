// Positive fixture for semgrep rule `dangerous-html`.
// The fixture rule (no paths.exclude) MUST fire on this file.
// Adjacent file `dangerous-html-safe.tsx` is the negative case.

import * as React from "react";

export function UnsafeComponent({ html }: { html: string }) {
  // ruleid: dangerous-html
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

// Also catches the prop name in non-JSX contexts (spread payload).
export function buildProps(html: string) {
  // ruleid: dangerous-html
  return { dangerouslySetInnerHTML: { __html: html } };
}
