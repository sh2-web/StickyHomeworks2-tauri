import type { AppData, AppSettings, HomeworkRecord } from "../types/app-data";
import { isHomeworkExpired, toTiptapHtml } from "../utils/homework-content.ts";
import { parseHomeworkContent } from "../types/homework-content";
import { uniqueVocabulary } from "./vocabulary.ts";
import type { SubjectGroup } from "../types/homework-board";

export { uniqueVocabulary } from "./vocabulary.ts";

export function localDateValue(value = new Date()) {
  return formatLocalDate(value);
}

export function toDateInputValue(value: string) {
  return value.slice(0, 10);
}

export function formatLocalDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeHomework(homework: HomeworkRecord): HomeworkRecord {
  return {
    ...homework,
    content: parseHomeworkContent(homework.content),
    subject: homework.subject.trim() || "其它",
    dueTime: `${toDateInputValue(homework.dueTime)}T00:00:00`,
    tags: uniqueVocabulary(homework.tags),
  };
}

/**
 * 保存作业记录。
 * `create` 模式追加新作业；`update` 模式在找不到同 id 作业时返回原数据（noop），
 * 避免“删除后编辑保存”把已删除的作业复活。
 */
export function saveHomeworkRecord(
  data: AppData,
  homework: HomeworkRecord,
  mode: "create" | "update" = "update",
): AppData {
  const normalized = normalizeHomework(homework);
  const position = data.homeworks.findIndex((item) => item.id === normalized.id);

  if (position === -1 && mode === "update") return data;

  const homeworks = [...data.homeworks];

  if (position === -1) homeworks.push(normalized);
  else homeworks.splice(position, 1, normalized);

  return {
    ...data,
    homeworks,
    settings: {
      ...data.settings,
      subjects: uniqueVocabulary([...data.settings.subjects, normalized.subject]),
      tags: uniqueVocabulary([...data.settings.tags, ...normalized.tags]),
    },
  };
}

export function removeHomeworkRecord(data: AppData, homeworkId: string): AppData {
  return {
    ...data,
    homeworks: data.homeworks.filter((homework) => homework.id !== homeworkId),
  };
}

type ExpiryMarkSettings = Pick<AppSettings, "isExpiredMarkEnabled" | "expiredMarkColor">;

/**
 * 按科目对作业分组。
 * `SubjectGroup.id` 固定为科目名（`id === subject`），不再取该组第一条作业的 id，
 * 保证删除/编辑作业后分组的 key 不漂移；`name` 是展示用科目名，`homeworks` 是该科目下的作业。
 */
export function groupHomeworks(
  homeworks: readonly HomeworkRecord[],
  expiryMarkSettings: ExpiryMarkSettings = { isExpiredMarkEnabled: false, expiredMarkColor: "" },
): SubjectGroup[] {
  const groups = new Map<string, SubjectGroup>();
  for (const homework of homeworks) {

    const subject = homework.subject.trim() || "其它";
    const group = groups.get(subject) ?? { id: subject, name: subject, homeworks: [] };
    group.homeworks.push({
      id: homework.id,
      content: toTiptapHtml(homework.content),
      tags: homework.tags,
      expired: expiryMarkSettings.isExpiredMarkEnabled && isHomeworkExpired(homework.dueTime),
      expiredMarkColor: expiryMarkSettings.expiredMarkColor,
    });
    groups.set(subject, group);
  }

  return [...groups.values()];
}
