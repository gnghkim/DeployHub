import { connection } from 'next/server';
import { listDrafts } from '@deployhub/db';
import { db } from '@/lib/db';
import { SidebarShell } from './sidebar-shell';

export async function Sidebar() {
  await connection();
  const pendingDrafts = await listDrafts(db, { status: 'pending_review' });

  return <SidebarShell pendingDraftCount={pendingDrafts.length} />;
}
