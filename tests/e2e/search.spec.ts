import { test, expect, type Page } from '@playwright/test';

const employee = {
  id: '1', email: 'anna@example.test', displayName: 'Анна Семёнова',
  firstName: 'Анна', lastName: 'Семёнова', middleName: 'Ивановна',
};

async function directory(page: Page, options: { fail?: boolean; stale?: boolean } = {}) {
  const queries: string[] = [];
  await page.route('**/api/users*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q') ?? '';
    queries.push(query);
    if (options.fail) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    const matched = query.toLocaleLowerCase('ru').includes('ан') || query.includes('anna');
    await route.fulfill({ json: {
      users: matched ? [employee] : [], totalMatches: matched ? 1 : 0,
      total: 1501, loadedAt: new Date().toISOString(), stale: options.stale ?? false,
    } });
  });
  return queries;
}

test('preloads once, searches after two characters, selects via keyboard and syncs browser history', async ({ page }, testInfo) => {
  const queries = await directory(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const input = page.getByRole('combobox', { name: 'Сотрудник или email' });
  await expect(page.getByText('Для поиска введи минимум 2 символа.', { exact: false })).toBeVisible();
  expect(queries).toEqual(['']);
  await input.fill('А');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await input.fill('Анна');
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('search-desktop.png'), fullPage: true });
  await input.press('ArrowDown');
  await expect(page.getByRole('option')).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');
  await expect(page).toHaveURL(/email=anna%40example.test/);
  await expect(input).toHaveValue(employee.email);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.goBack();
  await expect(input).toHaveValue('');
  expect(errors).toEqual([]);
});

test('name submission requires a selection and Escape dismisses suggestions', async ({ page }) => {
  await directory(page);
  await page.goto('/');
  const input = page.getByRole('combobox');
  await input.fill('Анна');
  await expect(page.getByRole('option')).toBeVisible();
  await input.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'Выбери сотрудника' })).toBeVisible();
  expect(new URL(page.url()).searchParams.has('email')).toBe(false);
  await input.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await input.press('ArrowDown');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.getByRole('option').click();
  await expect(page).toHaveURL(/email=anna%40example.test/);
});

test('manual email remains usable during a directory outage', async ({ page }) => {
  await directory(page, { fail: true });
  await page.goto('/');
  await expect(page.getByText('Поиск сотрудников временно недоступен.', { exact: false })).toBeVisible();
  await page.getByRole('combobox').fill('manual@example.test');
  await page.getByRole('button', { name: 'Показать', exact: true }).click();
  await expect(page).toHaveURL(/email=manual%40example.test/);
  await expect(page.getByText('На сервере не настроен доступ к календарю.')).toBeVisible();
});

test('empty and stale states remain usable on mobile without page overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await directory(page, { stale: true });
  await page.goto('/');
  await expect(page.getByText('Используется сохранённый список сотрудников;', { exact: false })).toBeVisible();
  await page.getByRole('combobox').fill('Nobody');
  await expect(page.getByText('Сотрудники не найдены.', { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('search-mobile.png'), fullPage: true });
  const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
});

test('invalid URL input renders validation instead of crashing or requesting a calendar', async ({ page }) => {
  await directory(page);
  await page.goto('/?email=bad&weekStart=2026-02-30');
  await expect(page.getByRole('alert').filter({ hasText: 'Проверьте email и дату недели' })).toBeVisible();
  await expect(page.getByText('Ошибка загрузки данных')).toHaveCount(0);
});
