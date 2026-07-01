import type { BandejaTask } from "@/types/bandeja/bandeja-task";

export function sortByUrgency(tasks: BandejaTask[]): BandejaTask[] {
  return [...tasks].sort((a, b) => b.urgencyScore - a.urgencyScore);
}

export function getFocoTask(tasks: BandejaTask[]): BandejaTask | undefined {
  const actionable = tasks.filter(
    (task) => task.sectionId !== "finalizados" && task.sectionId !== "esperando-otros"
  );
  return sortByUrgency(actionable)[0];
}

export function getProblemTasks(tasks: BandejaTask[]): BandejaTask[] {
  return sortByUrgency(tasks.filter((task) => task.sectionId === "problemas"));
}
