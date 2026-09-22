import "./globals.css";

export const metadata = {
  title: "Solent Daedalus — plane tracker",
  description:
    "Live-ish view of what's queued to land or take off at Solent Airport Daedalus, Lee-on-Solent.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
