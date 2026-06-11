import { useCallback, useState } from "react";
import { LuKeyboard, LuMousePointerClick, LuMoreHorizontal, LuScroll } from "react-icons/lu";
import { BsMouseFill } from "react-icons/bs";

import { cx } from "@/cva.config";
import { m } from "@localizations/messages.js";
import { useUiStore } from "@hooks/stores";
import useKeyboard from "@hooks/useKeyboard";
import MobileKeyboardTrigger from "@components/MobileKeyboardTrigger";

interface ToolbarButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}

function ToolbarButton({ icon, label, onClick, active }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex flex-1 flex-col items-center justify-center gap-y-0.5 rounded-lg py-2 transition-colors",
        active
          ? "bg-blue-600 text-white"
          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700",
      )}
    >
      <span className="text-xl">{icon}</span>
      <span className="text-[10px] leading-none font-medium">{label}</span>
    </button>
  );
}

interface MoreMenuProps {
  onCtrlAltDel: () => void;
  onClose: () => void;
}

function MoreMenu({ onCtrlAltDel, onClose }: MoreMenuProps) {
  return (
    <div
      className="absolute right-0 bottom-full left-0 mb-1 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800"
      onClick={onClose}
    >
      <button
        type="button"
        className="flex w-full items-center gap-x-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
        onClick={e => {
          e.stopPropagation();
          onCtrlAltDel();
          onClose();
        }}
      >
        <BsMouseFill className="h-4 w-4 text-slate-500" />
        Ctrl + Alt + Del
      </button>
    </div>
  );
}

/**
 * Compact toolbar rendered at the bottom of the screen when the device is in
 * mobile mode.  Provides quick access to:
 *
 * - Native on-screen keyboard (via MobileKeyboardTrigger)
 * - Right-click: next single-finger tap sends a right-click
 * - Scroll mode: one-finger drag sends scroll events instead of cursor movement
 * - More: Ctrl+Alt+Del and other infrequent actions
 */
export default function MobileToolbar() {
  const { rightClickNextTap, setRightClickNextTap, touchMode, setTouchMode } = useUiStore();
  const { executeMacro } = useKeyboard();

  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  const toggleTouchMode = useCallback(() => {
    setTouchMode(touchMode === "trackpad" ? "direct" : "trackpad");
  }, [touchMode, setTouchMode]);

  const handleCtrlAltDel = useCallback(async () => {
    await executeMacro([{ keys: ["Delete"], modifiers: ["ControlLeft", "AltLeft"], delay: 100 }]);
  }, [executeMacro]);

  return (
    <div className="relative">
      {isMoreOpen && (
        <MoreMenu onCtrlAltDel={handleCtrlAltDel} onClose={() => setIsMoreOpen(false)} />
      )}

      <div className="flex items-stretch gap-x-1 border-t border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
        <ToolbarButton
          icon={<LuKeyboard />}
          label={m.mobile_keyboard()}
          onClick={() => setIsKeyboardOpen(prev => !prev)}
          active={isKeyboardOpen}
        />
        <ToolbarButton
          icon={<LuMousePointerClick />}
          label={rightClickNextTap ? m.mobile_right_click_next_tap() : m.mobile_right_click()}
          onClick={() => setRightClickNextTap(!rightClickNextTap)}
          active={rightClickNextTap}
        />
        <ToolbarButton
          icon={<LuScroll />}
          label={
            touchMode === "direct" ? m.mobile_touch_mode_direct() : m.mobile_touch_mode_trackpad()
          }
          onClick={toggleTouchMode}
          active={touchMode === "direct"}
        />
        <ToolbarButton
          icon={<LuMoreHorizontal />}
          label={m.mobile_more()}
          onClick={() => setIsMoreOpen(prev => !prev)}
          active={isMoreOpen}
        />
      </div>

      <MobileKeyboardTrigger isOpen={isKeyboardOpen} onClose={() => setIsKeyboardOpen(false)} />
    </div>
  );
}
