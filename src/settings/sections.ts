/**
 * 设置分区的唯一来源。
 *
 * 路由（`/settings/*`）、设置索引入口（SettingsIndexView）与设置页侧栏
 * （SettingsPage）都从这里读取分区清单，避免三处各维护一份列表后出现漂移。
 *
 * 说明：这里 import 各设置视图组件是安全的——视图组件只依赖 `SettingsPage`，
 * 不会反向 import `router.ts`，不存在「视图 ↔ 路由」循环。
 */
import type { Component } from "vue";
import SettingsAboutView from "../views/SettingsAboutView.vue";
import SettingsBoardView from "../views/SettingsBoardView.vue";
import SettingsDiagnosticsView from "../views/SettingsDiagnosticsView.vue";
import SettingsExpiryView from "../views/SettingsExpiryView.vue";
import SettingsGeneralView from "../views/SettingsGeneralView.vue";
import SettingsGlycoproteinView from "../views/SettingsGlycoproteinView.vue";
import SettingsImportView from "../views/SettingsImportView.vue";
import SettingsVocabularyView from "../views/SettingsVocabularyView.vue";

export type SettingsSection = {
  /** 分区 id，路由名固定为 `settings-${id}`。 */
  readonly id: string;
  /** 路由 path，同时是索引卡片/侧栏条目的锚点目标。 */
  readonly path: string;
  readonly title: string;
  readonly detail: string;
  readonly icon: string;
  /** 仅在桌面运行时可见（移动运行时隐藏）。 */
  readonly desktopOnly?: boolean;
  /** 路由 meta.settingsDepth，沿用原有转场规则。 */
  readonly depth: number;
};

/** 设置分区清单；顺序即索引页与侧栏的展示顺序。 */
export const settingsSections: readonly SettingsSection[] = [
  { id: "general", path: "/settings/general", title: "通用", detail: "应用标题", icon: "tune", depth: 1 },
  { id: "vocabulary", path: "/settings/vocabulary", title: "作业词库", detail: "科目和标签", icon: "category", depth: 1 },
  { id: "expiry", path: "/settings/expiry", title: "过期作业", detail: "清理和标记", icon: "event_busy", depth: 1 },
  { id: "board", path: "/settings/board", title: "看板", detail: "最大面板宽度", icon: "view_column", depth: 1 },
  {
    id: "glycoprotein",
    path: "/settings/glycoprotein",
    title: "Glycoprotein",
    detail: "本机节点与窗口控制",
    icon: "hub",
    desktopOnly: true,
    depth: 1,
  },
  { id: "import", path: "/settings/import", title: "导入旧版数据", detail: "Profile.json 和 Settings.json", icon: "upload_file", depth: 1 },
  { id: "diagnostics", path: "/settings/diagnostics", title: "诊断信息", detail: "反馈、诊断包与运行日志", icon: "content_copy", depth: 1 },
  { id: "about", path: "/settings/about", title: "关于", detail: "版本、项目与许可证", icon: "info", depth: 1 },
];

/** path → 分区，供路由与侧栏按当前 path 反查。 */
export const settingsSectionByPath: ReadonlyMap<string, SettingsSection> = new Map(
  settingsSections.map((section) => [section.path, section]),
);

/** path → 视图组件；路由表用它装配 `/settings/*` 详情路由。 */
export const settingsSectionComponents: Readonly<Record<string, Component>> = {
  "/settings/general": SettingsGeneralView,
  "/settings/vocabulary": SettingsVocabularyView,
  "/settings/expiry": SettingsExpiryView,
  "/settings/board": SettingsBoardView,
  "/settings/glycoprotein": SettingsGlycoproteinView,
  "/settings/import": SettingsImportView,
  "/settings/diagnostics": SettingsDiagnosticsView,
  "/settings/about": SettingsAboutView,
};

/** 分区对应的路由名，保持原有的 `settings-*` 命名。 */
export function settingsRouteName(section: SettingsSection): string {
  return `settings-${section.id}`;
}

/** 根据运行时过滤分区（移动运行时不展示 desktopOnly 分区），三处共用这一份过滤逻辑。 */
export function visibleSettingsSections(isMobileRuntime: boolean): readonly SettingsSection[] {
  return settingsSections.filter((section) => !section.desktopOnly || !isMobileRuntime);
}
