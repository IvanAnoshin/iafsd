import PublicTrustPage from '@/components/PublicTrustPage';
import { publicTrustPages } from '@/lib/public-trust-pages';

export const metadata = {
  title: 'Безопасность — Friendscape',
  description: 'Безопасность аккаунта и общения в Friendscape.',
};

export default function SafetyPage() {
  return <PublicTrustPage page={publicTrustPages.safety} />;
}
