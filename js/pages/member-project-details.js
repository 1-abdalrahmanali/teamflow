// member/project-details.html?id=...
import { getProject } from '../projects/projects.js';
import { listTasks } from '../tasks/tasks.js';
import { html, render } from '../utils/dom.js';
import { formatDate } from '../utils/format.js';
import { param, url } from '../utils/paths.js';
import { backLink, mountApp } from '../components/layout.js';
import { emptyState, withLoading } from '../components/ui.js';
import { toast } from '../components/toast.js';
import { ownerLine, sortTasks, taskRow } from './member-shared.js';

const { profile, page, setTitle } = await mountApp({ area: 'member', active: 'projects', title: 'Project' });
const projectId = param('id');

await withLoading(
  page,
  async () => {
    const project = projectId ? await getProject(projectId) : null;
    if (!project) throw new Error('This project does not exist, or you are not a member of it.');
    return { project, tasks: await listTasks({ projectId, assignedTo: profile.id }) };
  },
  ({ project, tasks }) => {
    setTitle(project.name, project.status === 'archived' ? 'This project is archived. You can read it, but not submit.' : '');
    if (param('joined')) {
      toast(`Welcome to ${project.name}`);
      history.replaceState(null, '', url('member/project-details.html', { id: project.id }));
    }
    render(
      page,
      html`${backLink(url('member/projects.html'), 'All my projects')}
      <div class="grid-2">
        <section class="card">
          <div class="card-head"><h3>Your tasks here</h3></div>
          ${tasks.length
            ? sortTasks(tasks).map((t) => taskRow(t, { showProject: false }))
            : emptyState({ iconName: 'list-checks', title: 'No tasks for you yet', body: `${project.owner?.full_name || 'The project owner'} has not assigned you anything in this project. It will show up here when they do.` })}
        </section>
        <section class="card card-pad stack">
          <h3>About this project</h3>
          <p class="muted prewrap">${project.description || 'No description yet.'}</p>
          ${ownerLine(project)}
          <p class="small faint">Started ${formatDate(project.created_at)}</p>
        </section>
      </div>`,
    );
  },
);
