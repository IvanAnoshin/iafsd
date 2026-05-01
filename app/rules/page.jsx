import PublicTrustPage from '@/components/PublicTrustPage';
import { publicTrustPages } from '@/lib/public-trust-pages';

export const metadata = {
  title: 'Правила — Friendscape',
  description: 'Правила сообщества Friendscape.',
};

export default function RulesPage() {
  return <PublicTrustPage page={publicTrustPages.rules} />;
}
