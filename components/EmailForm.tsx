'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { shiftWeek, getWeekRange } from '@/lib/week';
import { addDaysToDateStr } from '@/lib/datetime';
import { isValidEmail } from '@/lib/validation';
import type { DirectoryUser, DirectorySearchResponse } from '@/lib/directory-types';

interface EmailFormProps {
  currentEmail: string;
  currentWeekStart: string;
}

interface SearchState {
  query: string;
  users: DirectoryUser[];
  totalMatches: number;
  loading: boolean;
  error: string | null;
}

const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function formatWeekLabel(weekStart: string): string {
  const { weekStart: mondayStr } = getWeekRange(weekStart);
  const from = new Date(`${mondayStr}T00:00:00`);
  const to = new Date(`${addDaysToDateStr(mondayStr, 4)}T00:00:00`);
  if (from.getMonth() === to.getMonth()) {
    return `${from.getDate()}–${to.getDate()} ${MONTHS_RU[from.getMonth()]} ${from.getFullYear()}`;
  }
  const fromYear = from.getFullYear() !== to.getFullYear() ? ` ${from.getFullYear()}` : '';
  return `${from.getDate()} ${MONTHS_RU[from.getMonth()]}${fromYear} – ${to.getDate()} ${MONTHS_RU[to.getMonth()]} ${to.getFullYear()}`;
}

async function fetchDirectory(url: string, signal: AbortSignal): Promise<DirectorySearchResponse> {
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Поиск сотрудников временно недоступен. Можно ввести email вручную.');
  return response.json() as Promise<DirectorySearchResponse>;
}

