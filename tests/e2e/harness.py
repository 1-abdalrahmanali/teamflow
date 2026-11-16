"""Shared browser-test setup for the TeamFlow end-to-end tests.

Runs against any Supabase stack. The simplest is the Supabase CLI's local stack
(`supabase start`), which serves the API at http://127.0.0.1:54321 and Postgres at 54322.

Environment variables (defaults suit `supabase start`):
  TEAMFLOW_SITE        where the static site is served          http://localhost:8080
  SUPABASE_URL         the API gateway                          http://127.0.0.1:54321
  SUPABASE_ANON_KEY    the anon/publishable key                 (required; `supabase status` prints it)
  PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE                    127.0.0.1 / 54322 / postgres / postgres / postgres
  TEAMFLOW_LOCAL_CDN   optional folder with supabase.mjs, lucide.mjs and monaco-editor/min,
                       for machines that cannot reach cdn.jsdelivr.net
"""
import os, re, mimetypes, pathlib, subprocess

SITE = os.environ.get('TEAMFLOW_SITE', 'http://localhost:8080').rstrip('/')
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'http://127.0.0.1:54321')
ANON_KEY = os.environ.get('SUPABASE_ANON_KEY', '')
LOCAL_CDN = os.environ.get('TEAMFLOW_LOCAL_CDN')
if not ANON_KEY:
    raise SystemExit('Set SUPABASE_ANON_KEY (run `supabase status` to see it).')

ENV_JS = f"export const SUPABASE_URL = '{SUPABASE_URL}';\nexport const SUPABASE_PUBLISHABLE_KEY = '{ANON_KEY}';\n"
PG = {k: os.environ.get(k, v) for k, v in {
    'PGHOST': '127.0.0.1', 'PGPORT': '54322', 'PGUSER': 'postgres', 'PGPASSWORD': 'postgres', 'PGDATABASE': 'postgres'}.items()}


def sql(query):
    """Runs SQL as the database owner. Used only to promote admins and to check results."""
    return subprocess.run(['psql', '-tAc', query], capture_output=True, text=True, check=True,
                          env={**os.environ, **PG}).stdout.strip()


def install_routes(context):
    # Point the app at the test stack without touching js/config/env.js.
    context.route(f'{SITE}/js/config/env.js', lambda r: r.fulfill(body=ENV_JS, content_type='text/javascript'))
    if not LOCAL_CDN:
        return
    cdn = pathlib.Path(LOCAL_CDN)

    def lib(route):
        url = route.request.url
        if 'supabase-js@' in url:
            return route.fulfill(body=(cdn / 'supabase.mjs').read_text(), content_type='text/javascript')
        if 'lucide@' in url:
            return route.fulfill(body=(cdn / 'lucide.mjs').read_text(), content_type='text/javascript')
        m = re.search(r'monaco-editor@[^/]+/min/(.*)$', url)
        if m:
            path = cdn / 'monaco-editor' / 'min' / m.group(1).split('?')[0]
            if path.exists():
                return route.fulfill(body=path.read_bytes(), content_type=mimetypes.guess_type(str(path))[0] or 'text/javascript')
        return route.fulfill(status=404, body='')
    context.route('https://cdn.jsdelivr.net/**', lib)
    context.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    context.route('https://fonts.gstatic.com/**', lambda r: r.fulfill(status=404, body=''))


class Browser:
    """One person in their own browser."""

    def __init__(self, pw, name, errors, viewport=None):
        self.browser = pw.chromium.launch()
        self.context = self.browser.new_context(viewport=viewport or {'width': 1440, 'height': 900})
        install_routes(self.context)
        self.page = self.context.new_page()
        self.name = name
        self.page.on('console', lambda msg: msg.type == 'error' and errors.append(f'[{name}] console: {msg.text} @ {self.page.url}'))
        self.page.on('pageerror', lambda e: errors.append(f'[{name}] pageerror: {e} @ {self.page.url}'))

    def go(self, path):
        self.page.goto(f'{SITE}/{path}')
        self.page.wait_for_load_state('networkidle')

    def shot(self, label):
        out = pathlib.Path(__file__).with_name('screenshots')
        out.mkdir(exist_ok=True)
        self.page.wait_for_timeout(350)
        self.page.screenshot(path=str(out / f'{label}.png'), full_page=True)
