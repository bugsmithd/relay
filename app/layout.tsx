export const metadata = {
  title: "Relay",
  description: "Workspace/channel/message vertical slice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
