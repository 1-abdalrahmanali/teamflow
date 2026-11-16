// index.html: what TeamFlow is, shown through the thing it does (the review loop).
import { isConfigured } from '../config/supabase.js';
import { getCurrentProfile, getSession } from '../auth/auth.js';
import { homeFor } from '../auth/guard.js';
import { $, html, icon, render } from '../utils/dom.js';
import { url } from '../utils/paths.js';
import { brand } from '../components/layout.js';

async function signedInProfile() {
  if (!isConfigured) return null;
  try {
    return (await getSession()) ? await getCurrentProfile() : null;
  } catch {
    return null;
  }
}

const profile = await signedInProfile();

const topActions = profile
  ? html`<a class="btn" href="${homeFor(profile)}">Open your dashboard</a>`
  : html`<a class="btn btn-ghost" href="${url('login.html')}">Sign in</a>
         <a class="btn" href="${url('register.html')}">Create account</a>`;

render(
  $('#app'),
  html`<header class="landing-top">
      ${brand()}
      <nav class="row">${topActions}</nav>
    </header>

    <main>
      <section class="hero">
        <div>
          <h1>Hand out coding tasks. Review every version. Approve when it is right.</h1>
          <p class="hero-lede">TeamFlow keeps each project's tasks, code submissions and review notes together,
            so nobody has to ask which version was the final one.</p>
          <div class="hero-actions">
            ${profile
              ? html`<a class="btn" href="${homeFor(profile)}">Open your dashboard</a>`
              : html`<a class="btn" href="${url('register.html')}">Create your account</a>
                     <a class="btn btn-quiet" href="${url('login.html')}">I already have one</a>`}
          </div>
          <p class="small faint" style="margin-top:var(--s-4)">Got an invitation link? Open it first, then sign up with the email it was sent to.</p>
        </div>

        <div class="loop" aria-label="Example: a submission with reviewer feedback">
          <div class="card loop-card">
            <div class="row row-between row-wrap">
              <div>
                <p class="strong">Build the login page</p>
                <p class="small faint">Website relaunch, assigned to Mona</p>
              </div>
              <span class="status status-red">Revision required</span>
            </div>
            <pre class="loop-code mono"><span class="ln">1</span>&lt;form class="login"&gt;
<span class="ln">2</span>  &lt;input type="email" name="email" required&gt;
<span class="hl"><span class="ln">3</span>  &lt;input type="text" name="password"&gt;</span><span class="ln">4</span>  &lt;button&gt;Sign in&lt;/button&gt;
<span class="ln">5</span>&lt;/form&gt;</pre>
          </div>
          <div class="note">
            <div class="note-from"><span class="avatar avatar-sm" data-hue="3">AA</span><span>Amira wrote, 2 hours ago</span></div>
            <p class="note-text">Line 3 shows the password as plain text. Use type="password", then send it again.</p>
          </div>
          <div class="loop-trail" aria-hidden="true">
            <span class="status status-red">Version 1</span><span class="line"></span>
            <span class="status status-amber">Version 2</span><span class="line"></span>
            <span class="status status-green">Approved</span>
          </div>
        </div>
      </section>

      <section class="band">
        <div class="band-inner">
          <h2>How a task moves</h2>
          <div class="steps">
            <div class="step">
              <h3>Open a project and invite people</h3>
              <p>Create a link for each person and send it however you like. It works once, for their email only.</p>
            </div>
            <div class="step">
              <h3>Assign the work</h3>
              <p>Write what needs doing, set a deadline and choose how it is handed in: code, text, a GitHub link or a file.</p>
            </div>
            <div class="step">
              <h3>Review, then approve</h3>
              <p>Read each version, leave a note when it needs changes, and approve it when it is done.</p>
            </div>
          </div>
        </div>
      </section>

      <section class="band-inner promise">
        <div>
          <h2>Rules the database keeps for you</h2>
          <p class="muted" style="margin-top:var(--s-3)">These are enforced on the server for every request,
            not just hidden in the interface.</p>
        </div>
        <ul>
          <li>${icon('circle-check')}<span>A task is only completed when its project owner approves a submission.</span></li>
          <li>${icon('circle-check')}<span>Every version is kept. Nothing is overwritten, so the history is always there.</span></li>
          <li>${icon('circle-check')}<span>Members see their own tasks and nobody else's.</span></li>
          <li>${icon('circle-check')}<span>One administrator cannot see another administrator's projects.</span></li>
          <li>${icon('circle-check')}<span>Submitted code is shown, never run.</span></li>
        </ul>
      </section>
    </main>

    <footer class="landing-foot">TeamFlow, a home for project tasks and code reviews.</footer>`,
);
