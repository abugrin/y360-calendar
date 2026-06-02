'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { shiftWeek, getWeekRange } from '@/lib/calendar-api';

interface EmailFormProps {
  currentEmail: string;
  currentWeekStart: string;
}

const DAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];
const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function formatWeekLabel(weekStart: string): string {
  const { fromDate, toDate } = getWeekRange(weekStart);
  const from = new Date(fromDate + 'T00:00:00');
  const to = new Date(toDate + 'T00:00:00');
  if (from.getMonth() === to.getMonth()) {
    return `${from.getDate()}–${to.getDate()} ${MONTHS_RU[from.getMonth()]} ${from.getFullYear()}`;
  }
  return `${from.getDate()} ${MONTHS_RU[from.getMonth()]} – ${to.getDate()} ${MONTHS_RU[to.getMonth()]} ${to.getFullYear()}`;
}

export default function EmailForm({ currentEmail, currentWeekStart }: EmailFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(currentEmail);
  const [isPending, startTransition] = useTransition();

  function navigate(newEmail: string, newWeekStart: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (newEmail) {
      params.set('email', newEmail);
    } else {
      params.delete('email');
    }
    params.set('weekStart', newWeekStart);
    startTransition(() => {
      router.push(`/?${params.toString()}`);
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    navigate(email.trim(), currentWeekStart);
  }

  function handlePrev() {
    navigate(currentEmail, shiftWeek(currentWeekStart, 'prev'));
  }

  function handleNext() {
    navigate(currentEmail, shiftWeek(currentWeekStart, 'next'));
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <form onSubmit={handleSubmit} className="flex gap-2 flex-1 max-w-md">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@example.com"
          required
          className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60 transition"
        >
          {isPending ? 'Загрузка…' : 'Показать'}
        </button>
      </form>

      {currentEmail && (
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrev}
            disabled={isPending}
            aria-label="Предыдущая неделя"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60 transition shadow-sm"
          >
            ‹
          </button>
          <span className="text-sm font-medium text-slate-700 min-w-[200px] text-center select-none">
            {formatWeekLabel(currentWeekStart)}
          </span>
          <button
            onClick={handleNext}
            disabled={isPending}
            aria-label="Следующая неделя"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60 transition shadow-sm"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
