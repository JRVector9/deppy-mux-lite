"use client";

import type { FormEvent, RefObject } from "react";

type MobileComposerBarCopy = {
  clear: string;
  composerPlaceholder: string;
  send: string;
};

type MobileComposerBarProps = {
  attachmentName: string;
  composer: string;
  composerError: string | null;
  composerInputRef: RefObject<HTMLInputElement | null>;
  copy: MobileComposerBarCopy;
  disabled: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  isSending: boolean;
  onChangeComposer: (value: string) => void;
  onClearAttachment: () => void;
  onOpenSkillPicker: () => void;
  onPickAttachment: (files: FileList | null) => void;
  onSubmit: () => void;
};

export function MobileComposerBar({
  attachmentName,
  composer,
  composerError,
  composerInputRef,
  copy,
  disabled,
  fileInputRef,
  isSending,
  onChangeComposer,
  onClearAttachment,
  onOpenSkillPicker,
  onPickAttachment,
  onSubmit,
}: MobileComposerBarProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <div className="web-access-no-x shrink-0 border-t border-[#1f1f1f] bg-[#0a0a0a] px-2 pb-[max(4px,env(safe-area-inset-bottom))] pt-1">
      {composerError ? (
        <div className="mb-1.5 rounded-lg border border-[#5a2d2d] bg-[#211010] px-2 py-1.5 text-xs leading-4 text-[#ffb6b6]">
          {composerError}
        </div>
      ) : null}
      {attachmentName ? (
        <div className="mb-1.5 flex min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#151515] px-2 py-1 text-xs text-[#a8a8a8]">
          <span className="h-5 w-5 shrink-0 rounded bg-gradient-to-br from-[#77a8ff] to-[#59d185]" />
          <span className="min-w-0 flex-1 truncate">{attachmentName}</span>
          <button
            aria-label={copy.clear}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-[#2a2a2a] bg-[#0b0b0b]"
            onClick={onClearAttachment}
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}
      <form
        className="grid min-w-0 grid-cols-[30px_30px_minmax(0,1fr)_34px] items-center gap-1"
        onSubmit={submit}
      >
        <input
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            onPickAttachment(event.target.files);
            event.currentTarget.value = "";
          }}
          ref={fileInputRef}
          type="file"
        />
        <button
          className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] text-sm font-semibold"
          disabled={isSending}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          +
        </button>
        <button
          className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-[#2a2a2a] bg-[#0b0b0b] text-sm font-semibold"
          disabled={isSending}
          onClick={onOpenSkillPicker}
          type="button"
        >
          /
        </button>
        <input
          autoComplete="off"
          className="h-[30px] min-w-0 rounded-lg border border-[#2a2a2a] bg-[#050505] px-2 text-[14px] text-[#f2f2f2] outline-none focus:border-[#5b5b5b] disabled:opacity-60"
          disabled={disabled}
          onChange={(event) => onChangeComposer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "/" && composer.length === 0) {
              onOpenSkillPicker();
            }
          }}
          placeholder={copy.composerPlaceholder}
          ref={composerInputRef}
          value={composer}
        />
        <button
          aria-label={copy.send}
          className="grid h-[30px] w-[34px] place-items-center rounded-lg bg-[#f5f5f5] text-sm font-extrabold text-[#080808] disabled:opacity-40"
          disabled={disabled || isSending}
          type="submit"
        >
          ↵
        </button>
      </form>
    </div>
  );
}
