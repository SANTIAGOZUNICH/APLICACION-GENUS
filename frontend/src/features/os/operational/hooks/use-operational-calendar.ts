"use client";

import { useCallback, useMemo, useState } from "react";
import {
  addDaysIso,
  formatOperationalDayHeading,
  formatOperationalLongDate,
  todayInBuenosAires,
  weekStartMonday,
  workWeekDays,
} from "@/lib/operational/operational-calendar";

export type TemporalViewMode = "day" | "week";

/** Estado temporal de /mi-trabajo — Hoy (BA) por defecto. */
export function useOperationalCalendar() {
  const today = useMemo(() => todayInBuenosAires(), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [viewMode, setViewMode] = useState<TemporalViewMode>("day");

  const weekStart = useMemo(() => weekStartMonday(selectedDate), [selectedDate]);
  const weekDays = useMemo(() => workWeekDays(weekStart), [weekStart]);

  const goToday = useCallback(() => {
    const now = todayInBuenosAires();
    setSelectedDate(now);
    setViewMode("day");
  }, []);

  const goPrevDay = useCallback(() => {
    setSelectedDate((d) => addDaysIso(d, -1));
    setViewMode("day");
  }, []);

  const goNextDay = useCallback(() => {
    setSelectedDate((d) => addDaysIso(d, 1));
    setViewMode("day");
  }, []);

  /**
   * Exactamente ±1 semana desde weekStart (lunes) — nunca ±1 día, nunca
   * cambia de viewMode. addDaysIso es UTC-safe (ver operational-calendar.ts),
   * así que el rango no depende de timezone.
   */
  const goPrevWeek = useCallback(() => {
    setSelectedDate((d) => addDaysIso(weekStartMonday(d), -7));
  }, []);

  const goNextWeek = useCallback(() => {
    setSelectedDate((d) => addDaysIso(weekStartMonday(d), 7));
  }, []);

  const selectDay = useCallback((iso: string) => {
    setSelectedDate(iso);
    setViewMode("day");
  }, []);

  const heading = formatOperationalDayHeading(selectedDate, today);
  const selectedLong = formatOperationalLongDate(selectedDate);

  return {
    today,
    selectedDate,
    weekStart,
    weekDays,
    viewMode,
    setViewMode,
    heading,
    selectedLong,
    isToday: selectedDate === today,
    goToday,
    goPrevDay,
    goNextDay,
    goPrevWeek,
    goNextWeek,
    selectDay,
  };
}
