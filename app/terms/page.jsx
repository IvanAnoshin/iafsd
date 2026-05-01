import PublicTrustPage from '@/components/PublicTrustPage';
import { publicTrustPages } from '@/lib/public-trust-pages';

export const metadata = {
  title: 'Условия использования — Friendscape',
  description: 'Условия использования Friendscape.',
};

export default function TermsPage() {
  return <PublicTrustPage page={publicTrustPages.terms} />;
}
