"use client";

import { useCallback, useMemo, useState } from "react";
import { addMonths, monthGridRange, monthLabel, monthStartOf } from "@/lib/operational/month-grid";
import {
  addDaysIso,
  formatOperationalDayHeading,
  formatOperationalLongDate,
  todayInBuenosAires,
  weekStartMonday,
  workWeekDays,
} from "@/lib/operational/operational-calendar";

export type TemporalViewMode = "day" | "week" | "month";

/** Estado temporal de /mi-trabajo — Hoy (BA) por defecto. */
export function useOperationalCalendar() {
  const today = useMemo(() => todayInBuenosAires(), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [viewMode, setViewMode] = useState<TemporalViewMode>("day");

  const weekStart = useMemo(() => weekStartMonday(selectedDate), [selectedDate]);
  const weekDays = useMemo(() => workWeekDays(weekStart), [weekStart]);

  const monthStart = useMemo(() => monthStartOf(selectedDate), [selectedDate]);
  const monthRange = useMemo(() => monthGridRange(monthStart), [monthStart]);
  const goPrevMonth = useCallback(() => setSelectedDate((d) => addMonths(monthStartOf(d), -1)), []);
  const goNextMonth = useCallback(() => setSelectedDate((d) => addMonths(monthStartOf(d), 1)), []);
  /** "Mes actual" en modo Mes — vuelve al mes de hoy sin salir de la vista Mensual. */
  const goToCurrentMonth = useCallback(() => setSelectedDate(todayInBuenosAires()), []);

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

  /** "Hoy"/"Semana actual" en modo Semana — vuelve a la semana de hoy sin resetear a vista Día. */
  const goToCurrentWeek = useCallback(() => {
    setSelectedDate(todayInBuenosAires());
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
    monthStart,
    monthRange,
    monthTitle: monthLabel(monthStart),
    goPrevMonth,
    goNextMonth,
    goToCurrentMonth,
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
    goToCurrentWeek,
    selectDay,
  };
}
