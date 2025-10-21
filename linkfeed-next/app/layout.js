export const metadata = {
  title: "LinkFeed",
  description: "Kick link feed viewer",
};

export default function RootLayout({ children }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
