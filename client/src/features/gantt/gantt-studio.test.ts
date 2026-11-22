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
     const I = {t: value => value, field: (item, key) => item[key], language: 'en', setLanguage() {}, applyStatic() {}};
     const todayInRiyadh = () => '2026-11-22';
     const embedded = true, channel = 'test-channel';
     let state, view = 'gantt', dayWidth = 32, viewStart = null, lastRange = null;
     let drag = null, linkDrag = null, history = [], future = [], selected = new Set(), collapsed = new Set();
     let revision = 0, savedRevision = 0, serverVersion = 0;
     let calendarManaged = false, calendarRevision = 0, readOnly = false;
     const calendarVersionOf = message => message.calendarRevision ?? 0;
     let paletteLevels = [], paletteOverrides = new Map(), paletteSnapshot = '';
     ${sourceBetween("  let portfolio=null", "  let showCritical")}
     ${sourceBetween("  function sendToHost(", "  function setSaveStatus(")}
     ${sourceBetween("  function save()", "  function record(")}
     ${sourceBetween("  const studioViews=", "  function updateSummary(")}
     ${sourceBetween("  function todayTaskMatches(", "  function range(")}
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

  it("filters today's unfinished work across projects while retaining ancestors and excluding cancelled branches", () => {
    const studio = createEmbeddedStudio(101);
    const project = studioProjectState(101, 1001);
    const base = project.tasks[0];
    project.tasks = [
      { ...base, id: "root", start: "2026-11-16", duration: 10 },
      ...[
        { id: "start", start: "2026-11-22", duration: 2 },
        { id: "end", start: "2026-11-19", duration: 2 },
        { id: "ongoing", start: "2026-11-19", duration: 3 },
        { id: "late", start: "2026-11-18" },
        { id: "future", start: "2026-11-24" },
        { id: "done", start: "2026-11-22", executionStatus: "completed" },
        { id: "cancelled", start: "2026-11-22", pmStatusCode: "cancelled" },
        { id: "cancelled-parent", start: "2026-11-22", pmStatusCode: "cancelled" },
        { id: "cancelled-child", start: "2026-11-22", parentId: "cancelled-parent" },
      ].map(task => ({ ...base, parentId: "root", ...task })),
    ] as typeof project.tasks;
    studio.receive({ type: "pscm:gantt:load", state: project, version: 5, sequence: 0 });
    studio.receive({
      type: "pscm:gantt:portfolio",
      portfolio: { projects: [
        portfolioProjects[0],
        { ...portfolioProjects[1], tasks: [
          { id: 2000, parentId: null, name: "Peer parent", startDate: "2026-11-16", endDate: "2026-11-28" },
          { id: 2001, parentId: 2000, name: "Due today", startDate: "2026-11-22", endDate: "2026-11-22" },
          { id: 2002, parentId: 2000, name: "Done", statusCode: "done", startDate: "2026-11-22", endDate: "2026-11-22" },
          { id: 2003, parentId: 2000, name: "Future", startDate: "2026-11-25", endDate: "2026-11-25" },
        ] },
        { ...portfolioProjects[1], id: 303, name: "Future-only project", tasks: [
          { id: 3001, name: "Future only", startDate: "2026-11-25", endDate: "2026-11-25" },
        ] },
      ], links: [] },
    });
    const before = studio.execute("JSON.stringify(state)");
    studio.execute("todayOnly=true; collapsedProjects.add(101); collapsedProjects.add(202); collapsedPeerTasks.add(2000); analysis=E.analyze(state)");
    expect(studio.execute("portfolioRows(state,analysis).map(row=>row.task?.id??row.project.id)")).toEqual([
      101, "root", "start", "end", "ongoing", "late", 202, 2000, 2001,
    ]);
    expect(studio.execute("[...todayTaskMatches(state.tasks,analysis.cal)]")).toEqual([
      ["start", { kind: "start" }],
      ["end", { kind: "end" }],
      ["ongoing", { kind: "ongoing" }],
      ["late", { kind: "overdue", days: 2 }],
    ]);
    expect(studio.execute("JSON.stringify(state)")).toBe(before);
    expect(studio.messages).toEqual([]);
    studio.execute("todayOnly=false; collapsedProjects.clear(); collapsedPeerTasks.clear()");
    expect(studio.execute("portfolioRows(state,analysis).some(row=>row.task?.id==='future')")).toBe(true);
  });

  it("uses workdays for overdue badges and suppresses scheduled work on a holiday", () => {
    const studio = createEmbeddedStudio(101);
    studio.receive({ type: "pscm:gantt:load", state: studioProjectState(101, 1001), version: 1, sequence: 0 });
    expect(studio.execute(`
      const cal=new E.Calendar(state.project.start,{...state.calendar,holidays:[{date:'2026-11-22',name:'Holiday'}]});
      [...todayTaskMatches([
        {id:1,startDay:E.epoch('2026-11-19'),endDay:E.epoch('2026-11-19')},
        {id:2,startDay:E.epoch('2026-11-19'),endDay:E.epoch('2026-11-23')}
      ],cal,true)]
    `)).toEqual([[1, { kind: "overdue", days: 0 }]]);
  });

  it("restores the viewport after today's work without changing project data or collapse choices", () => {
    const scroll = { clientWidth: 1440, scrollLeft: 128, scrollTop: 168 };
    const context = vm.createContext({
      $: (id: string) => id === "ganttScroll" ? scroll : { value: "32" },
      document: { querySelector: () => ({ offsetWidth: 340 }) },
      cancelDrag() {}, cancelLinkDrag() {}, renderChart() {}, updateSelection() {}, reportEscapeState() {},
    });
    vm.runInContext(engine, context);
    vm.runInContext(`
      const E=GanttEngine,todayInRiyadh=()=>'2026-11-22';
      let state=GanttSelfTests.base(),todayOnly=false,todayViewport=null,dayWidth=32,viewStart=null;
      const before=JSON.stringify(state);
      ${sourceBetween("  function setTodayOnly(", "  let escapeBlocked=")}
      setTodayOnly(true);
    `, context);
    expect(vm.runInContext("todayOnly", context)).toBe(true);
    expect(scroll.scrollLeft).toBe(0);
    expect(scroll.scrollTop).toBe(0);
    vm.runInContext("dayWidth=64; viewStart=0; setTodayOnly(false)", context);
    expect(vm.runInContext("[todayOnly,viewStart,dayWidth,todayViewport]", context)).toEqual([false, null, 32, null]);
    expect(scroll).toMatchObject({ scrollLeft: 128, scrollTop: 168 });
    expect(vm.runInContext("JSON.stringify(state)===before", context)).toBe(true);
  });

  it("closes details before today's filter and review, respecting a cancelled dirty-form close", () => {
    const messages: string[] = [];
    let open = true, allowClose = false;
    const dialog = { dispatchEvent: () => allowClose, close: () => { open = false; } };
    const context = vm.createContext({
      Event,
      document: { querySelector: () => open ? dialog : null, querySelectorAll: () => open ? [dialog] : [] },
      setTodayOnly: () => vm.runInContext("todayOnly=false", context),
      reportEscapeState() {},
      sendToHost: (type: string) => messages.push(type),
    });
    vm.runInContext(`
      let todayOnly=true,drag=null,linkDrag=null,reviewExpanded=true,boardEscapeHeld=false;
      ${sourceBetween("  function consumeBoardEscape(", "  function visibleTasks(")}
      handleBoardEscape();
    `, context);
    expect(open).toBe(true);
    expect(vm.runInContext("todayOnly", context)).toBe(true);
    allowClose = true;
    vm.runInContext("handleBoardEscape()", context);
    expect(open).toBe(false);
    expect(vm.runInContext("todayOnly", context)).toBe(true);
    vm.runInContext("handleBoardEscape()", context);
    expect(vm.runInContext("todayOnly", context)).toBe(false);
    expect(messages).not.toContain("pscm:gantt:review-request");
    vm.runInContext("handleBoardEscape()", context);
    expect(messages.at(-1)).toBe("pscm:gantt:review-request");
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

  it("fills the chart width with dated columns when zooming out or resizing", () => {
    const scroll = { clientWidth: 1840 };
    const sidebar = { offsetWidth: 340 };
    const context = vm.createContext({
      $: () => scroll,
      document: { querySelector: () => sidebar },
      getComputedStyle: () => ({ getPropertyValue: () => "340px" }),
    });
    vm.runInContext(engine, context);
    vm.runInContext(
      `const E=GanttEngine;
       let dayWidth=8,viewStart=null,rangeDays=80,portfolio=null;
       const activeTaskTimelineDates=()=>({startDay:null,endDay:null,actualStartDay:null,actualEndDay:null});
       ${sourceBetween("  function range(", "  function geometry(")}
       const state=GanttSelfTests.base();
       const analysis=E.analyze(state);`,
      context
    );
    const readRange = () => vm.runInContext("range(state,analysis)", context);
    expect(readRange()).toMatchObject({ count: 188, width: 1504 });
    expect(scroll.clientWidth - sidebar.offsetWidth).toBeLessThanOrEqual(
      readRange().width
    );
    scroll.clientWidth = 900;
    expect(readRange()).toMatchObject({ count: 70, width: 560 });
    vm.runInContext("dayWidth=32", context);
    expect(readRange()).toMatchObject({ count: 60, width: 1920 });
    sidebar.offsetWidth = 0;
    vm.runInContext("dayWidth=8; viewStart=E.epoch('2026-11-01')", context);
    expect(readRange()).toMatchObject({
      start: vm.runInContext("viewStart", context),
      count: 70,
    });
  });

  it("keeps the first visible date in place when zooming instead of scrolling past early tasks", () => {
    const scroll = { scrollLeft: 0 };
    const scaleSelect = { value: "32" };
    const context = vm.createContext({
      $: (id: string) => id === "ganttScroll" ? scroll : scaleSelect,
      renderChart: () => {},
    });
    vm.runInContext(
      `let dayWidth=8;
       ${sourceBetween("  function zoom(", "  function fit(")}`,
      context
    );
    vm.runInContext("zoom(32)", context);
    expect(scroll.scrollLeft).toBe(0);
    scroll.scrollLeft = 160;
    vm.runInContext("zoom(64)", context);
    expect(scroll.scrollLeft).toBe(320);
    expect(vm.runInContext("dayWidth", context)).toBe(64);
    vm.runInContext("zoom(8)", context);
    expect(scroll.scrollLeft).toBe(40);
    vm.runInContext("zoom(100)", context);
    expect(scroll.scrollLeft).toBe(360);
    expect(vm.runInContext("dayWidth", context)).toBe(72);
  });

  it("uses the Riyadh day for the marker and refreshes it without saving a task", () => {
    const context = vm.createContext({ Intl });
    vm.runInContext(
      sourceBetween("  const riyadhCalendar=", "  const clone = E.clone;"),
      context
    );
    expect(vm.runInContext("todayInRiyadh(new Date('2026-11-22T20:59:59Z'))", context)).toBe("2026-11-22");
    expect(vm.runInContext("todayInRiyadh(new Date('2026-11-22T21:00:00Z'))", context)).toBe("2026-11-23");
    let rendered = 0;
    const refreshContext = vm.createContext({ renderChart: () => rendered++ });
    vm.runInContext(
      `let state={},view='gantt',drag=null,linkDrag=null,renderedToday='2026-11-22';
       const todayInRiyadh=()=>'2026-11-23';
       ${sourceBetween("  function refreshTodayLine(", "  setInterval(refreshTodayLine,")}
       refreshTodayLine();`,
      refreshContext
    );
    expect(rendered).toBe(1);
    vm.runInContext("renderedToday='2026-11-23'; refreshTodayLine()", refreshContext);
    expect(rendered).toBe(1);
    vm.runInContext("renderedToday='2026-11-22'; drag={}; refreshTodayLine()", refreshContext);
    expect(rendered).toBe(1);
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
