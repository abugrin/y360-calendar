import { NextRequest, NextResponse } from 'next/server';
import { getDirectoryCache } from '@/lib/directory-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (query.length > 200) {
    return NextResponse.json({ error: 'Поисковый запрос слишком длинный' }, { status: 400, headers });
  }
  try {
    return NextResponse.json(await getDirectoryCache().search(query), { headers });
  } catch {
    return NextResponse.json({
      error: 'Не удалось загрузить справочник. Проверьте TOKEN, ORG_ID и право directory:read_users. Можно ввести email вручную.',
    }, { status: 503, headers });
  }
}
