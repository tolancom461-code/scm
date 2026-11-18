import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const html = readFileSync(
  new URL("../../../public/gantt-studio/index.html", import.meta.url),
  "utf8"
);
const script = html.split("<script>")[1].split("</script>")[0];
const uiStart = script.indexOf("/* Gantt Studio 2.4 — shared data");
const engine = script.slice(0, uiStart);

function sourceBetween(start: string, end: string) {
  return script.slice(script.indexOf(start), script.indexOf(end));
}

class ElementStub {
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: ElementStub[] = [];
  value = "";

  set innerHTML(_value: string) {
    throw Error("The calendar row must use element properties");
  }

  append(...children: ElementStub[]) {
    this.children.push(...children);
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
}

const portfolioProjects = [
  {
    id: 101,
    number: "PRJ-101",
    name: "First project",
    startDate: "2026-11-16",
    endDate: "2026-11-20",
    color: "#087f7b",
    tasks: [
      {
        id: 1001,
        parentId: null,
        name: "Task in first project",
        startDate: "2026-11-16",
        endDate: "2026-11-17",
      },
    ],
  },
  {
    id: 202,
    number: "PRJ-202",
    name: "Second project",
    startDate: "2026-11-18",
    endDate: "2026-11-24",
    color: "#a63468",
    tasks: [
      {
        id: 2001,
        parentId: null,
        name: "Task in second project",
        startDate: "2026-11-18",
        endDate: "2026-11-19",
      },
    ],
  },
];

function createEmbeddedStudio(projectId: number) {
  const messages: Record<string, unknown>[] = [];
  let handleMessage: ((event: unknown) => void) | undefined;
  const scroll = { scrollLeft: 0, scrollTop: 0 };
  const elements = {
    ganttScroll: scroll,
    scaleSelect: { value: "32" },
    searchInput: { value: "" },
    phaseFilter: { value: "" },
    statusFilter: { value: "" },
    taskDialog: { open: false },
    ganttView: { hidden: false },
    analysisView: { hidden: true },
    labView: { hidden: true },
  };
  const context = vm.createContext({
    projectId,
    $: (id: keyof typeof elements) => elements[id],
    showHostNotice: (message?: string) => {
      if (message) throw Error(message);
    },
    setSaveStatus: () => {},
    render: () => {},
    renderChart: () => {},
    updateSelection: () => {},
    canLeaveTask: () => true,
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
  });
  const origin = "https://pscm.example.test";
  const parent = {
    postMessage: (message: Record<string, unknown>) =>
      messages.push(structuredClone(message)),
  };
  vm.runInContext(engine, context);
  context.window = {
    parent,
    location: { origin },
    addEventListener(type: string, listener: (event: unknown) => void) {
      if (type === "message") handleMessage = listener;
    },
  };
  vm.runInContext(
    `const E = GanttEngine, P = GanttProgress;
     const I = {t: value => value, language: 'en', setLanguage() {}, applyStatic() {}};
     const embedded = true, channel = 'test-channel';
     let state, view = 'gantt', dayWidth = 32, viewStart = null, lastRange = null;
     let drag = null, linkDrag = null, history = [], future = [], selected = new Set();
     let revision = 0, savedRevision = 0, serverVersion = 0;
     let calendarManaged = false, calendarRevision = 0, readOnly = false;
     const calendarVersionOf = message => message.calendarRevision ?? 0;
     let paletteLevels = [], paletteOverrides = new Map(), paletteSnapshot = '';
     const visibleTasks = project => project.tasks;
     ${sourceBetween("  let portfolio=null", "  let showCritical")}
     ${sourceBetween("  function sendToHost(", "  function setSaveStatus(")}
     ${sourceBetween("  function save()", "  function record(")}
     ${sourceBetween("  const studioViews=", "  function updateSummary(")}
     ${sourceBetween("  function visiblePeerTasks(", "  function range(")}
     ${sourceBetween("  let deferredReceipt=", "  // Delegated handlers")}`,
    context
  );
  const execute = <T>(code: string) => vm.runInContext(code, context) as T;
  return {
    scroll,
    messages,
    execute,
    receive(data: Record<string, unknown>) {
      if (!handleMessage)
        throw Error("Gantt Studio did not register its bridge");
      handleMessage({
        origin,
        source: parent,
        data: { channel: "test-channel", projectId, ...data },
      });
    },
  };
}

function studioProjectState(projectId: number, taskId: number) {
  return {
    schemaVersion: 2,
    completionModel: "leaf-count-v1",
    project: {
      id: `PRJ-${projectId}`,
      name: `Project ${projectId}`,
      description: "",
      start: "2026-11-16",
      statusDate: "2026-11-16",
      deadline: null,
      mode: "free",
    },
    calendar: { workingDays: [0, 1, 2, 3, 4], hoursPerDay: 8, holidays: [] },
    tasks: [
      {
        id: `T${taskId}`,
        pmTaskId: taskId,
        name: "Current project edit",
        duration: 1,
        phase: "Plan",
        owner: "Engineer",
        progress: 0,
        start: "2026-11-18",
        notBefore: null,
        notes: "",
        parentId: null,
        executionStatus: "not_started",
      },
    ],
    baseline: null,
    links: [],
    activity: [],
  };
}

describe("embedded Gantt Studio", () => {
  it("restores the current pane without saving and reports subsequent navigation", () => {
    const studio = createEmbeddedStudio(101);
    studio.receive({
      type: "pscm:gantt:load",
      state: studioProjectState(101, 1001),
      view: "lab",
      version: 5,
      sequence: 0,
    });
    expect(
      studio.execute("[view, $('ganttView').hidden, $('labView').hidden]")
    ).toEqual(["lab", true, false]);
    expect(studio.messages).toEqual([]);

    studio.execute("setView('analysis'); setView('unexpected-pane');");
    expect(studio.execute("view")).toBe("analysis");
    expect(studio.messages).toMatchObject([
      { type: "pscm:gantt:view", projectId: 101, view: "analysis" },
    ]);
  });

  it("displays two projects while saving only the active project's tasks and links", () => {
    const studio = createEmbeddedStudio(101);
    studio.receive({
      type: "pscm:gantt:load",
      state: studioProjectState(101, 1001),
      version: 5,
      sequence: 0,
    });
    studio.receive({
      type: "pscm:gantt:portfolio",
      portfolio: {
        projects: portfolioProjects,
        links: [
          { id: 1, fromTaskId: 1001, toTaskId: 2001, type: "FS", lagDays: 0 },
        ],
      },
    });
    expect(
      studio.execute(
        "portfolioRows(state, {}).map(row => [row.kind, row.task?.name ?? row.project.name])"
      )
    ).toEqual([
      ["project", "First project"],
      ["active", "Current project edit"],
      ["project", "Second project"],
      ["peer", "Task in second project"],
    ]);

    studio.execute("save()");
    expect(studio.messages).toMatchObject([
      {
        type: "pscm:gantt:edit",
        projectId: 101,
        version: 5,
        sequence: 1,
        state: {
          project: { id: "PRJ-101" },
          tasks: [{ id: "T1001", name: "Current project edit" }],
          links: [],
        },
      },
    ]);
    expect(studio.messages[0].state).not.toHaveProperty("portfolio");
  });

  it("opens a peer task in its own project's editor and carries the chart position", () => {
    const first = createEmbeddedStudio(101);
    first.receive({
      type: "pscm:gantt:load",
      state: studioProjectState(101, 1001),
      portfolio: { projects: portfolioProjects, links: [] },
      version: 5,
      sequence: 0,
    });
    first.scroll.scrollLeft = 280;
    first.scroll.scrollTop = 112;
    first.execute("drag = {};");
    first.receive({
      type: "pscm:gantt:board-action-request",
      requestId: "switch",
    });
    expect(first.messages.shift()).toMatchObject({
      type: "pscm:gantt:board-action-response",
      requestId: "switch",
      allowed: false,
    });
    first.execute(
      "drag = null; viewStart = 20773; dayWidth = 18; openPortfolioTask(202, 2001)"
    );
    expect(first.messages).toMatchObject([
      {
        type: "pscm:gantt:focus-project",
        projectId: 101,
        targetProjectId: 202,
        taskId: 2001,
        viewport: {
          start: 20773,
          dayWidth: 18,
          scrollLeft: 280,
          scrollTop: 112,
        },
      },
    ]);

    const second = createEmbeddedStudio(202);
    second.receive({
      type: "pscm:gantt:load",
      projectId: 101,
      state: studioProjectState(101, 1001),
      version: 5,
      sequence: 0,
    });
    second.receive({
      type: "pscm:gantt:load",
      state: studioProjectState(202, 2001),
      portfolio: { projects: portfolioProjects, links: [] },
      viewport: first.messages[0].viewport,
      version: 7,
      sequence: 0,
    });
    expect(second.scroll).toEqual({ scrollLeft: 280, scrollTop: 112 });
    expect(second.execute("[viewStart, dayWidth]")).toEqual([20773, 18]);
    second.execute("save()");
    expect(second.messages).toMatchObject([
      {
        type: "pscm:gantt:edit",
        projectId: 202,
        version: 7,
        state: {
          project: { id: "PRJ-202" },
          tasks: [{ id: "T2001" }],
          links: [],
        },
      },
    ]);
  });

  it("assigns a localized holiday name as a literal input value", () => {
    const rows = new ElementStub();
    const context = vm.createContext({
      document: { createElement: () => new ElementStub() },
      clone: (value: unknown) => JSON.parse(JSON.stringify(value)),
      $: () => rows,
    });
    vm.runInContext(engine, context);
    vm.runInContext(
      "const I = GanttI18n; I.setLanguage('ur',false); " +
        sourceBetween("  function holidayRow(", "  function openCalendar("),
      context
    );
    const name = 'دکان "A" & Unit <2>';
    context.holiday = {
      date: "2026-11-11",
      name: "Holiday",
      translations: { ur: { name } },
    };
    vm.runInContext("holidayRow(holiday);", context);
    expect(rows.children[0].children).toHaveLength(3);
    expect(rows.children[0].children[1].value).toBe(name);
    expect(rows.children[0].children[1].dataset.baseValue).toBe(name);
    expect(vm.runInContext("I.locale()", context)).toBe(
      "ur-PK-u-ca-gregory-nu-latn"
    );
  });

  it("retains edits made after submission while applying accepted task versions", () => {
    const context = vm.createContext({ I: { t: (value: string) => value } });
    vm.runInContext(
      sourceBetween("  function mergeSavedFields(", "  let deferredReceipt"),
      context
    );
    const base = {
      project: { name: "Phase one" },
      calendar: {},
      tasks: [
        { id: "draft", parentId: null, name: "First", start: "2026-11-10" },
        { id: "T22", parentId: "draft", name: "Second", pmVersion: 2 },
      ],
      links: [{ id: "draft-link", from: "draft", to: "T22" }],
    };
    context.before = base;
    context.accepted = {
      ...base,
      tasks: [
        {
          ...base.tasks[0],
          id: "T31",
          start: "2026-11-11",
          pmTaskId: 31,
          pmVersion: 1,
        },
        { ...base.tasks[1], parentId: "T31", pmTaskId: 22, pmVersion: 3 },
      ],
      links: [{ id: "L42", from: "T31", to: "T22", pmLinkId: 42 }],
    };
    context.local = {
      ...base,
      tasks: [
        { ...base.tasks[0], name: "Newer name" },
        base.tasks[1],
        { id: "new-child", parentId: "draft", name: "Created during save" },
      ],
    };
    const result = vm.runInContext(
      "rebaseStudioSave(before,accepted)(local)",
      context
    );
    expect(result.tasks).toMatchObject([
      {
        id: "draft",
        name: "Newer name",
        start: "2026-11-11",
        pmTaskId: 31,
        pmVersion: 1,
      },
      { id: "T22", parentId: "draft", pmVersion: 3 },
      { id: "new-child", parentId: "draft", name: "Created during save" },
    ]);
    expect(result.links).toEqual([
      { id: "draft-link", from: "draft", to: "T22", pmLinkId: 42 },
    ]);
  });

  it("loads project-unit field lengths and keeps the standalone engine checks green", () => {
    const context = vm.createContext({});
    new vm.Script(script);
    vm.runInContext(engine, context);
    const result = vm.runInContext(
      `const project=GanttEngine.demoProject();
       project.project.name='N'.repeat(255);
       project.project.description='D'.repeat(10000);
       project.tasks[0].name='T'.repeat(255);
       GanttEngine.validate(project);
       GanttSelfTests.run();`,
      context
    );
    expect(result.results.filter((item: { ok: boolean }) => !item.ok)).toEqual(
      []
    );
  });
});
