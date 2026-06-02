'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CalendarEvent, Participant, ParticipantDecision } from '@/lib/types';
import { getWeekDays } from '@/lib/calendar-api';

interface WeekCalendarProps {
  events: CalendarEvent[];
  weekStart: string;
  email: string;
}

const HOUR_START = 8;
const HOUR_END = 21;
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
const TOTAL_MINUTES = (HOUR_END - HOUR_START) * 60;

const DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const DECISION_LABELS: Record<ParticipantDecision, string> = {
  ACCEPTED: 'Принял',
  DECLINED: 'Отказался',
  TENTATIVE: 'Под вопросом',
  NEEDS_ACTION: 'Ожидает ответа',
};

const DECISION_COLORS: Record<ParticipantDecision, string> = {
  ACCEPTED: 'bg-emerald-100 text-emerald-700',
  DECLINED: 'bg-red-100 text-red-700',
  TENTATIVE: 'bg-amber-100 text-amber-700',
  NEEDS_ACTION: 'bg-slate-100 text-slate-600',
};

const RELATION_LABELS: Record<string, string> = {
  ORGANIZER: 'Организатор',
  SUBSCRIBER: 'Участник',
  ATTENDEE: 'Участник',
};

const FREQ_LABELS: Record<string, string> = {
  DAILY: 'Ежедневно',
  WEEKLY: 'Еженедельно',
  MONTHLY: 'Ежемесячно',
  YEARLY: 'Ежегодно',
};

const WEEKDAY_LABELS: Record<string, string> = {
  MONDAY: 'Пн', TUESDAY: 'Вт', WEDNESDAY: 'Ср',
  THURSDAY: 'Чт', FRIDAY: 'Пт', SATURDAY: 'Сб', SUNDAY: 'Вс',
};

const EVENT_COLORS = [
  'bg-indigo-100 border-indigo-400 text-indigo-900',
  'bg-sky-100 border-sky-400 text-sky-900',
  'bg-emerald-100 border-emerald-400 text-emerald-900',
  'bg-violet-100 border-violet-400 text-violet-900',
  'bg-amber-100 border-amber-400 text-amber-900',
];

function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split('T')[1]?.split(':').map(Number) ?? [0, 0];
  return h * 60 + m;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatTime(dateTimeStr: string): string {
  const timePart = dateTimeStr.split('T')[1];
  const [h, m] = timePart.split(':');
  return `${h}:${m}`;
}

function formatFullDate(dateTimeStr: string): string {
  const [datePart] = dateTimeStr.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  return `${day} ${MONTHS_FULL[month - 1]} ${year}`;
}

function isSameDay(date: Date, dateTimeStr: string): boolean {
  const evDate = dateTimeStr.split('T')[0];
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return evDate === `${year}-${month}-${day}`;
}

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

interface PositionedEvent {
  event: CalendarEvent;
  topPct: number;
  heightPct: number;
  colorClass: string;
  column: number;
  totalColumns: number;
}

function layoutDayEvents(events: CalendarEvent[]): PositionedEvent[] {
  const startMinBase = HOUR_START * 60;

  const items = events.map((ev, idx) => {
    const startMin = clamp(timeToMinutes(ev.start.date_time!), HOUR_START * 60, HOUR_END * 60);
    const endMin = clamp(timeToMinutes(ev.end.date_time!), HOUR_START * 60, HOUR_END * 60);
    const duration = Math.max(endMin - startMin, 15);
    return {
      event: ev,
      startMin,
      endMin: startMin + duration,
      topPct: ((startMin - startMinBase) / TOTAL_MINUTES) * 100,
      heightPct: (duration / TOTAL_MINUTES) * 100,
      colorClass: EVENT_COLORS[idx % EVENT_COLORS.length],
      column: 0,
      totalColumns: 1,
    };
  });

  for (let i = 0; i < items.length; i++) {
    const overlapping = items.filter(
      (other, j) => j !== i && other.startMin < items[i].endMin && other.endMin > items[i].startMin
    );
    if (overlapping.length === 0) {
      items[i].column = 0;
      items[i].totalColumns = 1;
    } else {
      const usedColumns = new Set(overlapping.map((o) => o.column));
      let col = 0;
      while (usedColumns.has(col)) col++;
      items[i].column = col;
      const groupSize = overlapping.length + 1;
      items[i].totalColumns = groupSize;
      overlapping.forEach((o) => (o.totalColumns = groupSize));
    }
  }

  return items;
}

// ─── Event Detail Modal ───────────────────────────────────────────────────────

interface EventModalProps {
  event: CalendarEvent;
  email: string;
  onClose: () => void;
}

