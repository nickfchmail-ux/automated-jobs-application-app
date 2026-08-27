/**
 * Server-safe anti-FOUC theme bootstrap.
 *
 * Lives in a NON-client module so `app/layout.tsx` (a server component) can
 * call it to inject an inline <script> before React hydrates. The script
 * reads the saved theme from localStorage (or the OS preference) and toggles
 * the `.dark` class on <html> so the first paint matches the user's choice.
 */

const STORAGE_KEY = "jobseek-theme";

export function themeInitScript() {
  return `(function(){try{var s=localStorage.getItem(${JSON.stringify(
    STORAGE_KEY,
  )});var d=s==='dark'||(!s&&matchMedia('(prefers-color-scheme: dark)').matches);if(d){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}else{document.documentElement.style.colorScheme='light';}}catch(e){}})()`;
}
