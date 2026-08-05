'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { reorderProjects } from '../../actions/projects';
import { moveItem } from '../../lib/move-item';

export type ProjectOrderItem = {
  id: string;
  name: string;
  node: ReactNode;
};

export function ProjectOrderList({ items }: { items: ProjectOrderItem[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [order, setOrder] = useState(() => items.map((item) => item.id));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const orderRef = useRef(order);

  // 서버가 새 목록을 보내면 (승인, 삭제, refresh) 낙관적 순서를 버린다.
  const serverOrder = items.map((item) => item.id).join('\n');
  useEffect(() => {
    const next = serverOrder ? serverOrder.split('\n') : [];
    setOrder(next);
    orderRef.current = next;
  }, [serverOrder]);

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  const save = useCallback((next: string[]) => {
    startTransition(async () => {
      const result = await reorderProjects(next);
      if (result.status !== 'success') router.refresh();
    });
  }, [router]);

  // 매번 살아 있는 DOM 을 읽는다. 미리 모아 둔 좌표는 재배치 직후
  // 어긋나므로, 항목이 수십 개인 이 화면에서는 이쪽이 더 안전하다.
  const indexAtPointer = useCallback((clientY: number): number => {
    const nodes = listRef.current?.children;
    if (!nodes) return -1;
    for (let index = 0; index < nodes.length; index += 1) {
      const rect = nodes[index]?.getBoundingClientRect();
      if (!rect) continue;
      if (clientY < rect.top + rect.height / 2) return index;
    }
    return nodes.length - 1;
  }, []);

  function handlePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    id: string,
  ) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingId(id);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!draggingId) return;
    const from = orderRef.current.indexOf(draggingId);
    const to = indexAtPointer(event.clientY);
    if (from === -1 || to === -1 || to === from) return;
    const next = moveItem(orderRef.current, from, to);
    orderRef.current = next;
    setOrder(next);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!draggingId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingId(null);
    save(orderRef.current);
  }

  function handleKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    item: ProjectOrderItem,
  ) {
    const from = orderRef.current.indexOf(item.id);
    if (from === -1) return;

    let to = from;
    switch (event.key) {
      case 'ArrowUp':
        to = from - 1;
        break;
      case 'ArrowDown':
        to = from + 1;
        break;
      default:
        return;
    }
    if (to < 0 || to >= orderRef.current.length) return;

    event.preventDefault();
    const next = moveItem(orderRef.current, from, to);
    orderRef.current = next;
    setOrder(next);
    setAnnouncement(`${item.name}, ${to + 1}번째`);
    save(next);
  }

  const itemById = new Map(items.map((item) => [item.id, item]));

  return (
    <>
      <ul ref={listRef} className="space-y-4">
        {order.map((id) => {
          const item = itemById.get(id);
          if (!item) return null;

          return (
            <li
              key={id}
              className={draggingId === id
                ? 'flex min-w-0 gap-2 opacity-60'
                : 'flex min-w-0 gap-2'}
            >
              <button
                type="button"
                aria-label={`${item.name} 순서 이동`}
                className="mt-4 h-7 w-5 shrink-0 cursor-grab touch-none rounded text-[var(--absent)] hover:bg-[var(--rule)] hover:text-[var(--line)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--line)]"
                onPointerDown={(event) => handlePointerDown(event, id)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onKeyDown={(event) => handleKeyDown(event, item)}
              >
                ⠿
              </button>
              <div className="min-w-0 flex-1">{item.node}</div>
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" className="sr-only">{announcement}</p>
    </>
  );
}
