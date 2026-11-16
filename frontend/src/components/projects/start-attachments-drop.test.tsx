/**
 * Files dropped or pasted onto the start box (15 Nov, Sean: "Can we have it so we
 * can copy n paste photos or drag to bring files into the chats or the
 * workspace?"), and the start buttons waiting while a file is read.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';

import { StartAttachments, type StartImage } from './start-attachments';
import { filesFrom, namedForPaste } from '@/hooks/use-file-drop';
import type { PreparedFile } from '@/lib/data/attachments';

function transfer(files: File[]): DataTransfer {
  return { files, items: [], types: ['Files'], dropEffect: 'none' } as unknown as DataTransfer;
}

function Harness({ onReading }: { onReading: (names: string[] | null) => void }) {
  const zone = useRef<HTMLDivElement | null>(null);
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [images, setImages] = useState<StartImage[]>([]);
  return (
    <div ref={zone} data-testid="zone">
      <textarea aria-label="goal" />
      <StartAttachments files={files} images={images} onFiles={setFiles} onImages={setImages} zone={zone} onReading={onReading} />
    </div>
  );
}

describe('drop and paste on the start box', () => {
  it('reads a dropped document as if it had been picked, and says what it is reading meanwhile', async () => {
    const reading = vi.fn();
    render(<Harness onReading={reading} />);
    const zone = screen.getByTestId('zone');
    const paper = new File(['\\section{Regge}\nThe measure.'], 'regge.tex', { type: 'text/x-tex' });
    await act(async () => {
      fireEvent.dragEnter(zone, { dataTransfer: transfer([paper]) });
    });
    expect(screen.getByText('Drop the files here to attach them.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: transfer([paper]) });
    });
    await waitFor(() => expect(screen.getByText('regge.tex')).toBeInTheDocument());
    expect(reading).toHaveBeenCalledWith(['regge.tex']);
    expect(reading).toHaveBeenLastCalledWith(null);
  });

  it('takes a pasted file, and leaves a paste of plain text alone', async () => {
    render(<Harness onReading={() => undefined} />);
    const box = screen.getByLabelText('goal');
    const note = new File(['Margin fell.'], 'notes.md', { type: 'text/markdown' });
    await act(async () => {
      fireEvent.paste(box, { clipboardData: transfer([note]) });
    });
    await waitFor(() => expect(screen.getByText('notes.md')).toBeInTheDocument());
    const plain = { files: [], items: [], types: ['text/plain'] } as unknown as DataTransfer;
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: plain });
    box.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('a paste or drop outside the start box (16 Nov, hand pass)', () => {
  function Page() {
    return (
      <>
        <textarea aria-label="elsewhere" />
        <p>Blank space</p>
        <Harness onReading={() => undefined} />
      </>
    );
  }

  it('takes a paste made with the focus on the page itself', async () => {
    render(<Page />);
    const shot = new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.paste(document.body, { clipboardData: transfer([shot]) });
    });
    await waitFor(() => expect(screen.getByText(/^pasted-.*\.png$/)).toBeInTheDocument());
  });

  it('leaves a paste into a text box that is not the start box to that box', async () => {
    render(<Page />);
    const note = new File(['Margin fell.'], 'notes.md', { type: 'text/markdown' });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: transfer([note]) });
    await act(async () => {
      screen.getByLabelText('elsewhere').dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByText('notes.md')).toBeNull();
  });

  it('keeps a file dropped beside the box instead of letting the browser open it', async () => {
    render(<Page />);
    const paper = new File(['Fog came in at six.'], 'harbour.txt', { type: 'text/plain' });
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(over, 'dataTransfer', { value: transfer([paper]) });
    screen.getByText('Blank space').dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    await act(async () => {
      fireEvent.drop(screen.getByText('Blank space'), { dataTransfer: transfer([paper]) });
    });
    await waitFor(() => expect(screen.getByText('harbour.txt')).toBeInTheDocument());
  });
});

describe('files in a paste', () => {
  it('finds a screenshot that is only in the items', () => {
    const shot = new File([new Uint8Array([1])], 'image.png', { type: 'image/png' });
    const data = { files: [], items: [{ kind: 'file', getAsFile: () => shot }, { kind: 'string', getAsFile: () => null }] } as unknown as DataTransfer;
    expect(filesFrom(data)).toEqual([shot]);
  });

  it('names a pasted screenshot by when it was pasted, so two do not clash', () => {
    const shot = new File([new Uint8Array([1])], 'image.png', { type: 'image/png' });
    expect(namedForPaste(shot, new Date('2026-11-15T10:20:30Z')).name).toBe('pasted-2026-11-15T10-20-30.png');
    const named = new File(['x'], 'paper.pdf', { type: 'application/pdf' });
    expect(namedForPaste(named)).toBe(named);
  });
});
