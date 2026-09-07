import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'DMS Executive AI — Your business, in focus',description:'Your executive workspace for business performance, actionable insights and decisions.'};
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
