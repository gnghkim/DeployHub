import { redirect } from 'next/navigation';

export default async function LegacyDraftDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  redirect(`/settings/drafts/${(await params).id}`);
}
