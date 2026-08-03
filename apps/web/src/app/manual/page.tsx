import Link from 'next/link';
import type { ReactNode } from 'react';
import { Topbar } from '@/components/shell/topbar';
import { ManualCopyButton } from './manual-copy-button';

const TABLE_OF_CONTENTS = [
  { id: 'scope', label: '이 매뉴얼의 범위' },
  { id: 'quick-start', label: '5분 빠른 시작' },
  { id: 'prerequisites', label: '시작 전에 준비할 것' },
  { id: 'new-project', label: '신규 프로젝트 등록 맡기기' },
  { id: 'existing-project', label: '기존 프로젝트 정보 갱신 맡기기' },
  { id: 'ai-procedure', label: 'AI가 따라야 하는 절차' },
  { id: 'draft-review', label: 'Draft에서 사용자가 확인할 것' },
  { id: 'safety', label: '비밀정보와 추측 방지 원칙' },
  { id: 'troubleshooting', label: '문제가 생겼을 때 다시 요청하기' },
  { id: 'completion-report', label: 'AI의 완료 보고 예시' },
  { id: 'references', label: '더 자세한 문서' },
] as const;

const NEW_PROJECT_PROMPT = `이 저장소의 실제 기술 구성과 운영 배포 설정을 조사해서 DeployHub 신규 등록을 준비해줘.

- 작업 범위는 DeployHub 프로젝트 등록까지야. 실제 서비스 배포는 하지 마.
- 저장소 루트에서 DeployHub CLI를 사용해 deployhub.yaml을 생성해.
- CLI가 출력한 INFERRED FIELDS와 UNKNOWN FIELDS를 검토하고, 파일에서 확인되는 값만 보완해.
- provider, externalRef, container, 운영 URL은 추측하지 마.
- 비밀값을 파일, 명령 인자, 로그 또는 대화에 출력하지 마.
- validate에 성공한 뒤 register --draft까지만 실행해.
- 최종 승인은 하지 말고 Draft URL, 확인된 내용, 확인하지 못한 내용을 보고해줘.`;

const EXISTING_PROJECT_PROMPT = `이 저장소의 현재 기술 구성과 운영 배포 설정을 조사해서 DeployHub 등록 정보와 비교해줘.

- 작업 범위는 DeployHub 정보 갱신까지야. 실제 서비스 배포는 하지 마.
- 먼저 status와 diff를 실행해 현재 상태와 차이를 확인해.
- 필요한 변경만 deployhub.yaml에 반영하고, 확인되지 않은 값은 추측하지 마.
- 비밀값을 파일, 명령 인자, 로그 또는 대화에 출력하지 마.
- validate에 성공한 뒤 sync --draft까지만 실행해.
- 최종 승인은 하지 말고 Draft URL, 변경 요약, 확인하지 못한 내용을 보고해줘.`;

const VALIDATE_ONLY_PROMPT = `현재 deployhub.yaml을 조사하고 validate까지만 실행해줘.
Draft는 제출하지 말고, 검증 오류와 확인되지 않은 필드만 정리해줘.
비밀값은 출력하지 마.`;

const REINVESTIGATE_PROMPT = `deployhub.yaml의 provider, externalRef, container, url을 저장소와 운영 설정에서 다시 조사해줘.
각 값의 근거 파일이나 설정 위치를 함께 보고하고, 근거가 없는 값은 제거하거나 생략해.
이번에는 Draft를 제출하지 말고 수정안과 확인 필요 항목만 보고해줘.`;

const VALIDATION_ERROR_PROMPT = `DeployHub CLI validate 오류의 원인을 최신 Schema와 실제 저장소 설정을 기준으로 진단해줘.
YAML 구조나 값을 추측하지 말고, 오류를 바로잡은 뒤 validate를 다시 실행해.
검증에 성공해도 이번 요청에서는 Draft를 제출하지 마.`;

const CONNECTION_ERROR_PROMPT = `DeployHub CLI의 401, 403 또는 서버 연결 오류를 진단해줘.
DEPLOYHUB_URL 설정, 네트워크 접근, 토큰 만료·권한·저장소 제한 여부를 비밀값을 출력하지 않고 확인해.
토큰을 대화나 명령 인자로 요구하지 말고, 오류 원인과 사용자가 해야 할 조치만 보고해.
연결 문제가 해결될 때까지 Draft를 다시 제출하지 마.`;

