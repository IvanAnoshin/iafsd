import './globals.css';

export const metadata = {
  title: 'Friendscape',
  description: 'Friendscape',
};

const visualBootstrapScript = `
(function () {
  try {
    var raw = window.localStorage.getItem('friendscape.visual-preferences');
    if (!raw) return;
    var prefs = JSON.parse(raw);
    if (prefs && prefs.appearance) document.body.dataset.appAppearance = prefs.appearance;
    if (prefs && prefs.vision_mode) document.body.dataset.visionMode = prefs.vision_mode;
    if (prefs && prefs.reduced_motion) document.body.dataset.reducedMotion = 'true';
  } catch (error) {}
})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body
        suppressHydrationWarning
        data-app-appearance="system"
        data-vision-mode="none"
      >
        <script dangerouslySetInnerHTML={{ __html: visualBootstrapScript }} />
        <a className="skip-link" href="#main-content">Перейти к содержимому</a>
        <div id="main-content" className="app-main-content" tabIndex={-1}>
          {children}
        </div>
        <div id="friendscape-live-region" className="sr-only" aria-live="polite" aria-atomic="true" />
      </body>
    </html>
  );
}
