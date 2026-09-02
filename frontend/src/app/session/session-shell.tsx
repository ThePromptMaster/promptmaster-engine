'use client';

import { useState } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { TopNav } from '@/components/layout/top-nav';
import { TutorialProvider } from '@/components/tutorial/tutorial-provider';
import { ChatPanel } from '@/components/chat/chat-panel';
import { ChatPanelToggle } from '@/components/chat/chat-panel-toggle';
import { useSessionStore } from '@/stores/session-store';
import { useSessionAutosave } from '@/lib/persistence/use-session-autosave';

export function SessionShell({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useSessionAutosave();

  const phase = useSessionStore((s) => s.phase);
  const chatPanelOpen = useSessionStore((s) => s.chatPanelOpen);
  const toggleChatPanel = useSessionStore((s) => s.toggleChatPanel);

  const showChatRail = phase === 'output' && chatPanelOpen;

  return (
    <TutorialProvider>
      <div className="flex min-h-screen">
        {/* Desktop sidebar — hidden on mobile */}
        <div className="hidden md:block">
          <Sidebar />
        </div>

        {/* Mobile sidebar overlay */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-[90] md:hidden">
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="relative z-10 w-[280px] h-full">
              <Sidebar onNavigate={() => setMobileMenuOpen(false)} />
            </div>
          </div>
        )}

        <TopNav onMenuToggle={() => setMobileMenuOpen((v) => !v)} />

        <main
          className={`md:ml-[260px] pt-16 md:pt-24 pb-20 px-4 md:px-8 flex-1 w-full transition-all ${
            showChatRail ? 'md:pr-[396px]' : ''
          }`}
        >
          <div className="content-well">
            {children}
          </div>
        </main>

        {/* Chat panel — only rendered on Output phase, only when open */}
        <ChatPanel />

        {/* Floating toggle when panel is closed and we're on Output phase */}
        {phase === 'output' && !chatPanelOpen && (
          <ChatPanelToggle isOpen={chatPanelOpen} onToggle={toggleChatPanel} />
        )}
      </div>
    </TutorialProvider>
  );
}
