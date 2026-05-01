import PublicTrustPage from '@/components/PublicTrustPage';
import { publicTrustPages } from '@/lib/public-trust-pages';

export const metadata = {
  title: 'Данные — Friendscape',
  description: 'Какие данные использует Friendscape.',
};

export default function DataPage() {
  return <PublicTrustPage page={publicTrustPages.data} />;
}