export default function EmailForm({ currentEmail, currentWeekStart }: EmailFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputId = useId();
  const listId = `${inputId}-users`;
  const inputRef = useRef<HTMLInputElement>(null);
  const activeOptionRef = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState(currentEmail);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [directory, setDirectory] = useState({ loading: true, error: null as string | null, stale: false });
  const [search, setSearch] = useState<SearchState>({ query: '', users: [], totalMatches: 0, loading: false, error: null });
  const [isPending, startTransition] = useTransition();
  const matchesQuery = search.query === query;
  const users = matchesQuery ? search.users : [];
  const showSuggestions = open && query.length >= 2;

  useEffect(() => {
    const controller = new AbortController();
    fetchDirectory('/api/users', controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setDirectory((current) => current.loading ? { loading: false, error: null, stale: data.stale } : current);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDirectory((current) => current.loading
            ? { loading: false, error: 'Поиск сотрудников временно недоступен. Можно ввести email вручную.', stale: false }
            : current);
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query });
      fetchDirectory(`/api/users?${params}`, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          setSearch({ query, users: data.users, totalMatches: data.totalMatches, loading: false, error: null });
          setDirectory({ loading: false, error: null, stale: data.stale });
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSearch({ query, users: [], totalMatches: 0, loading: false, error: 'Не удалось найти сотрудников. Можно ввести email вручную.' });
        });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function navigate(newEmail: string, newWeekStart: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('email', newEmail);
    params.set('weekStart', newWeekStart);
    startTransition(() => router.push(`/?${params.toString()}`));
  }

  function selectUser(user: DirectoryUser) {
    setValue(user.email);
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
    setValidationError(null);
    navigate(user.email, currentWeekStart);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isPending) return;
    const email = value.trim();
    if (!isValidEmail(email)) {
      setValidationError('Выбери сотрудника из списка или введи полный email.');
      setOpen(query.length >= 2);
      inputRef.current?.focus();
      return;
    }
    setValidationError(null);
    setOpen(false);
    navigate(email, currentWeekStart);
  }

  const searchStatus = matchesQuery && search.error
    ? search.error
    : search.loading || !matchesQuery
      ? 'Поиск сотрудников…'
      : users.length === 0
        ? 'Сотрудники не найдены. Можно ввести email вручную.'
        : search.totalMatches > users.length
          ? `Показаны ${users.length} из ${search.totalMatches}. Уточни имя или email.`
          : `Найдено сотрудников: ${search.totalMatches}`;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <form onSubmit={handleSubmit} noValidate className="min-w-0 flex-1 lg:max-w-xl">
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-slate-700">
          Сотрудник или email
        </label>
        <div className="flex gap-2">
          <div
            className="relative min-w-0 flex-1"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
            }}
          >
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showSuggestions}
              aria-controls={showSuggestions ? listId : undefined}
              aria-activedescendant={showSuggestions && users[activeIndex] ? `${listId}-${activeIndex}` : undefined}
              aria-describedby={`${inputId}-hint${validationError ? ` ${inputId}-error` : ''}`}
              aria-invalid={Boolean(validationError)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={320}
              value={value}
              onChange={(event) => {
                const next = event.target.value;
                const nextQuery = next.trim();
                setValue(next);
                if (nextQuery !== query) {
                  setQuery(nextQuery);
                  setSearch({ query: nextQuery, users: [], totalMatches: 0, loading: nextQuery.length >= 2, error: null });
                  setActiveIndex(-1);
                }
                setOpen(nextQuery.length >= 2);
                setValidationError(null);
              }}
              onFocus={() => setOpen(query.length >= 2)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) {
                  if (event.key === 'Enter') event.preventDefault();
                  return;
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  setOpen(query.length >= 2);
                  if (users.length) {
                    setActiveIndex((index) => event.key === 'ArrowDown'
                      ? (index + 1) % users.length
                      : (index <= 0 ? users.length - 1 : index - 1));
                  }
                } else if (event.key === 'Escape') {
                  setOpen(false);
                  setActiveIndex(-1);
                } else if (event.key === 'Enter' && showSuggestions && users[activeIndex]) {
                  event.preventDefault();
                  if (!isPending) selectUser(users[activeIndex]);
                }
              }}
              placeholder="Имя, фамилия, display name или email"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
            />
            {showSuggestions && (
              <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                <ul id={listId} role="listbox" aria-label="Сотрудники" aria-busy={search.loading} className="max-h-72 overflow-y-auto">
                  {users.map((user, index) => (
                    <li key={user.id} role="presentation">
                      <button
                        ref={index === activeIndex ? activeOptionRef : undefined}
                        id={`${listId}-${index}`}
                        type="button"
                        role="option"
                        aria-selected={index === activeIndex}
                        tabIndex={-1}
                        disabled={isPending}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseMove={() => setActiveIndex(index)}
                        onClick={() => selectUser(user)}
                        className={`block w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 ${index === activeIndex ? 'bg-indigo-50' : ''}`}
                      >
                        <span className="block break-words font-medium text-slate-800">
                          {user.displayName || [user.firstName, user.middleName, user.lastName].filter(Boolean).join(' ') || user.email}
                        </span>
                        <span className="block break-all text-xs text-slate-500">{user.email}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p role="status" className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">{searchStatus}</p>
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60 transition"
          >
            {isPending ? 'Загрузка…' : 'Показать'}
          </button>
        </div>
        <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-slate-500" role="status">
          {directory.loading ? 'Загружаю справочник сотрудников…' : directory.error || (directory.stale
            ? 'Используется сохранённый список сотрудников; ожидается обновление.'
            : 'Для поиска введи минимум 2 символа. Также можно указать email вручную.')}
        </p>
        {validationError && <p id={`${inputId}-error`} role="alert" className="mt-1 text-xs text-red-600">{validationError}</p>}
      </form>

      {currentEmail && (
        <div className="flex items-center gap-2 lg:pt-6">
          <button
            onClick={() => navigate(currentEmail, shiftWeek(currentWeekStart, 'prev'))}
            disabled={isPending}
            aria-label="Предыдущая неделя"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60 transition shadow-sm"
          >‹</button>
          <span className="min-w-[200px] text-center text-sm font-medium text-slate-700 select-none">
            {formatWeekLabel(currentWeekStart)}
          </span>
          <button
            onClick={() => navigate(currentEmail, shiftWeek(currentWeekStart, 'next'))}
            disabled={isPending}
            aria-label="Следующая неделя"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-60 transition shadow-sm"
          >›</button>
        </div>
      )}
    </div>
  );
}
