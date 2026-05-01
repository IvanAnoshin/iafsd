import PublicTrustPage from '@/components/PublicTrustPage';
import { publicTrustPages } from '@/lib/public-trust-pages';

export const metadata = {
  title: 'Приватность — Friendscape',
  description: 'Политика приватности Friendscape.',
};

export default function PrivacyPage() {
  return <PublicTrustPage page={publicTrustPages.privacy} />;
}
