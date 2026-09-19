import { create } from 'zustand';

export type TaskStatus = 'downloading' | 'installing' | 'error';

export type Task = {
  status: TaskStatus;
  /** 0..1, or -1 when the server didn't send a size. */
  progress: number;
  /** Seconds left in the download, from the speed so far. Null until there's enough data. */
  eta?: number | null;
  error?: string;
  abort?: () => void;
};

type Tasks = {
  tasks: Record<string, Task>;
  set: (appId: string, task: Task | null) => void;
  progress: (appId: string, progress: number, eta?: number | null) => void;
};

/** Downloads and installs in flight. Not persisted: they don't survive a restart. */
export const useTasks = create<Tasks>()((set) => ({
  tasks: {},
  set: (appId, task) =>
    set((s) => {
      const tasks = { ...s.tasks };
      if (task) tasks[appId] = task;
      else delete tasks[appId];
      return { tasks };
    }),
  progress: (appId, progress, eta = null) =>
    set((s) => (s.tasks[appId] ? { tasks: { ...s.tasks, [appId]: { ...s.tasks[appId], progress, eta } } } : s)),
}));
