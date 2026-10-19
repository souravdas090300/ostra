import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ostra",
  description: "Guest-communication and booking-calendar tool for hosts",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
