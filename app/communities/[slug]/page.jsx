import { redirect } from 'next/navigation';

export default function CommunityDetailDisabledPage() {
  redirect('/feed');
}
