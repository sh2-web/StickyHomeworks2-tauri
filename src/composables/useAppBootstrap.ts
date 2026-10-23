/**
 * 应用壳层启动流程装配。
 *
 * 负责：视口宽度与 resize 监听、运行环境检测（桌面/移动）、抽屉溢出策略、
 * 运行时事件监听（`load()` 之后注册，避免默认空数据被事件写盘）、数据加载与
 * 错误态、Glycoprotein 初始化、窗口控制初始化与「置底」watch，以及窗口启动
 * 隐藏后的显示（含 3 秒兜底）。
 *
 * 由 `AppShell` 在 setup 阶段调用，`start()` 放在 `onMounted`、`dispose()` 放在
 * `onUnmounted`，行为与拆分前的内联实现一致。
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, nextTick, ref, watch, type Ref } from "vue";
import { setDrawerContentOverflow } from "../m3e-internals";
import { initializeGlycoprotein, listenGlycoproteinWindowSettings } from "../services/glycoprotein";
import { logInfo, logWarn } from "../services/logging";
import type { AppData, AppSettings } from "../types/app-data";
import { MOBILE_LAYOUT_MAX_WIDTH, isBelow } from "../ui/breakpoints";
import type { WindowGeometryPatch } from "./useDesktopWindowControls";

type AppBootstrapOptions = {
  appData: Ref<AppData>;
  appDrawer: Ref<HTMLElement | null>;
  /** 当前一级导航（"homeworks" | "templates" | "settings"），用于抽屉内容溢出策略。 */
  activeNavigation: () => string;
  load: () => Promise<void>;
  updateSettings: (mutate: (settings: AppSettings) => AppSettings) => Promise<void>;
  initializeWindowControls: (
    isMobileRuntime: boolean,
    alwaysOnBottom: boolean,
    onGeometryChanged?: (patch: WindowGeometryPatch) => void | Promise<void>,
  ) => Promise<void>;
  setAlwaysOnBottom: (alwaysOnBottom: boolean) => Promise<boolean>;
  navigate: (path: string) => void;
};

/** 哪怕数据加载迟迟不结束，也要在 3 秒后显示主窗口，避免窗口永远不可见。 */
const WINDOW_SHOW_FALLBACK_MS = 3000;

