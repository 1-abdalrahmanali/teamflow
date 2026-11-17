"""End-to-end, TeamFlow version 2: scenarios A to E through the real interface.

WARNING: this deletes every user, project and file in the target database
before it starts. Run it only against a local or throwaway Supabase stack.

Needs, besides what harness.py lists:
  - the send-invitation function served with RESEND_API_URL pointing at
    tests/e2e/fake_resend.mjs, which records each email in TEAMFLOW_OUTBOX
    (default tests/e2e/outbox.json). docs/TESTING.md shows the commands.

    pip install playwright && playwright install chromium
    SUPABASE_ANON_KEY=... python3 tests/e2e/workflow.py
"""
import os, sys, re, json, pathlib, urllib.request
sys.path.insert(0, __import__('os').path.dirname(__file__))
from harness import Browser, SITE, SUPABASE_URL, ANON_KEY, sql
from playwright.sync_api import sync_playwright, expect

errors, results = [], []
OUTBOX = pathlib.Path(os.environ.get('TEAMFLOW_OUTBOX', pathlib.Path(__file__).with_name('outbox.json')))
PASSWORD = 'correct-horse-42'

def check(label, fn):
    try:
        fn(); results.append(('ok', label)); print('  ok   ', label)
    except Exception as e:
        results.append(('FAIL', label)); print('  FAIL ', label, '\n        ', (str(e).splitlines() or [repr(e)])[0][:400])

def must(cond, message):
    if not cond: raise AssertionError(message)

