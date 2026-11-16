"""End-to-end: the whole TeamFlow loop through the real UI.

WARNING: this deletes every user (and so every project) in the target database
before it starts. Run it only against a local or throwaway Supabase stack.

    pip install playwright && playwright install chromium
    SUPABASE_ANON_KEY=... python3 tests/e2e/workflow.py
"""
import sys, re, time
sys.path.insert(0, __import__('os').path.dirname(__file__))
from harness import Browser, SITE, sql
from playwright.sync_api import sync_playwright, expect

errors, results = [], []
def check(label, fn):
    try:
        fn(); results.append(('ok', label)); print('  ok   ', label)
    except Exception as e:
        results.append(('FAIL', label)); print('  FAIL ', label, '\n        ', (str(e).splitlines() or [repr(e)])[0][:300])

def register(b, name, email, password='correct-horse-42'):
    b.go('register.html')
    b.page.fill('input[name=fullName]', name)
    if email: b.page.fill('input[name=email]', email)
    b.page.fill('input[name=password]', password)
    b.page.click('button[type=submit]')

with sync_playwright() as pw:
    admin = Browser(pw, 'admin', errors)
    member = Browser(pw, 'member', errors)
    sql("delete from storage.objects where bucket_id in ('submissions', 'avatars'); delete from auth.users;")
    other = Browser(pw, 'other-admin', errors)
    ap, mp = admin.page, member.page
    state = {}

    print('Accounts')
    check('landing page renders for visitors', lambda: (admin.go('index.html'), expect(ap.locator('h1')).to_contain_text('Hand out coding tasks'), admin.shot('01-landing')))
    def admin_signup():
        register(admin, 'Amira Adel', 'amira@example.com')
        ap.wait_for_url('**/member/dashboard.html'); ap.wait_for_load_state('networkidle')
        expect(ap.locator('h1')).to_contain_text('Amira')
    check('a new sign-up lands in the member area (every sign-up is a member)', admin_signup)
    check('the sign-up created a member profile', lambda: (sql("select platform_role from profiles where email='amira@example.com'") == 'member') or (_ for _ in ()).throw(AssertionError('not member')))
    sql("update profiles set platform_role='administrator' where email='amira@example.com'")
    def admin_area():
        admin.go('admin/dashboard.html')
        expect(ap.locator('.empty h3')).to_contain_text('Start with your first project')
        admin.shot('02-admin-empty-dashboard')
    check('after promotion by hand, the admin dashboard opens with a first-project prompt', admin_area)

    print('Projects and invitations')
    def create_project():
        ap.click('[data-action="new-project"] >> nth=0')
        ap.fill('.modal input[name=name]', 'Website relaunch')
        ap.fill('.modal textarea[name=description]', 'The new marketing site: login, pricing and docs pages.')
        admin.shot('03-new-project-dialog')
        ap.click('.modal button[type=submit]')
        ap.wait_for_url('**/admin/project-details.html?id=*'); ap.wait_for_load_state('networkidle')
        expect(ap.locator('#page-title')).to_have_text('Website relaunch')
        state['project_id'] = re.search(r'id=([0-9a-f-]+)', ap.url).group(1)
    check('admin creates a project through the dialog', create_project)
    def invite():
        ap.click('#page-actions [data-action="invite"]')
        ap.fill('.modal input[name=email]', 'Mona@Example.com')
        ap.click('.modal button[type=submit]')
        link = ap.locator('.modal [data-link]')
        expect(link).to_be_visible()
        state['invite'] = link.input_value()
        assert '#token=' in state['invite'], state['invite']
        admin.shot('04-invitation-link')
        ap.click('.modal [data-done]')
    check('admin creates an invitation link to send personally', invite)
    check('only a hash of the token is stored', lambda: (len(sql("select token_hash from invitations limit 1")) == 64 and state['invite'].split('#token=')[1] not in sql("select token_hash from invitations")) or (_ for _ in ()).throw(AssertionError()))
    def duplicate_invite():
        ap.click('#page-actions [data-action="invite"]')
        ap.fill('.modal input[name=email]', 'mona@example.com')
        ap.click('.modal button[type=submit]')
        expect(ap.locator('.modal [data-message]')).to_contain_text('already a pending invitation')
        ap.keyboard.press('Escape')
    check('a duplicate invitation is refused with a clear message', duplicate_invite)

    print('Member joins')
    def open_invite_signed_out():
        mp.goto(state['invite']); mp.wait_for_load_state('networkidle')
        expect(mp.locator('h1')).to_contain_text('Join Website relaunch')
        assert '#token' not in mp.url, 'token should be removed from the address bar'
        member.shot('05-invitation-signed-out')
    check('the invitation page explains the invite before sign-in and hides the token', open_invite_signed_out)
    def member_signup():
        mp.get_by_role('link', name='Create an account').click()
        mp.wait_for_url('**/register.html?email=*')
        expect(mp.locator('input[name=email]')).to_have_value('mona@example.com')
        expect(mp.locator('.invite-banner')).to_be_visible()
        mp.fill('input[name=fullName]', 'Mona Farid'); mp.fill('input[name=password]', 'correct-horse-42')
        mp.click('button[type=submit]')
        mp.wait_for_url('**/accept-invitation.html'); mp.wait_for_load_state('networkidle')
        member.shot('06-invitation-signed-in')
        mp.click('#accept')
        mp.wait_for_url('**/member/project-details.html?id=*'); mp.wait_for_load_state('networkidle')
        expect(mp.locator('#page-title')).to_have_text('Website relaunch')
    check('the invited person signs up with the prefilled email and joins', member_signup)
    def reuse_invite():
        mp.goto(state['invite']); mp.wait_for_load_state('networkidle')
        expect(mp.locator('h1')).to_contain_text('already in')
    check('the same invitation link cannot be used again', reuse_invite)
    def member_blocked_from_admin():
        member.go('admin/dashboard.html')
        mp.wait_for_url('**/member/dashboard.html')
    check('a member opening an admin page is sent to the member dashboard', member_blocked_from_admin)

    print('Tasks')
    def create_task():
        admin.go(f"admin/task-form.html?project={state['project_id']}")
        ap.fill('input[name=title]', 'Build the login page')
        ap.fill('textarea[name=description]', 'A simple login form for the new site.')
        ap.fill('textarea[name=requirements]', 'Email field\nPassword field that hides what you type\nA Sign in button')
        ap.select_option('select[name=assigned_to]', label='Mona Farid (mona@example.com)')
        ap.check('input[name=priority][value=high]')
        ap.select_option('select[name=programming_language]', 'html')
        ap.fill('input[name=deadline]', '2026-11-20T17:00')
        admin.shot('07-task-form')
        ap.click('button[type=submit]')
        ap.wait_for_url('**/admin/project-details.html?id=*#tasks'); ap.wait_for_load_state('networkidle')
        expect(ap.locator('.table')).to_contain_text('Build the login page')
        admin.shot('08-project-tasks')
    check('admin creates and assigns a code task', create_task)
    for title, kind in [('Write the release notes', 'text'), ('Upload the new logo', 'file_upload')]:
        def make(title=title, kind=kind):
            admin.go(f"admin/task-form.html?project={state['project_id']}")
            ap.fill('input[name=title]', title)
            ap.select_option('select[name=assigned_to]', label='Mona Farid (mona@example.com)')
            ap.check(f'input[name=submission_type][value={kind}]')
            expect(ap.locator('[data-language]')).to_be_hidden()
            ap.click('button[type=submit]')
            ap.wait_for_url('**#tasks')
        check(f'admin creates a {kind} task (language field hides for non-code)', make)

    print('Submission and review loop')
    def member_sees_tasks():
        member.go('member/tasks.html')
        expect(mp.locator('.task-row')).to_have_count(3)
        member.shot('09-member-tasks')
        mp.get_by_role('link', name=re.compile('Build the login page')).click()
        mp.wait_for_url('**/member/task-details.html?id=*'); mp.wait_for_load_state('networkidle')
        state['task_url'] = mp.url
        expect(mp.locator('[data-checklist] li')).to_have_count(3)
    check('member sees exactly their three tasks and opens one', member_sees_tasks)
    def start():
        mp.click('[data-action="start"]'); mp.wait_for_load_state('networkidle')
        expect(mp.locator('.status').first).to_contain_text('In progress')
    check('member starts the task', start)
    def editor_and_submit_v1():
        mp.wait_for_selector('.monaco-editor', timeout=20000)
        mp.click('.monaco-editor .view-lines')
        mp.keyboard.insert_text('<form class="login">\n<input type="email" name="email" required>\n<input type="text" name="password">\n<button>Sign in</button>\n</form>')
        mp.wait_for_timeout(900)
        expect(mp.locator('[data-draft-state]')).to_contain_text('Draft saved')
        member.shot('10-member-editor')
        mp.click('[data-action="submit"]')
        expect(mp.locator('.modal')).to_contain_text('Submit version 1?')
        mp.click('.modal [data-answer="yes"]')
        mp.wait_for_load_state('networkidle'); mp.wait_for_timeout(500)
        expect(mp.locator('.status').first).to_contain_text('Submitted')
        expect(mp.locator('.toast')).to_contain_text('Version 1 submitted')
    check('member writes code in Monaco (draft autosaves) and submits version 1', editor_and_submit_v1)
    check('the stored submission matches what was typed', lambda: ('type="text" name="password"' in sql("select code from submissions where version=1 and language='html'")) or (_ for _ in ()).throw(AssertionError(sql("select code from submissions"))))
    def admin_requests_changes():
        admin.go('admin/dashboard.html')
        expect(ap.locator('.stat.is-attention .stat-value')).to_have_text('1')
        admin.shot('11-admin-dashboard')
        admin.go('admin/submissions.html')
        ap.click('.table a.btn >> nth=0'); ap.wait_for_url('**/submission-review.html?id=*'); ap.wait_for_load_state('networkidle')
        ap.wait_for_selector('.monaco-editor', timeout=20000)
        admin.shot('12-review')
        ap.click('[data-decision="request_revision"]')
        expect(ap.locator('#review-message')).to_contain_text('Write a note')
        ap.fill('textarea[name=feedback]', 'Line 3 shows the password as plain text. Use type="password", then send it again.')
        ap.click('[data-decision="request_revision"]')
        ap.wait_for_load_state('networkidle'); ap.wait_for_timeout(400)
        expect(ap.locator('.status').first).to_contain_text('Revision requested')
    check('admin must write a note to ask for changes, then sends it back', admin_requests_changes)
    def member_resubmits():
        mp.goto(state['task_url']); mp.wait_for_load_state('networkidle')
        expect(mp.locator('.note').first).to_contain_text('plain text')
        mp.wait_for_selector('.monaco-editor', timeout=20000)
        member.shot('13-member-revision')
        # The editor starts from version 1; replace the content.
        mp.click('.monaco-editor .view-lines'); mp.keyboard.press('Control+A')
        mp.keyboard.insert_text('<form class="login">\n<input type="email" name="email" required>\n<input type="password" name="password" required>\n<button>Sign in</button>\n</form>')
        mp.click('[data-action="submit"]'); mp.click('.modal [data-answer="yes"]')
        mp.wait_for_load_state('networkidle'); mp.wait_for_timeout(500)
        expect(mp.locator('.toast')).to_contain_text('Version 2 submitted')
        expect(mp.locator('.versions .version')).to_have_count(2)
    check('member sees the note, edits the previous version and submits version 2', member_resubmits)
    check('version 1 is kept untouched', lambda: (sql("select count(*) from submissions s join tasks t on t.id=s.task_id where t.title='Build the login page'") == '2' and 'type="text"' in sql("select code from submissions where version=1 and language='html'")) or (_ for _ in ()).throw(AssertionError()))
    def admin_approves():
        admin.go('admin/submissions.html'); ap.click('.table a.btn >> nth=0'); ap.wait_for_url('**/submission-review.html?id=*'); ap.wait_for_load_state('networkidle')
        expect(ap.locator('#page-sub')).to_contain_text('version 2 of 2')
        ap.fill('textarea[name=feedback]', 'Looks good, thanks.')
        ap.click('[data-decision="approve"]'); ap.wait_for_load_state('networkidle'); ap.wait_for_timeout(400)
        expect(ap.locator('.status').first).to_contain_text('Approved')
    check('admin approves version 2', admin_approves)
    def completed():
        mp.goto(state['task_url']); mp.wait_for_load_state('networkidle')
        expect(mp.locator('.status').first).to_contain_text('Completed')
        expect(mp.locator('[data-action="submit"]')).to_have_count(0)
        member.shot('14-member-completed')
    check('the task is Completed for the member and accepts no more submissions', completed)
    check('the database agrees: completed only after approval', lambda: (sql("select status from tasks where title='Build the login page'") == 'completed') or (_ for _ in ()).throw(AssertionError()))

    print('Other submission types and discussion')
    def text_task():
        member.go('member/tasks.html'); mp.get_by_role('link', name=re.compile('Write the release notes')).click(); mp.wait_for_load_state('networkidle')
        mp.fill('[data-text]', 'New: login page with hidden password field.')
        mp.click('[data-action="submit"]'); mp.click('.modal [data-answer="yes"]'); mp.wait_for_load_state('networkidle'); mp.wait_for_timeout(400)
        expect(mp.locator('.status').first).to_contain_text('Submitted')
    check('member submits a text answer', text_task)
    def file_task():
        member.go('member/tasks.html'); mp.get_by_role('link', name=re.compile('Upload the new logo')).click(); mp.wait_for_load_state('networkidle')
        mp.set_input_files('[data-file]', files=[{'name': 'logo.svg', 'mimeType': 'image/svg+xml', 'buffer': b'<svg xmlns="http://www.w3.org/2000/svg"/>'}])
        expect(mp.locator('[data-file-name]')).to_contain_text('logo.svg')
        mp.click('[data-action="submit"]'); mp.click('.modal [data-answer="yes"]'); mp.wait_for_load_state('networkidle'); mp.wait_for_timeout(500)
        expect(mp.locator('.status').first).to_contain_text('Submitted')
    check('member uploads a file and submits it', file_task)
    check('the file sits in the member\'s own folder under the task', lambda: re.match(r'^[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+-logo\.svg$', sql("select name from storage.objects where bucket_id='submissions'")) or (_ for _ in ()).throw(AssertionError(sql("select name from storage.objects"))))
    def comment():
        mp.fill('#comments textarea', 'Is an SVG fine, or do you need a PNG too?')
        mp.click('#comments button[type=submit]')
        expect(mp.locator('#comments .comment')).to_have_count(1)
        admin.go('admin/submissions.html'); ap.get_by_role('link', name='Upload the new logo').click(); ap.wait_for_load_state('networkidle')
        expect(ap.locator('#comments .comment')).to_contain_text('SVG fine')
        expect(ap.locator('[data-download]')).to_be_visible()
        admin.shot('15-review-file')
    check('member and admin share a task discussion; admin sees the uploaded file', comment)

    print('Isolation')
    def other_admin():
        register(other, 'Basel Nour', 'basel@example.com')
        other.page.wait_for_url('**/member/dashboard.html')
        sql("update profiles set platform_role='administrator' where email='basel@example.com'")
        other.go('admin/projects.html')
        expect(other.page.locator('.empty h3')).to_contain_text('No projects yet')
        other.go(f"admin/project-details.html?id={state['project_id']}")
        expect(other.page.locator('.empty h3')).to_contain_text('did not load')
    check('another administrator sees none of Amira\'s projects, even by direct link', other_admin)
    def member_cannot_see_others():
        other.go('member/tasks.html')
        expect(other.page.locator('.empty h3')).to_contain_text('No tasks yet')
    check('a person outside the project sees no tasks', member_cannot_see_others)

    print('Archive and sign out')
    def archive():
        admin.go(f"admin/project-details.html?id={state['project_id']}#settings")
        ap.click('[data-action="toggle-archive"]'); ap.click('.modal [data-answer="yes"]'); ap.wait_for_timeout(600)
        expect(ap.locator('#page-sub')).to_contain_text('Archived')
        expect(ap.locator('#page-actions [data-action="invite"]')).to_have_count(0)
        ap.click('[data-action="toggle-archive"]'); ap.wait_for_timeout(600)
    check('admin archives and restores the project', archive)
    def sign_out():
        mp.click('#sign-out'); mp.wait_for_url('**/login.html'); mp.wait_for_load_state('networkidle')
        expect(mp.locator('.form-message.is-info')).to_have_count(0)  # no "session ended" note after a deliberate sign-out
        mp.goto(f'{SITE}/member/dashboard.html', wait_until='commit'); mp.wait_for_url('**/login.html?next=*'); mp.wait_for_load_state('networkidle')
        mp.fill('input[name=email]', 'mona@example.com'); mp.fill('input[name=password]', 'wrong-password')
        mp.click('button[type=submit]')
        expect(mp.locator('#form-message')).to_contain_text('do not match')
        mp.fill('input[name=password]', 'correct-horse-42'); mp.click('button[type=submit]')
        mp.wait_for_url('**/member/dashboard.html')
    check('sign out protects pages; a wrong password gets a clear message; sign-in returns to the page', sign_out)
    def session_ended_elsewhere():
        mp.wait_for_load_state('networkidle')
        other_tab = member.context.new_page()
        other_tab.goto(f'{SITE}/member/tasks.html'); other_tab.wait_for_load_state('networkidle')
        other_tab.click('#sign-out'); other_tab.wait_for_url('**/login.html')
        mp.wait_for_url('**/login.html?expired=1', timeout=10000); mp.wait_for_load_state('networkidle')
        expect(mp.locator('.form-message.is-info')).to_contain_text('session ended')
        other_tab.close()
    check('signing out in one tab sends the other tab to sign-in with a note', session_ended_elsewhere)

    for b in (admin, member, other): b.browser.close()

failed = [r for r in results if r[0] == 'FAIL']
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
real_errors = [e for e in errors if 'Failed to load resource' not in e]
print(f"{len(real_errors)} browser errors")
for e in real_errors[:25]: print('  ', e[:300])
sys.exit(1 if failed or real_errors else 0)
