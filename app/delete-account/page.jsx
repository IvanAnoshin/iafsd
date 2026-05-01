import PublicTrustPage from '@/components/PublicTrustPage';
import { publicTrustPages } from '@/lib/public-trust-pages';

export const metadata = {
  title: 'Удаление аккаунта — Friendscape',
  description: 'Правила удаления аккаунта Friendscape.',
};

export default function DeleteAccountPage() {
  return <PublicTrustPage page={publicTrustPages.deleteAccount} />;
}
