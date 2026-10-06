import { Inter } from "next/font/google";
import "material-symbols/outlined.css";
import "./globals.css";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import ThemeBridge from "@/shared/components/ThemeBridge";
import "@/lib/network/initOutboundProxy"; // Auto-initialize outbound proxy env
import "@/shared/services/bootstrap"; // Auto-run initializeApp (watchdog, auto-resume tunnel)
import { initConsoleLogCapture } from "@/lib/consoleLogBuffer";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";

// First-paint theme + font-ready scripts, executed via ThemeBridge (a client
// component that appends them to <head> through the DOM API). This is the same
// code the root layout used to inline as <script> tags — moved out so no
// <script> element lands inside React's render tree (Next 16 / React 19 dev
// build flags that with "Encountered a script tag while rendering React
// component"). Mirrors applyTheme() in store/themeStore.js: `dark` class and
// `data-palette` (whitelist must match PALETTES keys minus violet).
const FIRST_PAINT_SCRIPT = [
  `(function(){try{var s=localStorage.getItem('theme');var st=s?(JSON.parse(s).state||{}):{};var t=st.theme||'system';var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var r=document.documentElement;if(t==='dark'||(t==='system'&&m)){r.classList.add('dark')}else{r.classList.remove('dark')}var p=st.palette;if(p&&p!=='violet'&&['violet','sea','rose','amber','teal'].indexOf(p)!==-1){r.setAttribute('data-palette',p)}else{r.removeAttribute('data-palette')}}catch(e){}})();`,
  // Mark the root "fonts-loaded" only when the Material Symbols webfont
  // actually finishes loading. The previous 3s setTimeout caused a window
  // where a slow webfont left the raw glyph name ("revert", "scan", …)
  // visible next to the button label — the "REVERT Revoke" ghost. If
  // document.fonts is missing (very old browser) we add the class
  // immediately so icons fall back to their ligature text instead of
  // staying invisible.
  `var d=document,r=d.documentElement,f=function(){r.classList.add('fonts-loaded')};if(d.fonts&&d.fonts.load){d.fonts.load('24px "Material Symbols Outlined"').then(f).catch(function(){/* fall through: stay hidden until the font is actually paintable */});}else{f()}`,
].join("\n");

// Hook console immediately at module load time (server-side only, runs once)
initConsoleLogCapture();

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata = {
  title: "9Router-Plinian — AI Routing Gateway",
  description: "One endpoint for all your AI providers. Manage keys, monitor usage, and scale effortlessly.",
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeBridge script={FIRST_PAINT_SCRIPT} />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider>
          <RuntimeI18nProvider>
            {children}
          </RuntimeI18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