export function useAppBootstrap(options: AppBootstrapOptions) {
  const isMobileRuntime = ref(false);
  const viewportWidth = ref(0);
  const loadError = ref("");
  const isMobileLayout = computed(() =>
    isMobileRuntime.value && isBelow(viewportWidth.value, MOBILE_LAYOUT_MAX_WIDTH),
  );

  let stopAlwaysOnBottomWatch: (() => void) | undefined;
  let stopMainNavigate: (() => void) | undefined;
  let unlistenGlycoproteinWindowSettings: (() => void) | undefined;
  let showFallbackTimer: number | undefined;
  let disposed = false;

  function updateViewportWidth() {
    viewportWidth.value = window.innerWidth;
  }

  function syncDrawerContentOverflow() {
    const isHomeworkHome = options.activeNavigation() === "homeworks";
    setDrawerContentOverflow(options.appDrawer.value, {
      x: isHomeworkHome ? "hidden" : "",
      y: isHomeworkHome ? "hidden" : "",
    });
  }

  function preserveMobileScrollPosition() {
    if (!isMobileLayout.value) return;

    const scrollTargets = [
      document.scrollingElement,
      options.appDrawer.value?.shadowRoot?.querySelector<HTMLElement>(".content"),
    ].filter((target): target is HTMLElement => target instanceof HTMLElement);
    const positions = scrollTargets.map((target) => ({ target, left: target.scrollLeft, top: target.scrollTop }));
    const restore = () => positions.forEach(({ target, left, top }) => target.scrollTo(left, top));

    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
  }

  async function detectMobileRuntime() {
    const layoutOverride = new URLSearchParams(window.location.search).get("layout");
    if (import.meta.env.DEV && (layoutOverride === "mobile" || layoutOverride === "desktop")) {
      return layoutOverride === "mobile";
    }

    try {
      return (await invoke<"desktop" | "mobile">("runtime_layout")) === "mobile";
    } catch (error) {
      logWarn("runtime.layout.failure", error instanceof Error ? error.message : "runtime layout command failed");
      return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    }
  }

  function mergeSettingsPatch(settings: AppSettings, patch: Partial<AppSettings>): AppSettings {
    const isUnchanged = Object.entries(patch).every(([key, value]) =>
      settings[key as keyof AppSettings] === value,
    );
    return isUnchanged ? settings : { ...settings, ...patch };
  }

  function persistWindowGeometry(geometry: WindowGeometryPatch): Promise<void> {
    return options.updateSettings((settings) => mergeSettingsPatch(settings, geometry));
  }

  function clearWindowShowFallback() {
    if (showFallbackTimer === undefined) return;
    window.clearTimeout(showFallbackTimer);
    showFallbackTimer = undefined;
  }

  /**
   * tauri.conf.json 里主窗口为 `visible: false`（避免启动白屏），数据加载完成后
   * 由前端显示窗口。用户此前通过托盘隐藏窗口时（windowVisible=false）保持隐藏，
   * 与 Rust 侧 apply_window_settings 的语义一致。
   */
  async function revealMainWindow(source: "load-complete" | "load-fallback") {
    clearWindowShowFallback();
    if (isMobileRuntime.value || !isTauri()) return;
    if (!options.appData.value.settings.windowVisible) return;

    try {
      await getCurrentWindow().show();
      logInfo("window.show", `主窗口已显示（${source}）`);
    } catch (error) {
      logWarn("window.show.failure", error instanceof Error ? error.message : String(error));
    }
  }

  function scheduleWindowShowFallback() {
    if (isMobileRuntime.value || !isTauri()) return;
    clearWindowShowFallback();
    showFallbackTimer = window.setTimeout(() => {
      void revealMainWindow("load-fallback");
    }, WINDOW_SHOW_FALLBACK_MS);
  }

  async function registerRuntimeListeners() {
    try {
      unlistenGlycoproteinWindowSettings = await listenGlycoproteinWindowSettings((patch) => {
        void options.updateSettings((settings) => mergeSettingsPatch(settings, patch)).catch((error) => {
          logWarn("glycoprotein.window-settings.save.failure", error instanceof Error ? error.message : String(error));
        });
      });
    } catch (error) {
      logWarn("glycoprotein.window-settings.listen.failure", error instanceof Error ? error.message : String(error));
    }
    try {
      stopMainNavigate = await listen<string>("main-navigate", ({ payload }) => { options.navigate(payload); });
    } catch (error) {
      logWarn("navigation.listen.failure", error instanceof Error ? error.message : String(error));
    }
  }

  async function start() {
    if (disposed) return;

    updateViewportWidth();
    window.addEventListener("resize", updateViewportWidth);
    isMobileRuntime.value = await detectMobileRuntime();
    await nextTick();
    syncDrawerContentOverflow();

    // 兜底计时器在加载前启动：即使 load() 永远不结束，窗口也会显示。
    scheduleWindowShowFallback();

    try {
      await options.load();
      logInfo("app.start", "应用数据加载完成");
    } catch {
      loadError.value = "无法读取本地数据。请检查应用数据目录后重试。";
    }
    await revealMainWindow("load-complete");

    if (!isMobileRuntime.value) {
      // 必须在 load() 之后注册：此前列表为空，事件会把默认空数据写盘。
      // 成功/失败都注册，保持事件通道可用。
      await registerRuntimeListeners();
      try {
        await initializeGlycoprotein();
      } catch (error) {
        logWarn("glycoprotein.initialize.failure", error instanceof Error ? error.message : String(error));
      }
    }

    await options.initializeWindowControls(
      isMobileRuntime.value,
      options.appData.value.settings.alwaysOnBottom,
      persistWindowGeometry,
    );
    stopAlwaysOnBottomWatch = watch(() => options.appData.value.settings.alwaysOnBottom, (alwaysOnBottom) => {
      void options.setAlwaysOnBottom(alwaysOnBottom);
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearWindowShowFallback();
    window.removeEventListener("resize", updateViewportWidth);
    stopAlwaysOnBottomWatch?.();
    stopAlwaysOnBottomWatch = undefined;
    stopMainNavigate?.();
    stopMainNavigate = undefined;
    unlistenGlycoproteinWindowSettings?.();
    unlistenGlycoproteinWindowSettings = undefined;
  }

  // 抽屉内容溢出策略跟随导航与布局变化（拆分前位于 AppShell 顶层 watch）。
  watch(() => options.activeNavigation(), () => nextTick(syncDrawerContentOverflow));
  watch(isMobileLayout, () => nextTick(syncDrawerContentOverflow));

  return {
    isMobileRuntime,
    isMobileLayout,
    viewportWidth,
    loadError,
    syncDrawerContentOverflow,
    preserveMobileScrollPosition,
    start,
    dispose,
  };
}
