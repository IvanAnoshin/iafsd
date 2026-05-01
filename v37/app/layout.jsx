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
        {children}
      </body>
    </html>
  );
}
