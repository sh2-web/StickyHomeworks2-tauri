import { invoke, isTauri } from "@tauri-apps/api/core";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { onUnmounted, ref } from "vue";
import { flushLogs, logError, logInfo } from "../services/logging";

/**
 * 桌面贴纸窗口的控制。
 *
 * 窗口位置/尺寸的持久化已交给 Rust 侧的 `tauri-plugin-window-state`，
 * 这里不再采集/落盘几何，只负责窗口控制与最大化状态同步。
 */
export function useDesktopWindowControls() {
  const isDesktopWindow = ref(false);
  const isUnlocked = ref(false);
  const isMaximized = ref(false);
  const error = ref("");
  let unlistenResized: (() => void) | undefined;
  let isClosing = false;

  function reportFailure(reason?: unknown) {
    logError("window.control.failure", reason ?? "窗口操作失败");
    error.value = "窗口操作失败，请重试。";
  }

  async function syncMaximized(window: Window) {
    isMaximized.value = await window.isMaximized();
  }

  async function runWindowAction(operation: string, action: (window: Window) => Promise<void>) {
    if (!isDesktopWindow.value) return false;

    try {
      await action(getCurrentWindow());
      error.value = "";
      logInfo(operation, "窗口操作完成");
      return true;
    } catch (reason) {
      reportFailure(reason);
      return false;
    }
  }

  async function setAlwaysOnBottom(alwaysOnBottom: boolean) {
    return runWindowAction("window.always-on-bottom", (window) => window.setAlwaysOnBottom(alwaysOnBottom));
  }

  async function initialize(isMobileRuntime: boolean, alwaysOnBottom: boolean) {
    isDesktopWindow.value = isTauri() && !isMobileRuntime;
    if (!isDesktopWindow.value) return;

    try {
      const appWindow = getCurrentWindow();
      await appWindow.setResizable(false);
      await appWindow.setAlwaysOnBottom(alwaysOnBottom);
      await syncMaximized(appWindow);
      unlistenResized?.();
      // 只同步最大化状态：位置/尺寸由 window-state 插件负责持久化与恢复。
      unlistenResized = await appWindow.onResized(() => {
        if (isClosing) return;
        void syncMaximized(appWindow).catch(reportFailure);
      });
    } catch (reason) {
      reportFailure(reason);
    }
  }

  async function close() {
    if (isClosing) return;
    isClosing = true;
    unlistenResized?.();
    await flushLogs();
    // 关闭窗口 = 退出应用。这里显式调用 quit_application（app.exit），
    // 而不是只关闭窗口：tray-menu 是常驻隐藏窗口，只关窗口会让进程留在后台。
    try {
      await invoke("quit_application");
      return;
    } catch (error) {
      logError("window.exit.failure", error);
    }
    // 兜底：命令不可用时退回关闭当前窗口（Rust 侧 CloseRequested 也会触发退出）。
    const closed = await runWindowAction("window.close", (window) => window.close());
    if (!closed) isClosing = false;
  }

  async function startDragging() {
    return runWindowAction("window.drag-start", (window) => window.startDragging());
  }

  async function minimize() {
    await runWindowAction("window.minimize", (window) => window.minimize());
  }

  async function toggleMaximize() {
    await runWindowAction("window.maximize-toggle", async (window) => {
      await window.toggleMaximize();
      await syncMaximized(window);
    });
  }

  async function toggleUnlocked() {
    await runWindowAction("window.unlock-toggle", async (window) => {
      const nextUnlocked = !isUnlocked.value;

      await window.setResizable(nextUnlocked);
      isUnlocked.value = nextUnlocked;
      await syncMaximized(window);
    });
  }

  onUnmounted(() => {
    unlistenResized?.();
  });

  /** 屏幕坐标（CSS px，相对屏幕原点）。 */
  type ScreenPoint = { x: number; y: number };

  /**
   * 手动拖动窗口（触摸/笔）。
   *
   * 原生 `start_dragging()` 在 Windows 上走的是标题栏移动循环
   * （`ReleaseCapture` + `WM_NCLBUTTONDOWN`/`HTCAPTION`），触摸输入不会进入该系统
   * 模态循环，所以触控 PC 上窗口拖不动（tao `drag_window` 的行为，Tauri 只是转发）。
   * 这里改为监听 pointer/touch 事件、累加屏幕坐标，并用 `setPosition` 直接移动窗口。
   *
   * 用 `screenX/screenY` 而不是 `clientX/clientY`：窗口在手指下移动时客户区坐标会变，
   * 屏幕坐标不会，避免自反馈漂移。
   */
  async function startManualWindowDrag(
    initial: ScreenPoint,
    subscribe: (handlers: { move: (point: ScreenPoint) => void; end: () => void }) => () => void,
  ) {
    if (!isDesktopWindow.value) return;
    const appWindow = getCurrentWindow();
    try {
      const [startPosition, scaleFactor] = await Promise.all([
        appWindow.outerPosition(),
        appWindow.scaleFactor(),
      ]);
      let lastX = startPosition.x;
      let lastY = startPosition.y;
      let frame: number | undefined;
      let pending: ScreenPoint | null = null;
      let inflight = false;
      let finished = false;
      let unsubscribe: () => void = () => undefined;

      const flush = () => {
        frame = undefined;
        if (finished || inflight || !pending) return;
        const point = pending;
        pending = null;
        const x = Math.round(startPosition.x + (point.x - initial.x) * scaleFactor);
        const y = Math.round(startPosition.y + (point.y - initial.y) * scaleFactor);
        if (x === lastX && y === lastY) return;
        lastX = x;
        lastY = y;
        inflight = true;
        void appWindow
          .setPosition(new PhysicalPosition(x, y))
          .catch(reportFailure)
          .finally(() => {
            inflight = false;
            // 拖动过程中如果还有更新的位置，等上一次 IPC 返回后再发下一帧，避免堆积。
            if (!finished && pending !== null && frame === undefined) {
              frame = window.requestAnimationFrame(flush);
            }
          });
      };

      const stop = () => {
        if (finished) return;
        finished = true;
        if (frame !== undefined) window.cancelAnimationFrame(frame);
        frame = undefined;
        pending = null;
        unsubscribe();
        logInfo("window.drag.manual.end", "触摸/笔拖动窗口结束");
      };

      unsubscribe = subscribe({
        move: (point) => {
          if (finished) return;
          pending = point;
          if (frame === undefined) frame = window.requestAnimationFrame(flush);
        },
        end: stop,
      });
      logInfo("window.drag.manual.start", "触摸/笔拖动窗口开始");
    } catch (reason) {
      reportFailure(reason);
    }
  }

  /** 触控/触控笔拖动入口（PointerEvent）。 */
  function startPointerWindowDrag(event: PointerEvent, captureTarget: HTMLElement) {
    const pointerId = event.pointerId;
    const initial = { x: event.screenX, y: event.screenY };
    try {
      captureTarget.setPointerCapture(pointerId);
    } catch {
      // 不支持捕获时退化为普通监听（手指移出元素后可能提前结束）。
    }
    void startManualWindowDrag(initial, ({ move, end }) => {
      const handleMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        moveEvent.preventDefault();
        move({ x: moveEvent.screenX, y: moveEvent.screenY });
      };
      const handleEnd = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) return;
        end();
      };
      captureTarget.addEventListener("pointermove", handleMove, { passive: false });
      captureTarget.addEventListener("pointerup", handleEnd);
      captureTarget.addEventListener("pointercancel", handleEnd);
      return () => {
        captureTarget.removeEventListener("pointermove", handleMove);
        captureTarget.removeEventListener("pointerup", handleEnd);
        captureTarget.removeEventListener("pointercancel", handleEnd);
        try {
          captureTarget.releasePointerCapture(pointerId);
        } catch {
          // 已释放
        }
      };
    });
  }

  /** 老内核的 TouchEvent 兜底（仅在 PointerEvent 不可用时使用）。 */
  function startTouchWindowDrag(event: TouchEvent, captureTarget: HTMLElement) {
    const touch = event.changedTouches[0] ?? event.touches[0];
    if (!touch) return;
    const touchId = touch.identifier;
    const initial = { x: touch.screenX, y: touch.screenY };
    void startManualWindowDrag(initial, ({ move, end }) => {
      const findTouch = (list: TouchList) =>
        Array.from(list).find((item) => item.identifier === touchId);
      const handleMove = (moveEvent: TouchEvent) => {
        const current = findTouch(moveEvent.touches);
        if (!current) return;
        moveEvent.preventDefault();
        move({ x: current.screenX, y: current.screenY });
      };
      const handleEnd = (endEvent: TouchEvent) => {
        if (!findTouch(endEvent.changedTouches)) return;
        end();
      };
      captureTarget.addEventListener("touchmove", handleMove, { passive: false });
      captureTarget.addEventListener("touchend", handleEnd);
      captureTarget.addEventListener("touchcancel", handleEnd);
      window.addEventListener("touchend", handleEnd);
      window.addEventListener("touchcancel", handleEnd);
      return () => {
        captureTarget.removeEventListener("touchmove", handleMove);
        captureTarget.removeEventListener("touchend", handleEnd);
        captureTarget.removeEventListener("touchcancel", handleEnd);
        window.removeEventListener("touchend", handleEnd);
        window.removeEventListener("touchcancel", handleEnd);
      };
    });
  }

  return {
    isDesktopWindow,
    isUnlocked,
    isMaximized,
    error,
    initialize,
    close,
    setAlwaysOnBottom,
    minimize,
    toggleMaximize,
    toggleUnlocked,
    startDragging,
    startPointerWindowDrag,
    startTouchWindowDrag,
  };
}
