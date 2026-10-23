/**
 * M3E Web Components 内部结构访问的唯一出口。
 *
 * `@m3e/web` 是原生自定义元素，部分行为（对话框内容滚动、抽屉滚动、属性选择器）
 * 只能通过 Shadow DOM 补丁实现。这层薄封装的目的：
 * 1) 把所有内部结构依赖集中在一处，升级 M3E 时只需要检查本文件；
 * 2) 每个访问都 try/catch，结构变化时退化为「不生效」而不是抛错中断交互。
 *
 * 注意：本文件只做 DOM 补丁，不处理业务状态。
 */

type DialogElements = {
  host: HTMLElement;
  base: HTMLElement | null;
  content: HTMLElement | null;
};

function dialogElements(host: Element | null): DialogElements | null {
  if (!(host instanceof HTMLElement)) return null;
  const root = host.shadowRoot;
  if (!root) return null;
  return {
    host,
    base: root.querySelector<HTMLElement>(".base"),
    content: root.querySelector<HTMLElement>(".content"),
  };
}

/**
 * 让 M3E 对话框在小窗口内可滚动：给 Shadow DOM 里的 `.base`/`.content` 设定内联高度约束。
 * 页面级 `max-height` 对 Shadow DOM 内的布局没有影响，因此必须写内联样式。
 */
export function prepareM3eDialog(host: Element | null): void {
  try {
    const elements = dialogElements(host);
    if (!elements) return;
    const { base, content } = elements;
    if (base) {
      const available = Math.min(window.innerHeight * 0.9, 720);
      base.style.maxHeight = `${Math.max(240, Math.round(available))}px`;
      base.style.display = "flex";
      base.style.flexDirection = "column";
    }
    if (content) {
      content.style.flex = "1 1 auto";
      content.style.minHeight = "0";
      content.style.overflowY = "auto";
    }
  } catch {
    // M3E 内部结构变化：静默退化，不阻断对话框本身。
  }
}

/** 抽屉内容区溢出策略（作业看板需要横向滚动，其它页面交还给 M3E 默认行为）。 */
export function setDrawerContentOverflow(host: Element | null, axis: { x: string; y: string }): void {
  try {
    if (!(host instanceof HTMLElement)) return;
    const content = host.shadowRoot?.querySelector<HTMLElement>(".content");
    if (!content) return;
    content.style.overflowX = axis.x;
    content.style.overflowY = axis.y;
  } catch {
    // 忽略
  }
}

/**
 * Vue 对自定义元素可能只写 property，而 M3E 的 Shadow CSS 用属性选择器
 * （`[handle]`、`[detents]`），因此需要在挂载后补一次 attribute。
 */
export function patchM3eAttributes(element: Element | null, attributes: Record<string, string>): void {
  try {
    if (!(element instanceof HTMLElement)) return;
    for (const [name, value] of Object.entries(attributes)) {
      if (element.getAttribute(name) !== value) element.setAttribute(name, value);
    }
  } catch {
    // 忽略
  }
}

/** 把 M3E 展开面板头从 Tab 序列里移除，避免焦点落到不可操作的标题上。 */
export function hideM3eExpansionHeaderFromTabOrder(host: Element | null): void {
  try {
    if (!(host instanceof HTMLElement)) return;
    const header = host.shadowRoot?.querySelector<HTMLElement>("m3e-expansion-header");
    if (header) header.tabIndex = -1;
  } catch {
    // 忽略
  }
}