function EventModal({ event, email, onClose }: EventModalProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(true);
  const [participantsError, setParticipantsError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    setParticipants([]);
    setParticipantsLoading(true);
    setParticipantsError(null);

    const params = new URLSearchParams({ email, event_id: event.event_id });
    if (event.recurrence_id) {
      // API returns e.g. "2026-06-02T08:00Z"; endpoint expects "YYYY-MM-DDTHH:mm:ss"
      const rid = event.recurrence_id
        .replace(/Z$/, '')                                         // strip trailing Z
        .replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/, '$1:00'); // add :00 seconds if absent
      params.set('recurrence_id', rid);
    }

    fetch(`/api/participants?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setParticipants(data.items ?? []);
      })
      .catch((err: unknown) => {
        setParticipantsError(err instanceof Error ? err.message : 'Ошибка загрузки участников');
      })
      .finally(() => setParticipantsLoading(false));
  }, [event.event_id, event.recurrence_id, email]);

  const startDate = event.start.date_time ? formatFullDate(event.start.date_time) : '—';
  const startTime = event.start.date_time ? formatTime(event.start.date_time) : '—';
  const endTime = event.end.date_time ? formatTime(event.end.date_time) : '—';

  const repetitionLabel = (() => {
    if (!event.repetition) return null;
    const freq = FREQ_LABELS[event.repetition.freq] ?? event.repetition.freq;
    const days = event.repetition.weekly?.week_days
      .map((d) => WEEKDAY_LABELS[d] ?? d)
      .join(', ');
    return days ? `${freq} (${days})` : freq;
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={event.summary}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 overflow-hidden">
        {/* Color accent strip */}
        <div className="h-1.5 bg-indigo-600" />

        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <h2 className="text-lg font-semibold text-slate-900 leading-snug">
            {event.summary}
          </h2>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="flex-shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pb-6 space-y-3 text-sm">
          {/* Date & time */}
          <DetailRow
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z" clipRule="evenodd" />
              </svg>
            }
            label="Дата и время"
            value={`${startDate}, ${startTime}–${endTime}`}
          />

          {/* Location */}
          {event.location && (
            <DetailRow
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="m9.69 18.933.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 0 0 .281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 1 0 3 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 0 0 2.273 1.765 11.842 11.842 0 0 0 .976.544l.062.029.018.008.006.003ZM10 11.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" clipRule="evenodd" />
                </svg>
              }
              label="Место"
              value={event.location}
            />
          )}

          {/* Organizer */}
          {event.organizer && (
            <DetailRow
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493a1.23 1.23 0 0 0 .41 1.412A9.957 9.957 0 0 0 10 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 0 0-13.074.003Z" />
                </svg>
              }
              label="Организатор"
              value={event.organizer}
            />
          )}

          {/* Role */}
          <DetailRow
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-5.5-2.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM10 12a5.99 5.99 0 0 0-4.793 2.39A6.483 6.483 0 0 0 10 16.5a6.483 6.483 0 0 0 4.793-2.11A5.99 5.99 0 0 0 10 12Z" clipRule="evenodd" />
              </svg>
            }
            label="Роль"
            value={RELATION_LABELS[event.relation_type] ?? event.relation_type}
          />

          {/* Repetition */}
          {repetitionLabel && (
            <DetailRow
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0V5.36l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z" clipRule="evenodd" />
                </svg>
              }
              label="Повторение"
              value={repetitionLabel}
            />
          )}

          {/* Description */}
          {event.description && (
            <div className="pt-1 border-t border-slate-100">
              <p className="text-xs font-medium text-slate-500 mb-1">Описание</p>
              <p className="text-slate-700 whitespace-pre-wrap break-words leading-relaxed">
                {event.description}
              </p>
            </div>
          )}

          {/* Participants */}
          <div className="pt-1 border-t border-slate-100">
            <div className="flex items-center gap-1.5 mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-slate-400">
                <path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 0 1 7 17a9.953 9.953 0 0 1-5.385-1.572ZM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 0 0-1.588-3.755 4.502 4.502 0 0 1 5.874 2.636.818.818 0 0 1-.36.98A7.465 7.465 0 0 1 14.5 16Z" />
              </svg>
              <p className="text-xs font-medium text-slate-500">
                Участники{participants.length > 0 ? ` (${participants.length})` : ''}
              </p>
            </div>

            {participantsLoading && (
              <div className="flex items-center gap-2 py-2 text-slate-400">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-500" />
                <span className="text-xs">Загрузка…</span>
              </div>
            )}

            {!participantsLoading && participantsError && (
              <p className="text-xs text-red-500">{participantsError}</p>
            )}

            {!participantsLoading && !participantsError && participants.length === 0 && (
              <p className="text-xs text-slate-400">Нет участников</p>
            )}

            {!participantsLoading && participants.length > 0 && (
              <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {participants.map((p) => (
                  <li key={p.participation_id} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-700 truncate">{p.email}</span>
                    <span
                      className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        DECISION_COLORS[p.decision] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {DECISION_LABELS[p.decision] ?? p.decision}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex-shrink-0 mt-0.5 text-slate-400">{icon}</span>
      <div className="min-w-0">
        <span className="text-xs font-medium text-slate-500">{label}: </span>
        <span className="text-slate-800 break-words">{value}</span>
      </div>
    </div>
  );
}

// ─── Main Calendar Grid ───────────────────────────────────────────────────────

export default function WeekCalendar({ events, weekStart, email }: WeekCalendarProps) {
  const days = getWeekDays(weekStart);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const closeModal = useCallback(() => setSelectedEvent(null), []);

  return (
    <>
      <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* Header row */}
        <div className="grid border-b border-slate-200" style={{ gridTemplateColumns: '56px repeat(5, 1fr)' }}>
          <div className="border-r border-slate-200" />
          {days.map((day, i) => {
            const today = isToday(day);
            return (
              <div
                key={i}
                className={`py-3 text-center border-r border-slate-200 last:border-r-0 ${today ? 'bg-indigo-50' : ''}`}
              >
                <div className={`text-xs font-medium uppercase tracking-wide ${today ? 'text-indigo-600' : 'text-slate-500'}`}>
                  {DAY_NAMES[i]}
                </div>
                <div
                  className={`mt-1 mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                    today ? 'bg-indigo-600 text-white' : 'text-slate-800'
                  }`}
                >
                  {day.getDate()}
                </div>
                <div className={`text-xs ${today ? 'text-indigo-500' : 'text-slate-400'}`}>
                  {MONTHS_SHORT[day.getMonth()]}
                </div>
              </div>
            );
          })}
        </div>

        {/* Grid body */}
        <div className="flex">
          {/* Time labels */}
          <div className="flex-shrink-0 w-14 border-r border-slate-200">
            {HOURS.map((h) => (
              <div
                key={h}
                className="relative border-b border-slate-100"
                style={{ height: `${100 / HOURS.length}%`, minHeight: '52px' }}
              >
                <span className="absolute -top-2.5 right-2 text-xs text-slate-400 select-none">
                  {String(h).padStart(2, '0')}:00
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day, colIdx) => {
            const today = isToday(day);
            const dayEvents = events.filter(
              (ev) => ev.start.date_time && isSameDay(day, ev.start.date_time)
            );
            const positioned = layoutDayEvents(dayEvents);

            return (
              <div
                key={colIdx}
                className={`relative flex-1 border-r border-slate-200 last:border-r-0 ${today ? 'bg-indigo-50/30' : ''}`}
                style={{ minHeight: `${HOURS.length * 52}px` }}
              >
                {/* Hour grid lines */}
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-b border-slate-100"
                    style={{
                      top: `${((h - HOUR_START) / HOURS.length) * 100}%`,
                      height: `${100 / HOURS.length}%`,
                    }}
                  />
                ))}

                {/* Events */}
                {positioned.map(({ event, topPct, heightPct, colorClass, column, totalColumns }) => {
                  const widthPct = 100 / totalColumns;
                  const leftPct = column * widthPct;
                  return (
                    <button
                      key={`${event.event_id}-${event.recurrence_id}`}
                      onClick={() => setSelectedEvent(event)}
                      className={`absolute rounded-md border-l-4 px-1.5 py-1 overflow-hidden cursor-pointer text-left transition hover:brightness-95 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1 ${colorClass}`}
                      style={{
                        top: `${topPct}%`,
                        height: `${heightPct}%`,
                        left: `${leftPct + 1}%`,
                        width: `${widthPct - 2}%`,
                        minHeight: '22px',
                      }}
                    >
                      <div className="text-xs font-semibold leading-tight truncate">
                        {event.summary}
                      </div>
                      {heightPct > 3 && (
                        <div className="text-xs opacity-75 leading-tight truncate">
                          {formatTime(event.start.date_time!)}–{formatTime(event.end.date_time!)}
                        </div>
                      )}
                      {heightPct > 6 && event.location && (
                        <div className="text-xs opacity-60 leading-tight truncate">
                          {event.location}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {selectedEvent && <EventModal event={selectedEvent} email={email} onClose={closeModal} />}
    </>
  );
}
