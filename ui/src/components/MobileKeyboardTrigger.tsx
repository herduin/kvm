import { useCallback, useEffect, useRef } from "react";

import useKeyboard, { type MacroStep } from "@hooks/useKeyboard";
import useKeyboardLayout from "@hooks/useKeyboardLayout";
import { useHidStore } from "@hooks/stores";
import { keys } from "@/keyboardMappings";

interface MobileKeyboardTriggerProps {
  /** When true the hidden input is focused so the native on-screen keyboard appears. */
  isOpen: boolean;
  /** Called when the keyboard is dismissed (e.g. user taps outside or presses Done). */
  onClose: () => void;
}

/**
 * An invisible `<textarea>` that, when focused, triggers the device's native
 * on-screen keyboard (ideal for iOS).  Characters typed on the native keyboard
 * are converted to HID macro steps using the active keyboard layout and sent
 * to the remote host, exactly like the paste modal does for pasted text.
 *
 * Special keys that *do* fire `keydown` events on iOS (Enter, Backspace,
 * arrow keys, Escape, Tab) are handled directly via `keydown`.
 *
 * All other characters arrive via the `input` event's `data` property and are
 * forwarded through the keyboard-layout character map so that accented
 * characters and shifted characters are typed correctly.
 */
export default function MobileKeyboardTrigger({ isOpen, onClose }: MobileKeyboardTriggerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { executeMacro } = useKeyboard();
  const { setVirtualKeyboardEnabled } = useHidStore();
  const { selectedKeyboard } = useKeyboardLayout();

  // Keep a stable ref to executeMacro so the event handler closure never goes stale
  const executeMacroRef = useRef(executeMacro);
  const selectedKeyboardRef = useRef(selectedKeyboard);
  executeMacroRef.current = executeMacro;
  selectedKeyboardRef.current = selectedKeyboard;

  // Focus / blur based on isOpen
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (isOpen) {
      // Small delay so iOS doesn't eat the programmatic focus
      const t = setTimeout(() => el.focus(), 50);
      return () => clearTimeout(t);
    } else {
      el.blur();
    }
  }, [isOpen]);

  // Disable the visual virtual keyboard while the native one is open so
  // they don't overlap.
  useEffect(() => {
    if (isOpen) setVirtualKeyboardEnabled(false);
  }, [isOpen, setVirtualKeyboardEnabled]);

  // ── keydown: special keys that iOS reliably fires as keydown events ────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();

    const SPECIAL: Record<string, string> = {
      Enter: "Enter",
      Backspace: "Backspace",
      Delete: "Delete",
      Escape: "Escape",
      Tab: "Tab",
      ArrowUp: "ArrowUp",
      ArrowDown: "ArrowDown",
      ArrowLeft: "ArrowLeft",
      ArrowRight: "ArrowRight",
      Home: "Home",
      End: "End",
      PageUp: "PageUp",
      PageDown: "PageDown",
    };

    const mapped = SPECIAL[e.key];
    if (mapped && keys[mapped] !== undefined) {
      e.preventDefault();
      void executeMacroRef.current([{ keys: [mapped], modifiers: null, delay: 20 }]);
    }
  }, []);

  // ── input: regular printable characters typed on the native keyboard ───────
  const handleInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const inputEvent = e.nativeEvent as InputEvent;

    // Deletions are handled by keydown (Backspace)
    if (inputEvent.inputType === "deleteContentBackward") {
      // Reset to empty so subsequent deletes keep firing
      (e.target as HTMLTextAreaElement).value = "";
      return;
    }

    const data = inputEvent.data;
    if (!data) return;

    const kb = selectedKeyboardRef.current;
    const macroSteps: MacroStep[] = [];

    for (const char of data) {
      const normalized = char.normalize("NFC");
      const keyprops = kb?.chars[normalized];
      if (!keyprops?.key) continue;

      const { key, shift, altRight, deadKey, accentKey } = keyprops;

      if (accentKey) {
        const accentMods: string[] = [];
        if (accentKey.shift) accentMods.push("ShiftLeft");
        if (accentKey.altRight) accentMods.push("AltRight");
        macroSteps.push({
          keys: [String(accentKey.key)],
          modifiers: accentMods.length > 0 ? accentMods : null,
          delay: 20,
        });
      }

      const mods: string[] = [];
      if (shift) mods.push("ShiftLeft");
      if (altRight) mods.push("AltRight");

      macroSteps.push({
        keys: [String(key)],
        modifiers: mods.length > 0 ? mods : null,
        delay: 20,
      });

      if (deadKey) macroSteps.push({ keys: ["Space"], modifiers: null, delay: 20 });
    }

    if (macroSteps.length > 0) {
      void executeMacroRef.current(macroSteps);
    }

    // Reset the textarea so future events keep firing
    (e.target as HTMLTextAreaElement).value = "";
  }, []);

  const handleBlur = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <textarea
      ref={inputRef}
      aria-hidden="true"
      // Keep completely invisible – we only want the native keyboard
      className="pointer-events-none fixed top-0 left-0 h-px w-px opacity-0"
      tabIndex={-1}
      autoComplete="off"
      autoCorrect="off"
      // @ts-expect-error – non-standard but needed to stop iOS capitalisation / corrections
      autoCapitalize="none"
      spellCheck={false}
      onKeyDown={handleKeyDown}
      onInput={handleInput}
      onBlur={handleBlur}
      // Stop the regular document keydown/keyup handlers from seeing these events
      onKeyUp={e => e.stopPropagation()}
    />
  );
}
