import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  addTodoRpc,
  listDismissedRpc,
  setDismissedRpc,
  listNotesRpc,
  setNoteRpc,
  approveIntakeRpc,
  rejectIntakeItemRpc,
  requestIntakeChangesRpc,
  DELIVER_ACTION_ID,
  agentReposRpc,
  cleanupJobsRpc,
  archiveTaskRpc,
  startCleanupRpc,
  undraftRpc,
  listAssignmentsRpc,
  setAssignmentsRpc,
  boardSettings,
  launchIntakeRpc,
  listTodosRpc,
  lookupItemsRpc,
  prStatusRpc,
  removeTodoRpc,
  reposRpc,
  resolveItemRpc,
  runActionRpc,
  runsRpc,
  searchItemsRpc,
  viewSettings,
} from "./shared/contracts";
import { agentRepos } from "./server/agentRepos";
import { listAssignments, setAssignments } from "./server/assignments";
import { archiveTask, cleanupJobs, startCleanup } from "./server/cleanup";
import { approveIntake, rejectIntakeItem, requestIntakeChanges } from "./server/intake";
import { readPrStatus } from "./server/github";
import { forgetItem, lookupItems, removeLabel, resolveItem } from "./server/items";
import { searchPage } from "./server/search";
import { launchIntake, listProfiles, runAction } from "./server/launch";
import { listRepos } from "./server/repos";
import { readRuns } from "./server/runs";
import { addTodo, listTodos, removeTodo } from "./server/todo";
import { listNotes, setNote } from "./server/notes";
import { listDismissed, setDismissed } from "./server/dismissed";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(boardSettings);
  server.registerSettings(viewSettings);

  async function values() {
    const state = await settings.read();
    if (state.status !== "ready") throw new Error(`Board settings are invalid: ${state.error}`);
    return state.values;
  }

  server.handle(reposRpc, async (_input, { paseo }) => {
    const { rootPath, title } = await values();
    const [board, profiles] = await Promise.all([listRepos(paseo, rootPath, title), listProfiles(paseo)]);
    return { ...board, profiles: profiles.map((profile) => ({ id: profile.id, name: profile.name ?? profile.id })) };
  });

  server.handle(runsRpc, async () => {
    const { deliverEnabled, runStateDir } = await values();
    if (!deliverEnabled) return { dir: null, runs: [], errors: [] };
    return readRuns(runStateDir);
  });

  server.handle(prStatusRpc, ({ repo, number }) => {
    forgetItem(repo, number);
    return readPrStatus(repo, number);
  });

  server.handle(searchItemsRpc, async ({ repos: selected, query, kind, labels, author, bases, prStates, cursors }, { paseo }) => {
    const { rootPath, title } = await values();
    const { repos } = await listRepos(paseo, rootPath, title);
    const scope = [...new Set(repos.flatMap((candidate) => (candidate.github && !candidate.archived ? [candidate.github] : [])))];
    const wanted = new Set(selected.map((name) => name.toLowerCase()));
    const filtered = wanted.size ? scope.filter((name) => wanted.has(name.toLowerCase())) : scope;
    const page = await searchPage(filtered, kind, { query, labels, author, bases, prStates }, cursors);
    return { ...page, repos: scope };
  });

  server.handle(resolveItemRpc, ({ reference, defaultRepo }) => resolveItem(reference, defaultRepo));

  server.handle(lookupItemsRpc, ({ keys }) => lookupItems(keys));
  server.handle(undraftRpc, ({ repo, number, label }) => removeLabel(repo, number, label));

  server.handle(runActionRpc, async ({ actionId, item, input }, { paseo }) => {
    const { rootPath, title, actions } = await values();
    const action = actions.find((candidate) => candidate.id === actionId);
    if (!action) throw new Error("That action no longer exists.");
    const { repos, rootPath: root } = await listRepos(paseo, rootPath, title);
    return runAction(paseo, { action, item, input, repos, rootPath: root });
  });

  server.handle(agentReposRpc, async ({ agents }, { paseo }) => {
    const { rootPath, title } = await values();
    const board = await listRepos(paseo, rootPath, title);
    return agentRepos(paseo, agents, board.repos, board.rootPath);
  });

  server.handle(startCleanupRpc, async ({ agentId, skipCleanup }, { paseo }) => {
    const { cleanupPrompt } = await values();
    return startCleanup(paseo, agentId, skipCleanup || !cleanupPrompt.trim() ? null : cleanupPrompt);
  });
  server.handle(cleanupJobsRpc, () => cleanupJobs());
  server.handle(archiveTaskRpc, async ({ agentIds, workspaceIds, skipCleanup }, { paseo }) => {
    const { cleanupPrompt } = await values();
    return archiveTask(paseo, agentIds, workspaceIds, skipCleanup || !cleanupPrompt.trim() ? null : cleanupPrompt);
  });

  server.handle(listAssignmentsRpc, () => listAssignments());
  server.handle(setAssignmentsRpc, ({ workspaceIds, repos, link }) => setAssignments(workspaceIds, { repos, link }));

  server.handle(listDismissedRpc, () => listDismissed());
  server.handle(setDismissedRpc, ({ keys, dismissed }) => setDismissed(keys, dismissed));
  server.handle(listNotesRpc, () => listNotes());
  server.handle(setNoteRpc, ({ key, text }) => setNote(key, text));

  server.handle(listTodosRpc, () => listTodos());
  server.handle(addTodoRpc, (item) => addTodo(item));
  server.handle(removeTodoRpc, ({ repo, number }) => removeTodo(repo, number));

  server.handle(approveIntakeRpc, async ({ intakeAgentId, items, instructions, notify }, { paseo }) => {
    const { rootPath, title, actions, draftLabel } = await values();
    const deliver = actions.find((action) => action.id === DELIVER_ACTION_ID);
    if (!deliver) throw new Error("The Deliver action is missing; add it back in the board settings.");
    const board = await listRepos(paseo, rootPath, title);
    return approveIntake(paseo, { intakeAgentId, notify, items, instructions, draftLabel, deliver, repos: board.repos, rootPath: board.rootPath });
  });
  server.handle(rejectIntakeItemRpc, async ({ intakeAgentId, item, notify }, { paseo }) => {
    const { draftLabel } = await values();
    return rejectIntakeItem(paseo, intakeAgentId, item, draftLabel, notify);
  });
  server.handle(requestIntakeChangesRpc, ({ intakeAgentId, text }, { paseo }) => requestIntakeChanges(paseo, intakeAgentId, text));

  server.handle(launchIntakeRpc, async ({ description, attachments }, { paseo }) => {
    const { rootPath, title, deliverEnabled, intakeProfile, intakePrompt } = await values();
    if (!deliverEnabled) throw new Error("The paseo-dev-team integration is off in the board settings.");
    const board = await listRepos(paseo, rootPath, title);
    return launchIntake(paseo, {
      description,
      attachments,
      profileId: intakeProfile.trim(),
      promptTemplate: intakePrompt,
      rootPath: board.rootPath,
    });
  });

  return () => {};
}
