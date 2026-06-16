import { Suspense } from 'react';
import EmailForm from '@/components/EmailForm';
import WeekCalendar from '@/components/WeekCalendar';
import { getUserToken } from '@/lib/yandex-auth';
import { getWeekEvents } from '@/lib/calendar-api';
import type { CalendarEvent } from '@/lib/types';

interface PageProps {
  searchParams: Promise<{ email?: string; weekStart?: string }>;
}

function getMondayOfCurrentWeek(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const d = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function CalendarSection({
  email,
  weekStart,
}: {
  email: string;
  weekStart: string;
}) {
  let events: CalendarEvent[] = [];
  let errorMessage: string | null = null;

  try {
    const tokenData = await getUserToken(email);
    events = await getWeekEvents(email, tokenData.access_token, weekStart);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Неизвестная ошибка';
  }

  if (errorMessage) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
        <p className="font-medium">Ошибка загрузки данных</p>
        <p className="mt-1 text-sm">{errorMessage}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {events.length === 0
            ? 'Нет событий на этой неделе'
            : `${events.length} ${pluralEvents(events.length)} найдено`}
        </p>
        <p className="text-xs text-slate-400">{email}</p>
      </div>
      <WeekCalendar events={events} weekStart={weekStart} email={email} />
    </div>
  );
}

function pluralEvents(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'событие';
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'события';
  return 'событий';
}

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const email = params.email?.trim() ?? '';
  const weekStart = params.weekStart?.trim() || getMondayOfCurrentWeek();

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-5 w-5"
              >
                <path d="M12.75 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM7.5 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM8.25 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM9.75 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM10.5 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM12.75 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM14.25 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM15 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM16.5 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM15 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM16.5 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
                <path
                  fillRule="evenodd"
                  d="M6.75 2.25A.75.75 0 0 1 7.5 3v1.5h9V3A.75.75 0 0 1 18 3v1.5h.75a3 3 0 0 1 3 3v11.25a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V7.5a3 3 0 0 1 3-3H6V3a.75.75 0 0 1 .75-.75Zm13.5 9a1.5 1.5 0 0 0-1.5-1.5H5.25a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5v-7.5Z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Яндекс Календарь</h1>
              <p className="text-xs text-slate-500">Яндекс 360 · Недельный вид</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex flex-1 flex-col gap-5 mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Suspense>
          <EmailForm currentEmail={email} currentWeekStart={weekStart} />
        </Suspense>

        {email ? (
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center py-24 text-slate-400">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600" />
                  <p className="text-sm">Загрузка событий…</p>
                </div>
              </div>
            }
          >
            <CalendarSection email={email} weekStart={weekStart} />
          </Suspense>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-8 w-8"
              >
                <path d="M1.5 8.67v8.58a3 3 0 0 0 3 3h15a3 3 0 0 0 3-3V8.67l-8.928 5.493a3 3 0 0 1-3.144 0L1.5 8.67Z" />
                <path d="M22.5 6.908V6.75a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3v.158l9.714 5.978a1.5 1.5 0 0 0 1.572 0L22.5 6.908Z" />
              </svg>
            </div>
            <div>
              <p className="text-lg font-medium text-slate-700">Введите email сотрудника</p>
              <p className="mt-1 text-sm text-slate-500">
                Укажите корпоративный email Яндекс 360, чтобы загрузить календарь
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