def signup_api(email, name):
    req = urllib.request.Request(f'{SUPABASE_URL}/auth/v1/signup', method='POST',
        data=json.dumps({'email': email, 'password': PASSWORD, 'data': {'full_name': name}}).encode(),
        headers={'apikey': ANON_KEY, 'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(req).read())

def login(b, email, expect_path):
    b.go('login.html')
    b.page.fill('input[name=email]', email)
    b.page.fill('#password', PASSWORD)
    b.page.click('button[type=submit]')
    b.page.wait_for_url(f'**/{expect_path}*'); b.page.wait_for_load_state('networkidle')

def last_link(email):
    box = json.loads(OUTBOX.read_text())
    mails = [m for m in box if email in (m.get('to') or [])]
    must(mails, f'no email to {email}')
    return re.search(r'(https?://\S+?/accept-invitation\.html#token=[^\s"<]+)', mails[-1]['text']).group(1), mails[-1]

def confirm(page):
    page.click('.modal [data-answer="yes"]')

def nav_keys(page):
    return page.eval_on_selector_all('.nav-heading', 'els => els.map(e => e.textContent.trim())')

with sync_playwright() as pw:
    sql("begin; set local storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id in ('submissions', 'task-resources', 'avatars'); update public.projects set status = 'archived'; delete from public.projects; delete from public.activity_logs; delete from auth.users; commit;")
    OUTBOX.write_text('[]')
    for email, name in [('amira@example.com', 'Amira Adel'), ('layla@example.com', 'Layla Hassan'),
                        ('mona@example.com', 'Mona Farid'), ('nabil@example.com', 'Nabil Saad')]:
        signup_api(email, name)
    sql("update public.profiles set platform_role = 'platform_admin' where email = 'amira@example.com'")

    admin = Browser(pw, 'amira', errors); leader = Browser(pw, 'layla', errors); member = Browser(pw, 'mona', errors)
    ap, lp, mp = admin.page, leader.page, member.page
    S = {}

    print('Scenario A: an admin sets up a project, invites by email, picks a Team Leader')
    def a_login():
        login(admin, 'amira@example.com', 'app/admin/overview.html')
        must(nav_keys(ap) == ['Admin'], f'admin nav sections: {nav_keys(ap)}')
        admin.shot('a01-admin-overview-empty')
    check('a Platform Admin lands on the platform overview with only the Admin section', a_login)

    def a_project():
        ap.click('#new-project')
        ap.fill('.modal input[name=name]', 'Website relaunch')
        ap.fill('.modal textarea[name=description]', 'The new marketing site: login, pricing and docs pages.')
        ap.select_option('.modal select[name=timezone]', 'Africa/Cairo')
        admin.shot('a02-new-project')
        ap.click('.modal button[type=submit]')
        ap.wait_for_url('**/app/project.html?id=*'); ap.wait_for_load_state('networkidle')
        expect(ap.locator('#page-title')).to_have_text('Website relaunch')
        S['project'] = re.search(r'id=([0-9a-f-]+)', ap.url).group(1)
        must(sql(f"select timezone from projects where id = '{S['project']}'") == 'Africa/Cairo', 'timezone not saved')
        admin.shot('a03-project-overview-manager')
    check('the admin creates a project in Cairo time', a_project)

    def a_invite(email, shot=None):
        ap.click('#page-actions [data-invite]')
        ap.fill('.modal input[name=email]', email)
        ap.click('.modal button[type=submit]')
        expect(ap.locator('.modal .form-message.is-good')).to_contain_text('emailed')
        expect(ap.locator('.modal [data-link]')).to_be_visible()
        if shot: admin.shot(shot)
        ap.click('.modal [data-done]')
    def a_invites():
        a_invite('Layla@Example.com', 'a04-invitation-emailed')
        a_invite('mona@example.com')
        link, mail = last_link('layla@example.com')
        must('Website relaunch' in mail['subject'], f"subject: {mail['subject']}")
        must(mail['auth'] == 'Bearer re_test', 'resend key not used')
        must(sql("select count(*) from invitations where status = 'pending'") == '2', 'two pending invitations')
        must(sql("select count(*) from invitations where token_hash like 'ey%' or length(token_hash) <> 64") == '0', 'token stored as hash')
    check('invitations are emailed through the function, with the link, and stored hashed', a_invites)

    def a_accept(b, email, name):
        link, _ = last_link(email)
        login(b, email, 'app/')
        b.page.goto(link); b.page.wait_for_load_state('networkidle')
        expect(b.page.locator('h1')).to_contain_text('Join Website relaunch')
        b.page.click('#accept')
        b.page.wait_for_url('**/app/project.html?id=*'); b.page.wait_for_load_state('networkidle')
    def a_accepts():
        a_accept(leader, 'layla@example.com', 'Layla')
        a_accept(member, 'mona@example.com', 'Mona')
        expect(mp.locator('.callout-good')).to_contain_text('Welcome to')
        member.shot('a05-member-joined-project')
        must(sql(f"select count(*) from project_members where project_id = '{S['project']}'") == '2', 'two members')
    check('both people accept their emailed links and join as members', a_accepts)

    def a_reuse():
        link, _ = last_link('mona@example.com')
        mp.goto(link); mp.wait_for_load_state('networkidle')
        expect(mp.locator('h1')).to_contain_text('already in')
    check('an invitation link works only once', a_reuse)

    def a_promote():
        admin.go(f"app/project.html?id={S['project']}&tab=members")
        ap.click('tr[data-name="Layla Hassan"] [data-act="promote"]')
        confirm(ap)
        expect(ap.locator('tr[data-name="Layla Hassan"] .role-lead')).to_be_visible()
        admin.shot('a06-people-tab')
        must(sql(f"select role from project_members m join profiles p on p.id = m.user_id where p.email = 'layla@example.com'") == 'team_leader', 'layla not leader')
        must(sql("select count(*) from activity_logs where action = 'role.project_changed'") == '1', 'promotion not logged')
    check('the admin makes Layla Team Leader and it is logged', a_promote)

    print('Scenario B: a Team Leader plans work with deadlines, dependencies and learning material')
    def b_leader_home():
        leader.go('app/home.html'); lp.wait_for_url('**/app/leading.html'); lp.wait_for_load_state('networkidle')
        must(nav_keys(lp) == ['My work', 'Projects', 'Leading'], f'leader nav: {nav_keys(lp)}')
        leader.shot('b01-leading-empty')
    check('a Team Leader lands on Team overview with My work, Projects and Leading', b_leader_home)

    def new_task(title, kind, assignee, deadline=None, deps=(), language=None, requirements=''):
        leader.go(f"app/task-form.html?project={S['project']}")
        lp.fill('input[name=title]', title)
        lp.fill('textarea[name=description]', f'{title}: follow the design in Figma and keep it accessible.')
        if requirements: lp.fill('textarea[name=requirements]', requirements)
        lp.select_option('select[name=assigned_to]', label=assignee)
        if deadline: lp.fill('input[name=deadline]', deadline)
        lp.select_option('select[name=submission_type]', kind)
        if language: lp.select_option('select[name=programming_language]', language)
        for dep in deps: lp.check(f'input[name=deps][value="{dep}"]')
        lp.click('button[type=submit]')
        lp.wait_for_url('**/app/task.html?id=*'); lp.wait_for_load_state('networkidle')
        return re.search(r'id=([0-9a-f-]+)', lp.url).group(1)

    def b_tasks():
        S['a'] = new_task('Build the login page', 'code', 'Mona Farid', '2026-11-20T23:30', language='html',
                          requirements='Email and password fields\nThe password is hidden\nWorks with the keyboard alone')
        must(sql(f"select to_char(deadline at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from tasks where id = '{S['a']}'") == '2026-11-20 21:30', 'deadline stored wrong')
        expect(lp.locator('.kv')).to_contain_text('(Cairo time)')
        S['b'] = new_task('Write the pricing copy', 'text', 'Mona Farid', '2026-11-25T18:00', deps=[S['a']])
        S['c'] = new_task('Export the logo files', 'file', 'Mona Farid')
        leader.shot('b02-task-page-manager')
    check('the leader creates code, text and file tasks; 23:30 Cairo is stored as 21:30 UTC', b_tasks)

    def b_cycle():
        leader.go(f"app/task-form.html?id={S['a']}")
        lp.check(f'input[name=deps][value="{S["b"]}"]')
        lp.click('button[type=submit]')
        expect(lp.locator('#form-message')).to_contain_text('loop')
        leader.shot('b03-cycle-refused')
    check('a dependency loop is refused with a readable message', b_cycle)

    def b_resources():
        leader.go(f"app/task.html?id={S['a']}")
        lp.click('[data-resources] [data-act="add"]')
        lp.select_option('.modal select[name=type]', 'youtube')
        lp.fill('.modal input[name=title]', 'Accessible forms in 10 minutes')
        lp.fill('.modal input[name=link]', 'https://www.example.com/not-youtube')
        lp.click('.modal button[type=submit]')
        expect(lp.locator('.modal [data-message]')).to_contain_text('YouTube')
        lp.fill('.modal input[name=link]', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
        lp.click('.modal button[type=submit]')
        expect(lp.locator('[data-resources] .resource')).to_have_count(1)
        lp.click('[data-resources] [data-act="add"]')
        lp.select_option('.modal select[name=type]', 'pdf')
        lp.fill('.modal input[name=title]', 'Login page spec')
        pdf = pathlib.Path(__file__).with_name('spec.pdf'); pdf.write_bytes(b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
        lp.set_input_files('.modal input[name=file]', str(pdf))
        lp.click('.modal button[type=submit]')
        expect(lp.locator('[data-resources] .resource')).to_have_count(2)
        lp.click('[data-resources] [data-act="add"]')
        lp.select_option('.modal select[name=type]', 'documentation')
        lp.fill('.modal input[name=title]', 'MDN: the form element')
        lp.fill('.modal input[name=link]', 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form')
        lp.fill('.modal textarea[name=description]', 'Read the accessibility section before you start.')
        lp.click('.modal button[type=submit]')
        expect(lp.locator('[data-resources] .resource')).to_have_count(3)
        must(sql(f"select count(*) from task_resources where task_id = '{S['a']}'") == '3', 'resources not saved')
        leader.shot('b04-resources')
    check('the leader attaches a YouTube video, a PDF and a docs link (a bad YouTube link is refused)', b_resources)

    print('Scenario C: the member works, asks, submits, gets changes, resubmits')
    def c_dashboard():
        member.go('app/home.html'); mp.wait_for_url('**/app/dashboard.html'); mp.wait_for_load_state('networkidle')
        must(nav_keys(mp) == ['My work', 'Projects'], f'member nav: {nav_keys(mp)}')
        values = mp.eval_on_selector_all('.metrics .metric-value, .metrics .dial-value', 'els => els.map(e => e.textContent.trim())')
        must(values == ['3', '0', '--'], f'metrics {values}')
        expect(mp.locator('.metrics .metric')).to_have_count(3)
        member.shot('c01-member-dashboard')
    check('the member dashboard shows exactly three numbers: 3 assigned, 0 completed, no score', c_dashboard)

    def c_blocked():
        member.go(f"app/task.html?id={S['b']}")
        expect(mp.locator('.work-blocked')).to_be_visible()
        expect(mp.locator('.task-head .tag-blocked')).to_be_visible()
        member.shot('c02-blocked-task')
    check('the dependent task shows as blocked, with what it waits for', c_blocked)

    def c_resources_member():
        member.go(f"app/task.html?id={S['a']}")
        expect(mp.locator('[data-resources] [data-act="edit"]')).to_have_count(0)
        mp.click('[data-resources] [data-act="watch"]')
        expect(mp.locator('[data-resources] iframe[src*="youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).to_have_count(1)
        mp.click('[data-resources] [data-act="preview"]')
        expect(mp.locator('.modal iframe.resource-pdf')).to_be_visible()
        mp.keyboard.press('Escape')
    check('the member watches the video inline, opens the PDF, and has no edit buttons', c_resources_member)

    def c_question():
        mp.fill('[data-composer] textarea[name=content]', 'Should the login page remember the email address?')
        mp.click('[data-composer] button[type=submit]')
        expect(mp.locator('.thread.is-question')).to_have_count(1)
        expect(mp.locator('[data-discussion] [data-act="pin"]')).to_have_count(0)
    check('the member asks a question and cannot pin', c_question)

    def c_submit_v1():
        mp.click('[data-act="start"]')
        expect(mp.locator('[data-editor] .monaco-editor')).to_be_visible(timeout=15000)
        mp.evaluate("monaco.editor.getModels()[0].setValue('<form class=\"login\">\\n  <input type=\"email\" name=\"email\" required>\\n  <input type=\"text\" name=\"password\">\\n  <button>Sign in</button>\\n</form>\\n')")
        mp.wait_for_timeout(700)
        member.shot('c03-work-area-editor')
        mp.click('[data-submit] button[type=submit]')
        expect(mp.locator('.work-waiting')).to_contain_text('Version 1 is waiting')
        must(sql(f"select status from tasks where id = '{S['a']}'") == 'submitted', 'not submitted')
    check('the member starts, writes code in the editor and submits version 1', c_submit_v1)

    def c_review_changes():
        leader.go('app/review-queue.html')
        expect(lp.locator('.queue-row')).to_have_count(1)
        leader.shot('c04-review-queue')
        lp.click('.queue-row')
        lp.wait_for_url('**/app/review.html?id=*'); lp.wait_for_load_state('networkidle')
        lp.click('label:has(input[value="request_revision"])')
        lp.click('[data-submit]')
        expect(lp.locator('#review-message')).to_contain_text('change')
        lp.fill('textarea[name=feedback]', 'Line 3 shows the password as plain text. Use type="password", then send it again.')
        lp.fill('textarea[name=internal]', 'Second time this has come up for Mona. Pair her with Basel on forms.')
        leader.shot('c05-review-form')
        lp.click('[data-submit]')
        lp.wait_for_url('**/app/review-queue.html'); lp.wait_for_load_state('networkidle')
        must(sql(f"select status from tasks where id = '{S['a']}'") == 'revision_required', 'not sent back')
        must(sql("select count(*) from submission_internal_notes") == '1', 'internal note missing')
    check('the leader asks for changes with feedback and a private note (empty feedback refused)', c_review_changes)

    def c_answer_pin():
        leader.go(f"app/task.html?id={S['a']}")
        lp.click('[data-discussion] [data-act="reply"]')
        lp.fill('.reply-box textarea', 'Yes, prefill it from the last sign-in, but never the password.')
        lp.click('.reply-box button[type=submit]')
        expect(lp.locator('.replies .post')).to_have_count(1)
        lp.click('[data-discussion] [data-act="pin"]')
        expect(lp.locator('.thread.is-pinned')).to_have_count(1)
        expect(lp.locator('.tag-answered')).to_have_count(1)
    check('the leader answers the question and pins it', c_answer_pin)

    def c_member_sees_feedback():
        member.go(f"app/task.html?id={S['a']}")
        expect(mp.locator('#work .note')).to_contain_text('type="password"')
        must(mp.locator('text=Second time this has come up').count() == 0, 'internal note leaked to the member')
        must(mp.locator('text=Private reviewer notes').count() == 0, 'notes panel shown to member')
        expect(mp.locator('.thread.is-pinned')).to_have_count(1)
        member.shot('c06-revision-required')
        mp.wait_for_selector('[data-editor] .monaco-editor', timeout=15000)
        code = mp.evaluate('monaco.editor.getModels()[0].getValue()')
        must('type="text" name="password"' in code, 'editor not prefilled with version 1')
        mp.evaluate("monaco.editor.getModels()[0].setValue(monaco.editor.getModels()[0].getValue().replace('type=\"text\" name=\"password\"', 'type=\"password\" name=\"password\"'))")
        mp.wait_for_timeout(600)
        mp.click('[data-submit] button[type=submit]')
        expect(mp.locator('.work-waiting')).to_contain_text('Version 2 is waiting')
        member.go(f"app/review.html?id={sql(f'''select id from submissions where task_id = '{S['a']}' and version = 2''')}")
        must(mp.locator('text=Private reviewer notes').count() == 0, 'notes panel on review page for member')
    check('the member sees the feedback (never the private note), fixes the code and sends version 2', c_member_sees_feedback)

    print('Scenario D: approval with a score, unblocking, and the numbers')
    def approve(score):
        leader.go('app/review-queue.html')
        lp.click('.queue-row >> nth=0')
        lp.wait_for_url('**/app/review.html?id=*'); lp.wait_for_load_state('networkidle')
        lp.fill('#score', str(score))
        lp.fill('textarea[name=feedback]', 'Clean and accessible. Nice work.')
        expect(lp.locator('[data-submit]')).to_contain_text(f'score of {score}')
        lp.click('[data-submit]')
        lp.wait_for_url('**/app/review-queue.html'); lp.wait_for_load_state('networkidle')
    def d_approve():
        approve(90)
        must(sql(f"select status from tasks where id = '{S['a']}'") == 'completed', 'not completed')
        must(sql("select score from submission_reviews where review_action = 'approved'") == '90', 'score not saved')
        leader.go(f"app/review.html?id={sql(f'''select id from submissions where task_id = '{S['a']}' and version = 2''')}")
        expect(lp.locator('.notes-list li')).to_have_count(1)
        leader.shot('d01-approved-review-history')
    check('the leader approves version 2 with a score of 90', d_approve)

    def d_unblocked():
        member.go(f"app/task.html?id={S['b']}")
        expect(mp.locator('[data-act="start"]')).to_be_visible()
        mp.click('[data-act="start"]')
        mp.fill('textarea[name=text]', 'Simple pricing. One plan for small teams, one for growing ones. Start free for 14 days.')
        mp.click('[data-submit] button[type=submit]')
        expect(mp.locator('.work-waiting')).to_be_visible()
        approve(70)
    check('the dependent task unlocks; the text answer is submitted and approved with 70', d_unblocked)

    def d_numbers():
        member.go('app/dashboard.html')
        values = mp.eval_on_selector_all('.metrics .metric-value, .metrics .dial-value', 'els => els.map(e => e.textContent.trim())')
        must(values == ['3', '2', '80'], f'metrics {values}')
        member.shot('d02-member-dashboard-numbers')
    check('the member dashboard now reads 3 assigned, 2 completed, average 80', d_numbers)

    def d_file():
        member.go(f"app/task.html?id={S['c']}")
        mp.click('[data-act="start"]')
        f = pathlib.Path(__file__).with_name('logo.zip'); f.write_bytes(b'PK\x05\x06' + b'\x00' * 18)
        mp.set_input_files('[data-submit] input[name=file]', str(f))
        mp.click('[data-submit] button[type=submit]')
        expect(mp.locator('.work-waiting')).to_be_visible()
        must(sql(f"select file_name from submissions where task_id = '{S['c']}'") == 'logo.zip', 'file not submitted')
    check('a file task takes an upload', d_file)

    print('Scenario E: roles, audit and the platform view')
    def e_users():
        admin.go('app/admin/users.html')
        expect(ap.locator('tr[data-name="Amira Adel"]')).to_contain_text('Your own role')
        ap.click('tr[data-name="Nabil Saad"] [data-act="promote"]')
        confirm(ap)
        expect(ap.locator('tr[data-name="Nabil Saad"] .role-admin')).to_be_visible()
        expect(ap.locator('.feed')).to_contain_text('Platform Admin')
        admin.shot('e01-users-and-roles')
        must(sql("select platform_role from profiles where email = 'nabil@example.com'") == 'platform_admin', 'nabil not admin')
    check('the admin promotes Nabil, cannot change her own role, and the change is in the log', e_users)

    def e_overview():
        admin.go('app/admin/overview.html')
        expect(ap.locator('.stat-grid')).to_contain_text('Waiting for review')
        admin.shot('e02-platform-overview')
        admin.go('app/admin/invitations.html')
        ap.click('[data-filter="accepted"]')
        expect(ap.locator('tbody tr')).to_have_count(2)
        admin.shot('e03-invitations')
    check('the platform overview and the invitations list load', e_overview)

    def e_leader_overview():
        leader.go('app/leading.html')
        expect(lp.locator('.team-list li')).to_have_count(2)
        leader.shot('e04-leading')
    check('the Team overview shows the team with their numbers', e_leader_overview)

    def e_archive():
        admin.go(f"app/project.html?id={S['project']}&tab=settings")
        ap.click('[data-act="archive"]'); confirm(ap)
        expect(ap.locator('.callout')).to_contain_text('archived')
        member.go(f"app/task.html?id={S['c']}")
        expect(mp.locator('[data-composer]')).to_have_count(0)
        admin.go(f"app/project.html?id={S['project']}&tab=settings")
        ap.click('[data-act="restore"]')
        expect(ap.locator('[data-act="archive"]')).to_be_visible()
    check('archiving makes the project read-only; restoring opens it again', e_archive)

    print('Phone layout')
    phone = Browser(pw, 'phone', errors, viewport={'width': 390, 'height': 844})
    def phone_pages():
        login(phone, 'mona@example.com', 'app/dashboard.html')
        phone.shot('p01-dashboard-phone')
        phone.go(f"app/task.html?id={S['a']}")
        phone.shot('p02-task-phone')
        phone.page.click('#menu-button'); phone.page.wait_for_timeout(300)
        phone.shot('p03-menu-phone')
    check('member pages on a phone', phone_pages)
    phone2 = Browser(pw, 'phone-leader', errors, viewport={'width': 390, 'height': 844})
    def phone_leader():
        login(phone2, 'layla@example.com', 'app/leading.html')
        phone2.shot('p04-leading-phone')
        phone2.go(f"app/review.html?id={sql(f'''select id from submissions where task_id = '{S['c']}' ''')}")
        phone2.shot('p05-review-phone')
        phone2.go(f"app/project.html?id={S['project']}&tab=members")
        phone2.shot('p06-people-phone')
    check('leader pages on a phone', phone_leader)

    print()
    fails = [r for r in results if r[0] == 'FAIL']
    print(f'{len(results) - len(fails)} passed, {len(fails)} failed')
    print('browser errors:', len(errors))
    for e in errors[:30]: print('  ', e[:300])
