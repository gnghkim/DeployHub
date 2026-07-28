import { redirect } from 'next/navigation';

export default function LegacyResourcesPage() {
  redirect('/settings/resources');
}
