import { NextRequest, NextResponse } from 'next/server';
import { getUserToken } from '@/lib/yandex-auth';
import { ApiError, getSafeErrorMessage } from '@/lib/api-client';
import { getEventParticipants } from '@/lib/calendar-api';
import { normalizeRecurrenceId } from '@/lib/datetime';
import { isValidDateOnly, isValidEmail } from '@/lib/validation';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const email = searchParams.get('email')?.trim().toLowerCase() ?? '';
  const eventId = searchParams.get('event_id') ?? '';
  const recurrenceId = searchParams.get('recurrence_id');
  const normalizedRecurrence = recurrenceId ? normalizeRecurrenceId(recurrenceId) : undefined;

  if (!isValidEmail(email) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
    return NextResponse.json(
      { error: 'Укажите корректные email и event_id.' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (normalizedRecurrence && (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(normalizedRecurrence) ||
      !isValidDateOnly(normalizedRecurrence.slice(0, 10)))) {
    return NextResponse.json(
      { error: 'Некорректный recurrence_id.' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const tokenData = await getUserToken(email);
    const items = await getEventParticipants(email, tokenData.access_token, eventId, normalizedRecurrence, request.signal);
    return NextResponse.json({ limit: items.length, items }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: getSafeErrorMessage(error) },
      { status: error instanceof ApiError ? error.status : 500, headers: NO_STORE_HEADERS },
    );
  }
}
