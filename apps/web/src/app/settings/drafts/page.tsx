import Link from 'next/link';
import { listDrafts } from '@deployhub/db';
import { Topbar } from '../../../components/shell/topbar';
import { Badge, type Tone } from '../../../components/ui/badge';
import { Card } from '../../../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { db } from '../../../lib/db';

export const dynamic = 'force-dynamic';

const STATUS_TONES: Record<string, Tone> = {
  pending_review: 'caution',
  approved: 'confirm',
  validation_failed: 'fault',
  rejected: 'neutral',
  superseded: 'neutral',
  draft: 'accent',
};

const DATE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export default async function DraftsPage() {
  const drafts = await listDrafts(db);

  return (
    <>
      <Topbar title="Drafts" />
      <main className="p-4 md:p-8">
        <Card>
          <h2 className="text-lg font-medium text-[var(--line)]">
            프로젝트 등록 검토
          </h2>
          <p className="mb-4 mt-1 text-sm text-[var(--annotation)]">
            CLI가 제출한 manifest는 승인 전까지 운영 프로젝트를 변경하지 않습니다.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Draft</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>제출 방식</TableHead>
                <TableHead>제출 시각</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drafts.map((draft) => (
                <TableRow key={draft.id}>
                  <TableCell>
                    <Link
                      href={`/settings/drafts/${draft.id}`}
                      className="font-mono font-medium text-[var(--line)] hover:underline"
                    >
                      {draft.id}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONES[draft.status] ?? 'neutral'}>
                      {draft.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{draft.sourceType}</TableCell>
                  <TableCell className="font-mono">{DATE_FORMAT.format(draft.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {drafts.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--annotation)]">
              검토할 Draft가 없습니다.
            </p>
          ) : null}
        </Card>
      </main>
    </>
  );
}
