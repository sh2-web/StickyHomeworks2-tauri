/**
 * JS 侧布局断点常量。
 *
 * 这些断点只用于运行时布局判断（`window.innerWidth`）；CSS 媒体查询仍由样式文件
 * 自行声明，不读取本文件，避免样式层与脚本层互相耦合。
 *
 * 历史遗留的 600/700/950 魔法数字统一收敛到这里，改窗口布局时只需要调整此处。
 */

/** 移动布局上限：窗口宽度低于该值时使用移动（单栏）布局。 */
export const MOBILE_LAYOUT_MAX_WIDTH = 950;

/** 设置页左右分栏的最小宽度：低于该值时折叠为单栏。 */
export const SPLIT_LAYOUT_MIN_WIDTH = 700;

/** 设置详情页的最小宽度：宽窗口下 `/settings` 索引直接跳转到详情页。 */
export const SETTINGS_DETAIL_MIN_WIDTH = 700;

/** 宽度是否严格小于断点；宽度为 0（尚未测量）时视为不满足，避免首帧误判。 */
export function isBelow(width: number, breakpoint: number): boolean {
  return width > 0 && width < breakpoint;
}

/** 宽度是否达到断点；宽度为 0（尚未测量）时视为不满足，避免首帧误判。 */
export function isAtLeast(width: number, breakpoint: number): boolean {
  return width > 0 && width >= breakpoint;
}
