import './globals.css';

export const metadata = {
  title: 'Google Maps Data Extractor Pro - SaaS',
  description: 'AI-Powered Google Maps Business Lead Finder with Smart Deduplication',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-800 font-sans min-h-screen flex flex-col antialiased">
        {children}
      </body>
    </html>
  );
}
