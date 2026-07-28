import { redirect } from 'next/navigation';

export default function LegacyDraftsPage() {
  redirect('/settings/drafts');
}