const COMPLETION_REPORT = `결과: Draft 제출 완료
검증: 성공
Draft URL: https://deployhub.example.com/settings/drafts/확인할-Draft-ID

확인된 변경:
- API 구성요소의 실제 운영 URL 반영
- 저장소 설정에서 확인한 컨테이너 이름 반영

확인하지 못해 생략한 항목:
- 워커의 externalRef: 저장소와 운영 설정에서 근거를 찾지 못함

사용자 검토 항목:
- API URL이 실제 운영 주소인지
- 컨테이너 이름이 운영 환경과 일치하는지
- externalRef 생략을 허용할지`;

function ManualToc({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="매뉴얼 목차" className={className}>
      <p className="mb-3 text-sm font-semibold text-[var(--line)]">
        이 페이지에서
      </p>
      <ol className="space-y-2 text-sm">
        {TABLE_OF_CONTENTS.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="text-[var(--line-mute)] transition-colors hover:text-[var(--accent)]"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-6 border-t border-[var(--rule)] pt-8"
    >
      <h2 className="text-2xl font-semibold text-[var(--line)]">{title}</h2>
      <div className="mt-4 space-y-4 leading-7">{children}</div>
    </section>
  );
}

function Subheading({ children }: { children: ReactNode }) {
  return (
    <h3 className="pt-2 text-lg font-semibold text-[var(--line)]">
      {children}
    </h3>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--canvas)] p-4 text-sm leading-6 text-[var(--line-mute)]">
      <code>{children}</code>
    </pre>
  );
}

function CopyablePrompt({ children }: { children: string }) {
  return (
    <div>
      <CodeBlock>{children}</CodeBlock>
      <ManualCopyButton text={children} />
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--paper)] p-4 text-sm leading-6">
      {children}
    </div>
  );
}

