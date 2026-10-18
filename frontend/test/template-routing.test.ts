import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeFor } from '../src/workspace/routing';
import { WorkspaceController } from '../src/workspace/controller';
import { workspaceServer } from './helpers/workspace-server';

const templateIds = ['company-landing', 'brand-store', 'personal-portfolio'];

test('all three original templates have exact routes with the selected ID', () => {
  for (const templateId of templateIds) {
    const path = `/templates/${templateId}`;
    assert.deepEqual(routeFor(path), { kind: 'template', templateId, path });
  }
  for (const path of ['/templates', '/templates/unknown', '/templates/brand-store/extra', '/templates/personal-portfolio/', '/templates/%62rand-store']) {
    assert.equal(routeFor(path).kind, 'missing');
  }
});

test('browsing original templates preserves creation drafts and never creates or generates', async t => {
  const server = workspaceServer();
  const app = new WorkspaceController({ transport: server.transport });
  t.after(() => app.leave());
  app.editHome({ prompt: 'Keep my unsent requirement', title: 'My draft', templateId: 'brand-store' });
  for (const id of templateIds) app.activate(routeFor(`/templates/${id}`));
  assert.equal(app.snapshot().home.prompt, 'Keep my unsent requirement');
  assert.equal(app.snapshot().home.title, 'My draft');
  assert.equal(app.snapshot().home.templateId, 'brand-store');
  assert.equal(server.records.length, 0);
});
