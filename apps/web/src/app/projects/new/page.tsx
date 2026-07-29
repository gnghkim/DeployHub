import Link from 'next/link';
import { Topbar } from '../../../components/shell/topbar';
import { Card } from '../../../components/ui/card';
import { ProjectForm } from '../project-form';

export default function NewProjectPage() {
  return (
    <>
      <Topbar title="New Project" />
      <main className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
        <div>
          <Link href="/projects" className="text-sm text-[var(--annotation)] hover:text-[var(--line)]">
            ← 프로젝트 목록
          </Link>
          <h2 className="mt-4 text-xl font-medium text-[var(--line)]">프로젝트 등록</h2>
          <p className="mt-1 text-sm text-[var(--annotation)]">
            저장소와 운영 메타데이터를 입력합니다.
          </p>
        </div>
        <Card>
          <ProjectForm />
        </Card>
      </main>
    </>
  );
}
