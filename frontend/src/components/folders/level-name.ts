'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import type { MessageKey } from '@/lib/i18n/messages/en';
import type { FolderLevel } from '@/lib/folders/inheritance';

/** "Client “Acme”": a folder named with what it stands for, in the interface's language. */
export function useLevelName() {
  const t = useT();
  return (level: Pick<FolderLevel, 'name' | 'kind'>) => t(`frules.lvl.${level.kind ?? 'folder'}` as MessageKey, { name: level.name });
}
