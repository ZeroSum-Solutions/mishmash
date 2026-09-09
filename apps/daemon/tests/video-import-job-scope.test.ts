// VideoImportService.getJob scoping: a job created under one project must
// never be readable through another project's id (pre-review r1 MEDIUM
// finding), and a generic media_tasks row inserted by another feature (e.g.
// `od media generate`) must never come back mislabeled as a Vimeo import
// (Grok r1 MEDIUM finding: cross-kind read). Exercises the service
// directly against a real (in-memory) media_tasks table -- no HTTP layer,
// no Vimeo double -- because both leaks are in `getJob`'s lookup itself,
// not in routing or provider behaviour.

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { insertMediaTask, migrateMediaTasks } from '../src/media/tasks.js';
import { VideoImportService } from '../src/video-import/service.js';

function makeService(): { service: VideoImportService; db: Database.Database } {
  const db = new Database(':memory:');
  // `media_tasks.project_id` carries `REFERENCES projects(id)`; this
  // in-memory db only needs the column the foreign key checks against, not
  // the real projects table's full shape.
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
  db.prepare('INSERT INTO projects (id) VALUES (?)').run('project-a');
  db.prepare('INSERT INTO projects (id) VALUES (?)').run('project-b');
  migrateMediaTasks(db);
  const service = new VideoImportService(db, { projectsRoot: '/tmp/unused-project-root', runtimeDataDir: '/tmp/unused-data-dir' });
  return { service, db };
}

describe('VideoImportService.getJob scoping', () => {
  it('returns the job when the projectId in the URL matches the task\'s own project', () => {
    const { service, db } = makeService();
    insertMediaTask(db, { id: 'task-a', projectId: 'project-a', status: 'done', surface: 'video-import' });

    const job = service.getJob('project-a', 'task-a');
    expect(job).not.toBeNull();
    expect(job?.jobId).toBe('task-a');
  });

  it('never returns a job created under a different project (cross-project read)', () => {
    const { service, db } = makeService();
    insertMediaTask(db, { id: 'task-a', projectId: 'project-a', status: 'done', surface: 'video-import' });

    expect(service.getJob('project-b', 'task-a')).toBeNull();
  });

  it('returns null for an unknown jobId regardless of projectId', () => {
    const { service } = makeService();
    expect(service.getJob('project-a', 'does-not-exist')).toBeNull();
  });

  it('never returns a task from another feature (e.g. media generate) even under the right project (cross-kind read)', () => {
    const { service, db } = makeService();
    // No `surface: 'video-import'` -- this is what a generate-flow task
    // (or any other media_tasks row) looks like: same table, same project,
    // a different feature entirely.
    insertMediaTask(db, { id: 'task-a', projectId: 'project-a', status: 'done' });

    expect(service.getJob('project-a', 'task-a')).toBeNull();
  });
});
