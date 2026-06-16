import { NextRequest, NextResponse } from 'next/server';
import { getUserToken } from '@/lib/yandex-auth';
import { apiFetch } from '@/lib/api-client';
import { normalizeRecurrenceId } from '@/lib/datetime';
import type { GetParticipantsResponse, Participant } from '@/lib/types';

const CALENDAR_API_URL = 'https://cloud-api.yandex.net/v1/calendar/events';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const email = searchParams.get('email');
  const eventId = searchParams.get('event_id');
  const recurrenceId = searchParams.get('recurrence_id');

  if (!email || !eventId) {
    return NextResponse.json(
      { error: 'Параметры email и event_id обязательны' },
      { status: 400 },
    );
  }

  try {
    const tokenData = await getUserToken(email);
    const allItems: Participant[] = [];
    let iterationKey: string | undefined;

    do {
      const url = new URL(`${CALENDAR_API_URL}/${eventId}/participants`);
      url.searchParams.set('limit', '100');
      if (recurrenceId) {
        url.searchParams.set('recurrence_id', normalizeRecurrenceId(recurrenceId));
      }
      if (iterationKey) {
        url.searchParams.set('iteration_key', iterationKey);
      }

      const response = await apiFetch(email, url.toString(), {
        headers: { Authorization: `OAuth ${tokenData.access_token}` },
        cache: 'no-store',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        return NextResponse.json(
          { error: `Ошибка Calendar API (${response.status}): ${error.message || response.statusText}` },
          { status: response.status },
        );
      }

      const data: GetParticipantsResponse = await response.json();
      allItems.push(...(data.items ?? []));
      iterationKey = data.iteration_key;
    } while (iterationKey);

    return NextResponse.json({ limit: allItems.length, items: allItems });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
