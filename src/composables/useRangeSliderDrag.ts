/**
 * M3E 滑块的自定义指针拖拽逻辑。
 *
 * M3E 的 `m3e-slider` 依赖自身 Shadow DOM 的拖拽实现，在部分 WebView 下
 * 拖动拇指以外的轨道区域不会跟手，因此两个对话框/设置页都在宿主元素上补了
 * 「按下即定位、移动跟随」的指针处理。这里把这段完全相同的逻辑收敛到一处：
 *
 * - `pointerdown`：记录指针、捕获指针、立即预览一次；
 * - `pointermove`：转换为数值后只做预览（不落盘）；
 * - `pointerup` / `pointercancel`：清理监听与指针捕获，并提交最终数值；
 * - 组件卸载时清理，避免残留监听。
 *
 * 数值换算（比例 → 业务值、取整、步进）由调用方的 `resolveValue` 决定。
 */
import { onScopeDispose } from "vue";

export type RangeSliderValueResolver = (event: PointerEvent, rect: DOMRect) => number;

export interface UseRangeSliderDragOptions {
  /** 返回滑块宿主元素（用于坐标换算与指针捕获）。 */
  slider: () => HTMLElement | null;
  /** 根据指针位置与滑块矩形换算滑块数值。 */
  resolveValue: RangeSliderValueResolver;
  /** 拖动过程中的预览回调，不应落盘。 */
  onPreview: (value: number) => void;
  /** 指针释放后的提交回调，负责落盘。 */
  onCommit: (value: number) => void;
}

export interface RangeSliderDrag {
  /** 绑定到滑块宿主的 `pointerdown`。 */
  onPointerDown: (event: PointerEvent) => void;
}

type ActiveDrag = {
  slider: HTMLElement;
  pointerId: number;
  lastValue: number;
};

export function useRangeSliderDrag(options: UseRangeSliderDragOptions): RangeSliderDrag {
  let active: ActiveDrag | null = null;

  function readValue(event: PointerEvent, slider: HTMLElement): number {
    return options.resolveValue(event, slider.getBoundingClientRect());
  }

  function handleMove(event: PointerEvent): void {
    if (!active || event.pointerId !== active.pointerId) return;
    const value = readValue(event, active.slider);
    active.lastValue = value;
    options.onPreview(value);
  }

  function finish(event: PointerEvent): void {
    if (!active || event.pointerId !== active.pointerId) return;
    const drag = active;
    active = null;
    drag.slider.removeEventListener("pointermove", handleMove);
    drag.slider.removeEventListener("pointerup", finish);
    drag.slider.removeEventListener("pointercancel", finish);
    if (drag.slider.hasPointerCapture(drag.pointerId)) {
      drag.slider.releasePointerCapture(drag.pointerId);
    }
    options.onPreview(drag.lastValue);
    options.onCommit(drag.lastValue);
  }

  function cleanup(): void {
    if (!active) return;
    const drag = active;
    active = null;
    drag.slider.removeEventListener("pointermove", handleMove);
    drag.slider.removeEventListener("pointerup", finish);
    drag.slider.removeEventListener("pointercancel", finish);
    if (drag.slider.hasPointerCapture(drag.pointerId)) {
      drag.slider.releasePointerCapture(drag.pointerId);
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const slider = options.slider();
    if (!slider) return;
    cleanup();
    event.preventDefault();
    const value = readValue(event, slider);
    active = { slider, pointerId: event.pointerId, lastValue: value };
    slider.setPointerCapture(event.pointerId);
    slider.addEventListener("pointermove", handleMove);
    slider.addEventListener("pointerup", finish);
    slider.addEventListener("pointercancel", finish);
    options.onPreview(value);
  }

  onScopeDispose(cleanup);

  return { onPointerDown };
}