function renderManualSections() {
  return (
    <>
      <Section id="scope" title="이 매뉴얼의 범위">
        <p>
          이 문서는 <strong className="text-[var(--line)]">다른 프로젝트를 DeployHub에 등록하거나 등록 정보를 갱신하는 작업</strong>을
          AI에게 맡기는 방법을 설명합니다. 대상 프로젝트의 실제 서비스 배포는 다루지
          않습니다. DeployHub 자체 서비스의 배포는 다루지 않습니다.
        </p>
        <p>이 매뉴얼로 AI에게 맡길 수 있는 작업은 다음과 같습니다.</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>저장소를 조사해 신규 프로젝트 등록 초안 만들기</li>
          <li>이미 등록된 프로젝트와 현재 저장소의 차이 확인하기</li>
          <li>변경된 기술 구성과 운영 배포 정보를 Draft로 제출하기</li>
          <li>검증 오류나 확인되지 않은 값의 원인 조사하기</li>
        </ul>
        <p>다음 작업은 범위에 포함되지 않습니다.</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>대상 프로젝트의 코드 빌드 또는 실제 서비스 배포</li>
          <li>서버 재시작, 데이터베이스 변경, 인프라 생성·삭제</li>
          <li>DeployHub 자체 서비스의 배포와 운영</li>
          <li>AI가 Draft를 최종 승인하는 작업</li>
        </ul>
      </Section>

      <Section id="quick-start" title="5분 빠른 시작">
        <ol className="list-decimal space-y-2 pl-6">
          <li>등록할 프로젝트의 저장소를 AI 작업 공간으로 엽니다.</li>
          <li>
            터미널에 <code>DEPLOYHUB_URL</code>과 <code>DEPLOYHUB_TOKEN</code>을
            환경변수로 준비합니다. 토큰 값은 AI 대화에 붙여 넣지 않습니다.
          </li>
          <li>처음 등록하면 신규 등록 요청문을, 이미 등록했다면 정보 갱신 요청문을 복사해 AI에게 보냅니다.</li>
          <li>AI가 조사·검증을 마치고 Draft URL을 보고할 때까지 기다립니다.</li>
          <li>Draft 화면에서 변경 내용을 확인한 뒤 직접 승인하거나 반려합니다.</li>
        </ol>
        <Note>
          <strong className="text-[var(--line)]">핵심 원칙:</strong> AI는 Draft 제출까지만,
          최종 승인은 사용자가 직접 합니다.
        </Note>
      </Section>

      <Section id="prerequisites" title="시작 전에 준비할 것">
        <Subheading>필수 준비</Subheading>
        <ul className="list-disc space-y-1 pl-6">
          <li>Node.js 22 이상</li>
          <li>AI가 읽을 수 있도록 연 등록 대상 프로젝트 저장소</li>
          <li>관리자가 제공한 DeployHub 서버 URL</li>
          <li>해당 프로젝트를 등록하거나 갱신할 수 있는 DeployHub 토큰</li>
        </ul>
        <p>
          CLI를 별도로 설치할 필요는 없습니다. AI는 대상 저장소 루트에서
          <code className="ml-1">npx @deployhub/cli</code>를 사용합니다.
        </p>
        <Subheading>터미널 환경변수 설정</Subheading>
        <p>
          <code>DEPLOYHUB_URL</code>은 공개 가능한 서버 주소지만,
          <code className="ml-1">DEPLOYHUB_TOKEN</code>은 비밀값입니다. 토큰을 가려서
          입력하면 대화나 명령 기록에 실제 값이 남는 일을 줄일 수 있습니다.
        </p>
        <p className="font-medium text-[var(--line)]">PowerShell 7</p>
        <CodeBlock>{`$env:DEPLOYHUB_URL = 'https://deployhub.example.com'
$deployHubTokenInput = Read-Host 'DEPLOYHUB_TOKEN' -MaskInput
Set-Item -Path Env:DEPLOYHUB_TOKEN -Value $deployHubTokenInput
Remove-Variable deployHubTokenInput`}</CodeBlock>
        <p className="font-medium text-[var(--line)]">macOS 또는 Linux</p>
        <CodeBlock>{`export DEPLOYHUB_URL='https://deployhub.example.com'
read -rsp 'DEPLOYHUB_TOKEN: ' DEPLOYHUB_TOKEN; echo
export DEPLOYHUB_TOKEN`}</CodeBlock>
        <p>
          서버 주소는 관리자가 알려준 실제 주소로 바꿉니다. 토큰 자체는 문서, 저장소
          파일, AI 대화 또는 명령 인자에 적지 않습니다.
        </p>
        <Subheading>대상 저장소에 AI 지침 추가하기</Subheading>
        <p>
          반복해서 관리할 프로젝트라면 다른 저장소용 AGENTS 템플릿을 대상 저장소의
          기존 지침에 합쳐 두는 것을 권장합니다. 기존 지침을 통째로 덮어쓰지 않습니다.
        </p>
      </Section>

      <Section id="new-project" title="신규 프로젝트 등록 맡기기">
        <p>
          DeployHub에 아직 없는 프로젝트에 사용합니다. AI는 저장소를 감지해
          <code className="mx-1">deployhub.yaml</code>을 만들고 확인된 값만 보완한 뒤
          신규 등록 Draft를 제출합니다.
        </p>
        <CopyablePrompt>{NEW_PROJECT_PROMPT}</CopyablePrompt>
        <p>
          AI가 <code>UNKNOWN FIELDS</code>를 보고하면 억지로 채우게 하지 마세요. 운영
          담당자가 근거를 제공하거나 알 수 없는 선택 필드는 생략하도록 요청합니다.
        </p>
      </Section>

      <Section id="existing-project" title="기존 프로젝트 정보 갱신 맡기기">
        <p>
          기술 스택, 구성요소, 운영 URL 또는 배포 환경이 바뀐 프로젝트에 사용합니다.
          AI는 서버 정보와 로컬 manifest를 비교하고 필요한 변경만 Draft로 제출합니다.
        </p>
        <CopyablePrompt>{EXISTING_PROJECT_PROMPT}</CopyablePrompt>
        <p>
          차이가 없다면 빈 Draft를 만들 필요가 없습니다. <code>diff</code> 결과에 변경이
          없다고 보고하고 종료하도록 합니다.
        </p>
      </Section>

      <Section id="ai-procedure" title="AI가 따라야 하는 절차">
        <p>모든 명령은 등록 대상 저장소의 루트에서 실행합니다.</p>
        <Subheading>신규 프로젝트</Subheading>
        <CodeBlock>{`npx @deployhub/cli init --detect
# INFERRED FIELDS와 UNKNOWN FIELDS를 검토하고 확인된 값만 deployhub.yaml에 보완
npx @deployhub/cli validate
npx @deployhub/cli register --draft`}</CodeBlock>
        <Subheading>기존 프로젝트</Subheading>
        <CodeBlock>{`npx @deployhub/cli status
npx @deployhub/cli diff
# 필요한 경우 확인된 변경만 deployhub.yaml에 반영
npx @deployhub/cli validate
npx @deployhub/cli sync --draft`}</CodeBlock>
        <p>
          AI는 감지 또는 비교와 <code>validate</code> 사이에서
          <code className="ml-1">deployhub.yaml</code>을 수정할 수 있습니다. 단,
          저장소 파일이나 확인된 운영 설정에서 근거를 찾은 값만 사용해야 합니다.
        </p>
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--rule)]">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm">
            <thead className="bg-[var(--paper)] text-[var(--line)]">
              <tr>
                <th className="border-b border-[var(--rule)] px-4 py-3">명령</th>
                <th className="border-b border-[var(--rule)] px-4 py-3">DEPLOYHUB_TOKEN</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="border-b border-[var(--rule)] px-4 py-3"><code>init --detect</code>, <code>validate</code></td><td className="border-b border-[var(--rule)] px-4 py-3">불필요</td></tr>
              <tr><td className="border-b border-[var(--rule)] px-4 py-3"><code>status</code>, <code>diff</code></td><td className="border-b border-[var(--rule)] px-4 py-3">필요</td></tr>
              <tr><td className="px-4 py-3"><code>register --draft</code>, <code>sync --draft</code></td><td className="px-4 py-3">필요</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          <code>register</code>와 <code>sync</code>에는 항상 <code>--draft</code>를
          사용합니다. CLI에는 AI가 최종 승인을 대신하는 명령이 없습니다.
        </p>
      </Section>

      <Section id="draft-review" title="Draft에서 사용자가 확인할 것">
        <p>AI가 전달한 Draft URL을 열고 다음 항목을 확인합니다.</p>
        <ul className="space-y-2">
          {[
            '프로젝트 이름과 slug가 대상 프로젝트와 일치하는가?',
            '저장소 소유자와 저장소명이 정확한가?',
            '프론트엔드, API, 데이터베이스, 워커 등 구성요소가 빠지거나 중복되지 않았는가?',
            '각 구성요소의 provider가 실제 배포·인프라 제공자인가?',
            'externalRef가 실제 Provider 안에서 확인된 식별자인가?',
            'container가 운영 설정에서 사용하는 실제 컨테이너 이름인가?',
            'url이 실제 운영 HTTP(S) 주소인가?',
            '예상하지 않은 삭제나 대규모 변경이 포함되지 않았는가?',
            'Draft 검증 결과가 성공인가?',
            'AI가 확인하지 못해 생략했다고 보고한 항목이 허용 가능한가?',
          ].map((item) => (
            <li key={item} className="flex gap-3">
              <span aria-hidden="true" className="text-[var(--annotation)]">□</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p>하나라도 확실하지 않으면 승인하지 말고 반려한 뒤 근거를 다시 조사하도록 요청합니다.</p>
      </Section>

      <Section id="safety" title="비밀정보와 추측 방지 원칙">
        <Subheading>비밀정보</Subheading>
        <ul className="list-disc space-y-1 pl-6">
          <li><code>DEPLOYHUB_TOKEN</code>은 터미널 환경변수로만 전달합니다.</li>
          <li>토큰, 사용자 비밀번호, Provider Secret을 AI 대화에 붙여 넣지 않습니다.</li>
          <li>비밀값을 <code>deployhub.yaml</code>, 문서 또는 소스 코드에 저장하지 않습니다.</li>
          <li>비밀값을 CLI 명령 인자에 넣거나 로그로 출력하지 않습니다.</li>
          <li>완료 보고에 토큰 일부라도 포함되면 폐기하고 새 토큰을 발급받습니다.</li>
        </ul>
        <Subheading>추측하면 안 되는 값</Subheading>
        <ul className="list-disc space-y-1 pl-6">
          <li>YAML 구조: CLI가 생성한 manifest와 첫 줄의 최신 Schema를 사용합니다.</li>
          <li><code>provider</code>: 실제 제공자이며 Schema가 허용하는 값만 사용합니다.</li>
          <li><code>externalRef</code>: Provider 화면이나 운영 설정에서 확인된 식별자만 사용합니다.</li>
          <li><code>container</code>: Docker 또는 운영 배포 설정에서 확인된 이름만 사용합니다.</li>
          <li><code>url</code>: 실제 운영 HTTP(S) URL만 사용합니다.</li>
        </ul>
        <p>근거를 찾지 못한 값은 만들지 말고 생략하거나 사용자 확인 필요 항목으로 보고합니다. 검증에 실패한 manifest는 Draft로 제출하지 않습니다.</p>
      </Section>

      <Section id="troubleshooting" title="문제가 생겼을 때 다시 요청하기">
        <Subheading>Draft를 제출하지 않고 검증만 하기</Subheading>
        <CopyablePrompt>{VALIDATE_ONLY_PROMPT}</CopyablePrompt>
        <Subheading>누락되거나 추측된 값 다시 조사하기</Subheading>
        <CopyablePrompt>{REINVESTIGATE_PROMPT}</CopyablePrompt>
        <Subheading>검증 오류 진단하기</Subheading>
        <CopyablePrompt>{VALIDATION_ERROR_PROMPT}</CopyablePrompt>
        <Subheading>401, 403 또는 서버 연결 오류 진단하기</Subheading>
        <CopyablePrompt>{CONNECTION_ERROR_PROMPT}</CopyablePrompt>
        <p>
          401은 토큰 만료·폐기·소진 가능성을, 403은 저장소나 프로젝트 slug 제한
          불일치 가능성을 먼저 확인합니다. 연결 오류는 <code>DEPLOYHUB_URL</code>,
          네트워크와 서버 상태를 확인합니다. 토큰 값을 AI에게 보여주면 안 됩니다.
        </p>
      </Section>

      <Section id="completion-report" title="AI의 완료 보고 예시">
        <p>AI에게 다음 형식으로 보고하도록 요청하면 승인 여부를 판단하기 쉽습니다.</p>
        <CopyablePrompt>{COMPLETION_REPORT}</CopyablePrompt>
        <p>
          Draft를 제출하지 않았다면 결과에 그 사실과 이유를 적고 Draft URL을 만들어
          쓰지 않도록 합니다. 검증 실패, 변경 없음, 토큰 또는 연결 문제도 구분합니다.
        </p>
      </Section>

      <Section id="references" title="더 자세한 문서">
        <ul className="space-y-3">
          <li>
            <Link
              href="https://github.com/gnghkim/DeployHub/blob/main/docs/project-registration.md"
              className="font-medium text-[var(--accent)] hover:underline"
            >
              프로젝트 등록 상세 가이드
            </Link>
            <span> — 토큰 발급, manifest 필드, Draft 동작과 오류별 상세 설명</span>
          </li>
          <li>
            <Link
              href="https://github.com/gnghkim/DeployHub/blob/main/templates/AGENTS.deployhub.md"
              className="font-medium text-[var(--accent)] hover:underline"
            >
              다른 저장소용 AGENTS 템플릿
            </Link>
            <span> — 대상 저장소에 추가할 수 있는 AI 작업 지침</span>
          </li>
        </ul>
      </Section>
    </>
  );
}

// Keep this native page aligned with docs/ai-project-registration-manual.md.
export default function ManualPage() {
  return (
    <>
      <Topbar title="사용 매뉴얼" />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_240px]">
          <article className="min-w-0 space-y-12">
            <header>
              <p className="text-sm font-medium text-[var(--accent)]">DeployHub Guide</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--line)]">
                AI에게 DeployHub 프로젝트 등록 맡기기
              </h2>
              <p className="mt-4 max-w-3xl leading-7">
                AI는 검증된 내용을 Draft로 제출하고, 최종 반영은 사용자가 Draft
                화면에서 검토·승인합니다.
              </p>
            </header>
            <ManualToc className="rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--paper)] p-5 lg:hidden" />
            {renderManualSections()}
          </article>
          <aside className="hidden lg:block">
            <ManualToc className="rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--paper)] p-5 lg:sticky lg:top-6" />
          </aside>
        </div>
      </main>
    </>
  );
}
