import { redirect } from 'next/navigation';

export default function LegacyProvidersPage() {
  redirect('/settings/providers');
}
